import fs from 'fs';
import path from 'path';
import { bech32 } from 'bech32';
import { Decimal } from '@cosmjs/math';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { SigningStargateClient, GasPrice, coins } from '@cosmjs/stargate';
import { fetch } from 'undici';
import crypto from 'crypto';

// Configuration
const RPC = 'https://rpc-testnet.empe.io';
const LCD = 'https://lcd-testnet.empe.io';
const CHAIN_ID = 'empe-testnet-2';
const DENOM = 'uempe';
const EXPONENT = 6;
const GAS_PRICE = `0.025${DENOM}`;
const PREFIX = 'empe';
const CLAIM_CHUNK = 16;
const BROADCAST_TIMEOUT_MS = 45000;

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m'
};

// ASCII Art
const ASCII_LOGO = `
${colors.cyan}███████╗███╗   ███╗██████╗ ███████╗██╗██████╗ ██╗ █████╗ 
██╔════╝████╗ ████║██╔══██╗██╔════╝██║██╔══██╗██║██╔══██╗
█████╗  ██╔████╔██║██████╔╝█████╗  ██║██████╔╝██║███████║
██╔══╝  ██║╚██╔╝██║██╔═══╝ ██╔══╝  ██║██╔══██╗██║██╔══██║
███████╗██║ ╚═╝ ██║██║     ███████╗██║██║  ██║██║██║  ██║
╚══════╝╚═╝     ╚═╝╚═╝     ╚══════╝╚═╝╚═╝  ╚═╝╚═╝╚═╝  ╚═╝${colors.reset}

${colors.yellow}████████╗███████╗███████╗████████╗███╗   ██╗███████╗████████╗
╚══██╔══╝██╔════╝██╔════╝╚══██╔══╝████╗  ██║██╔════╝╚══██╔══╝
   ██║   █████╗  ███████╗   ██║   ██╔██╗ ██║█████╗     ██║   
   ██║   ██╔══╝  ╚════██║   ██║   ██║╚██╗██║██╔══╝     ██║   
   ██║   ███████╗███████║   ██║   ██║ ╚████║███████╗   ██║   
   ╚═╝   ╚══════╝╚══════╝   ╚═╝   ╚═╝  ╚═══╝╚══════╝   ╚═╝    ${colors.reset}

${colors.dim}                    🤖 AUTOMATED BOT - AUTODROP CENTRAL 🤖${colors.reset}
`;

// Utility functions
const toMicro = (x) => Decimal.fromUserInput(String(x), EXPONENT).atomics;
const fromMicro = (a) => Decimal.fromAtomics(String(a || '0'), EXPONENT).toString();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Generate random address
const genRandomAddress = (prefix = PREFIX) => {
  const data = crypto.randomBytes(20);
  const words = bech32.toWords(data);
  return bech32.encode(prefix, words);
};

// Clean console functions
const clearScreen = () => process.stdout.write('\x1b[2J\x1b[0f');
const moveCursor = (x, y) => process.stdout.write(`\x1b[${y};${x}H`);

// LCD API functions
async function lcdJson(url) {
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`LCD ${r.status}`);
  return r.json();
}

async function fetchBondedValidators(limit = 300) {
  const j = await lcdJson(`${LCD}/cosmos/staking/v1beta1/validators?status=BOND_STATUS_BONDED&pagination.limit=${limit}`);
  return (j.validators || []).filter(v => !v.jailed)
    .filter(v => (v.status || '').toUpperCase() === 'BOND_STATUS_BONDED');
}

async function fetchRewards(delegator) {
  const j = await lcdJson(`${LCD}/cosmos/distribution/v1beta1/delegators/${delegator}/rewards`);
  const perVal = (j.rewards || []).map(r => ({
    validator: r.validator_address,
    amount: (r.reward || []).find(c => c.denom === DENOM)?.amount || '0'
  }));
  const total = (j.total || []).find(c => c.denom === DENOM)?.amount || '0';
  return { total, perVal };
}

async function getBalance(client, address) {
  const b = await client.getBalance(address, DENOM).catch(() => ({ amount: '0' }));
  return b?.amount || '0';
}

// Progress bar function
const drawProgressBar = (current, total, width = 30) => {
  const progress = Math.min(current / total, 1);
  const filled = Math.floor(progress * width);
  const empty = width - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  const percentage = (progress * 100).toFixed(1);
  return `${colors.cyan}[${bar}]${colors.reset} ${colors.bright}${percentage}%${colors.reset} (${current}/${total})`;
};

// Main Bot Class
class EMPEBot {
  constructor() {
    this.client = null;
    this.address = null;
    this.stats = { total: 0, ok: 0, fail: 0 };
    this.isRunning = false;
    this.startTime = new Date();
  }

  // Enhanced logging with better formatting
  log(type, message, showTime = true) {
    const timestamp = showTime ? `${colors.gray}[${new Date().toLocaleTimeString()}]${colors.reset} ` : '';
    const types = {
      info: `${colors.blue}ℹ${colors.reset}`,
      success: `${colors.green}✓${colors.reset}`,
      error: `${colors.red}✗${colors.reset}`,
      warning: `${colors.yellow}⚠${colors.reset}`,
      stake: `${colors.magenta}♦${colors.reset}`,
      transfer: `${colors.cyan}→${colors.reset}`,
      claim: `${colors.yellow}$${colors.reset}`
    };
    const icon = types[type] || `${colors.white}•${colors.reset}`;
    console.log(`${timestamp}${icon} ${message}`);
  }

  // Separator lines
  separator(char = '─', length = 60, color = colors.gray) {
    console.log(`${color}${char.repeat(length)}${colors.reset}`);
  }

  // Header with logo
  showHeader() {
    clearScreen();
    console.log(ASCII_LOGO);
    this.separator('═', 60, colors.cyan);
    console.log(`${colors.bright}Chain:${colors.reset} ${colors.cyan}${CHAIN_ID}${colors.reset}`);
    console.log(`${colors.bright}RPC:${colors.reset} ${colors.dim}${RPC}${colors.reset}`);
    if (this.address) {
      console.log(`${colors.bright}Wallet:${colors.reset} ${colors.cyan}${this.address.slice(0, 12)}...${this.address.slice(-8)}${colors.reset}`);
    }
    this.separator('═', 60, colors.cyan);
  }

  // Load mnemonic from file
  loadMnemonic() {
    try {
      const mnemonicPath = path.resolve(process.cwd(), 'mnemonic.txt');
      if (!fs.existsSync(mnemonicPath)) {
        this.log('error', 'mnemonic.txt tidak ditemukan!');
        console.log(`${colors.yellow}💡 Buat file mnemonic.txt dan masukkan seed phrase Anda${colors.reset}`);
        process.exit(1);
      }
      const mnemonic = fs.readFileSync(mnemonicPath, 'utf8').trim();
      if (!mnemonic) {
        this.log('error', 'mnemonic.txt kosong!');
        process.exit(1);
      }
      return mnemonic;
    } catch (error) {
      this.log('error', `Gagal membaca mnemonic.txt: ${error.message}`);
      process.exit(1);
    }
  }

  // Connect to network with loading animation
  async connect() {
    try {
      const mnemonic = this.loadMnemonic();
      
      // Loading animation
      process.stdout.write(`${colors.blue}🔄 Menghubungkan ke network`);
      const loadingInterval = setInterval(() => {
        process.stdout.write('.');
      }, 500);

      const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, { prefix: PREFIX });
      const [acc] = await wallet.getAccounts();
      
      this.client = await SigningStargateClient.connectWithSigner(RPC, wallet, {
        gasPrice: GasPrice.fromString(GAS_PRICE),
        broadcastTimeoutMs: BROADCAST_TIMEOUT_MS
      });
      
      const netChainId = await this.client.getChainId();
      this.address = acc.address;
      
      clearInterval(loadingInterval);
      console.log(''); // New line
      
      this.log('success', `Terhubung ke ${colors.bright}${netChainId}${colors.reset}`);
      
      await this.showBalance();
      return true;
    } catch (error) {
      this.log('error', `Koneksi gagal: ${error.message}`);
      return false;
    }
  }

  // Show current balance with formatting
  async showBalance() {
    try {
      const balance = await getBalance(this.client, this.address);
      const balanceFormatted = parseFloat(fromMicro(balance)).toFixed(6);
      this.log('info', `Saldo: ${colors.bright}${colors.green}${balanceFormatted} EMPE${colors.reset}`);
    } catch (error) {
      this.log('warning', `Gagal cek saldo: ${error.message}`);
    }
  }

  // Enhanced statistics display
  showStats() {
    if (this.stats.total === 0) return;
    
    const successRate = ((this.stats.ok / this.stats.total) * 100).toFixed(1);
    const uptime = Math.floor((new Date() - this.startTime) / 1000);
    const uptimeStr = `${Math.floor(uptime / 60)}m ${uptime % 60}s`;
    
    this.separator('─', 50, colors.gray);
    console.log(`${colors.bright}📊 STATISTIK${colors.reset}`);
    console.log(`${colors.green}✓ Berhasil:${colors.reset} ${colors.bright}${this.stats.ok}${colors.reset}`);
    console.log(`${colors.red}✗ Gagal:${colors.reset} ${colors.bright}${this.stats.fail}${colors.reset}`);
    console.log(`${colors.cyan}📈 Success Rate:${colors.reset} ${colors.bright}${successRate}%${colors.reset}`);
    console.log(`${colors.yellow}⏱ Runtime:${colors.reset} ${colors.bright}${uptimeStr}${colors.reset}`);
    this.separator('─', 50, colors.gray);
  }

  // Update statistics
  updateStats(success) {
    this.stats.total += 1;
    if (success) this.stats.ok += 1; else this.stats.fail += 1;
  }

  // Auto Transfer with progress tracking
  async autoTransfer(amount, count) {
    console.log('');
    this.separator('═', 60, colors.cyan);
    console.log(`${colors.bright}${colors.cyan}🚀 AUTO TRANSFER${colors.reset}`);
    console.log(`${colors.bright}Amount:${colors.reset} ${colors.green}${amount} EMPE${colors.reset}`);
    console.log(`${colors.bright}Count:${colors.reset} ${colors.yellow}${count}x${colors.reset}`);
    this.separator('═', 60, colors.cyan);

    this.isRunning = true;

    for (let i = 1; i <= count; i++) {
      if (!this.isRunning) break;
      
      const recipient = genRandomAddress();
      const micro = toMicro(amount);
      
      // Progress bar
      console.log(`\n${drawProgressBar(i - 1, count)}`);
      
      try {
        process.stdout.write(`${colors.transfer} Transfer ${i}/${count} → ${colors.dim}${recipient.slice(0, 8)}...${recipient.slice(-6)}${colors.reset}`);
        
        const result = await this.client.sendTokens(
          this.address, 
          recipient, 
          coins(micro, DENOM), 
          'auto', 
          ''
        );
        
        console.log(` ${colors.green}✓${colors.reset}`);
        this.log('success', `TxHash: ${colors.dim}${result.transactionHash}${colors.reset}`, false);
        this.updateStats(true);
      } catch (error) {
        console.log(` ${colors.red}✗${colors.reset}`);
        this.log('error', `${error.message}`, false);
        this.updateStats(false);
      }
      
      if (i < count) await sleep(2000);
    }

    console.log(`\n${drawProgressBar(count, count)}`);
    this.log('success', `${colors.bright}🎉 Auto Transfer Selesai!${colors.reset}`);
    
    await this.showBalance();
    this.showStats();
    this.isRunning = false;
  }

  // Auto Delegate with enhanced display
  async autoDelegate(amount, count) {
    console.log('');
    this.separator('═', 60, colors.magenta);
    console.log(`${colors.bright}${colors.magenta}🥩 AUTO DELEGATE${colors.reset}`);
    console.log(`${colors.bright}Amount:${colors.reset} ${colors.green}${amount} EMPE${colors.reset}`);
    console.log(`${colors.bright}Count:${colors.reset} ${colors.yellow}${count}x${colors.reset}`);
    this.separator('═', 60, colors.magenta);

    this.isRunning = true;

    // Get validators with loading
    let validators = [];
    try {
      process.stdout.write(`${colors.blue}🔄 Mengambil daftar validator`);
      const loadingInterval = setInterval(() => process.stdout.write('.'), 300);
      
      validators = await fetchBondedValidators(200);
      
      clearInterval(loadingInterval);
      console.log(''); // New line
      this.log('success', `Ditemukan ${colors.bright}${validators.length}${colors.reset} validator aktif`);
    } catch (error) {
      this.log('error', `Gagal ambil validator: ${error.message}`);
      return;
    }

    if (!validators.length) {
      this.log('error', 'Tidak ada validator yang tersedia');
      return;
    }

    for (let i = 1; i <= count; i++) {
      if (!this.isRunning) break;
      
      const validator = validators[Math.floor(Math.random() * validators.length)];
      const validatorAddr = validator.operator_address;
      const validatorName = validator.description?.moniker || 'Unknown';
      
      console.log(`\n${drawProgressBar(i - 1, count)}`);
      
      try {
        process.stdout.write(`${colors.stake} Delegate ${i}/${count} → ${colors.dim}${validatorName}${colors.reset}`);
        
        const result = await this.client.delegateTokens(
          this.address,
          validatorAddr,
          { denom: DENOM, amount: toMicro(amount) },
          'auto',
          ''
        );
        
        console.log(` ${colors.green}✓${colors.reset}`);
        this.log('success', `TxHash: ${colors.dim}${result.transactionHash}${colors.reset}`, false);
        this.updateStats(true);
      } catch (error) {
        console.log(` ${colors.red}✗${colors.reset}`);
        this.log('error', `${error.message}`, false);
        this.updateStats(false);
      }
      
      if (i < count) await sleep(2000);
    }

    console.log(`\n${drawProgressBar(count, count)}`);
    this.log('success', `${colors.bright}🎉 Auto Delegate Selesai!${colors.reset}`);
    
    await this.showBalance();
    this.showStats();
    this.isRunning = false;
  }

  // Auto Claim with detailed progress
  async autoClaimRewards() {
    console.log('');
    this.separator('═', 60, colors.yellow);
    console.log(`${colors.bright}${colors.yellow}💰 AUTO CLAIM REWARDS${colors.reset}`);
    this.separator('═', 60, colors.yellow);

    this.isRunning = true;

    try {
      process.stdout.write(`${colors.blue}🔄 Mengecek rewards tersedia`);
      const loadingInterval = setInterval(() => process.stdout.write('.'), 300);
      
      const rewardsData = await fetchRewards(this.address);
      
      clearInterval(loadingInterval);
      console.log(''); // New line
      
      const totalRewards = parseFloat(fromMicro(rewardsData.total)).toFixed(6);
      this.log('info', `Total rewards: ${colors.bright}${colors.green}${totalRewards} EMPE${colors.reset}`);
      
      const validators = rewardsData.perVal
        .filter(x => Number(x.amount || '0') > 0)
        .map(x => x.validator);
      
      if (!validators.length) {
        this.log('warning', 'Tidak ada rewards untuk diklaim');
        this.isRunning = false;
        return;
      }

      const totalBatches = Math.ceil(validators.length / CLAIM_CHUNK);
      this.log('info', `Memproses ${colors.bright}${validators.length}${colors.reset} validator dalam ${colors.bright}${totalBatches}${colors.reset} batch`);
      
      // Process in chunks with progress
      for (let i = 0; i < validators.length; i += CLAIM_CHUNK) {
        if (!this.isRunning) break;
        
        const batchNum = Math.floor(i / CLAIM_CHUNK) + 1;
        const chunk = validators.slice(i, i + CLAIM_CHUNK);
        
        console.log(`\n${drawProgressBar(batchNum - 1, totalBatches)}`);
        
        const msgs = chunk.map(validatorAddress => ({
          typeUrl: '/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward',
          value: { 
            delegatorAddress: this.address, 
            validatorAddress 
          }
        }));

        try {
          process.stdout.write(`${colors.claim} Claiming batch ${batchNum}/${totalBatches} (${chunk.length} validators)`);
          
          const result = await this.client.signAndBroadcast(this.address, msgs, 'auto');
          
          if (result.code === 0) {
            console.log(` ${colors.green}✓${colors.reset}`);
            this.log('success', `TxHash: ${colors.dim}${result.transactionHash}${colors.reset}`, false);
            this.updateStats(true);
          } else {
            console.log(` ${colors.red}✗${colors.reset}`);
            this.log('error', `${result.rawLog}`, false);
            this.updateStats(false);
          }
        } catch (error) {
          console.log(` ${colors.red}✗${colors.reset}`);
          this.log('error', `${error.message}`, false);
          this.updateStats(false);
        }
        
        if (i + CLAIM_CHUNK < validators.length) await sleep(2000);
      }

      console.log(`\n${drawProgressBar(totalBatches, totalBatches)}`);
      this.log('success', `${colors.bright}🎉 Auto Claim Rewards Selesai!${colors.reset}`);
      
      await this.showBalance();
      this.showStats();
      
    } catch (error) {
      this.log('error', `Gagal claim rewards: ${error.message}`);
    }

    this.isRunning = false;
  }

  // Enhanced menu
  showMenu() {
    console.log('\n');
    this.separator('═', 60, colors.cyan);
    console.log(`${colors.bright}${colors.cyan}         🤖 MENU UTAMA 🤖${colors.reset}`);
    this.separator('═', 60, colors.cyan);
    console.log(`  ${colors.green}[1]${colors.reset} ${colors.bright}Auto Transfer${colors.reset}     - Kirim ke random address`);
    console.log(`  ${colors.magenta}[2]${colors.reset} ${colors.bright}Auto Delegate${colors.reset}     - Delegate ke validator`);
    console.log(`  ${colors.yellow}[3]${colors.reset} ${colors.bright}Auto Claim${colors.reset}        - Claim semua rewards`);
    console.log(`  ${colors.blue}[4]${colors.reset} ${colors.bright}Cek Saldo${colors.reset}         - Tampilkan saldo saat ini`);
    console.log(`  ${colors.red}[5]${colors.reset} ${colors.bright}Exit${colors.reset}              - Keluar dari bot`);
    this.separator('═', 60, colors.cyan);
  }

  // Get user input with prompt styling
  async getUserInput(question) {
    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise((resolve) => {
      rl.question(`${colors.bright}${colors.cyan}❯${colors.reset} ${question}`, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });
  }

  // Main application loop
  async start() {
    this.showHeader();
    
    const connected = await this.connect();
    if (!connected) {
      this.log('error', 'Gagal terhubung ke network');
      console.log(`\n${colors.red}Tekan Enter untuk keluar...${colors.reset}`);
      await this.getUserInput('');
      process.exit(1);
    }

    while (true) {
      this.showMenu();
      const choice = await this.getUserInput('Pilih menu (1-5): ');

      switch (choice) {
        case '1':
          const transferAmount = await this.getUserInput('Masukkan jumlah per transfer (EMPE): ');
          const transferCount = await this.getUserInput('Masukkan jumlah transaksi: ');
          
          if (transferAmount && transferCount && !isNaN(transferAmount) && !isNaN(transferCount)) {
            await this.autoTransfer(parseFloat(transferAmount), parseInt(transferCount));
          } else {
            this.log('error', 'Input tidak valid');
          }
          break;

        case '2':
          const delegateAmount = await this.getUserInput('Masukkan jumlah per delegasi (EMPE): ');
          const delegateCount = await this.getUserInput('Masukkan jumlah delegasi: ');
          
          if (delegateAmount && delegateCount && !isNaN(delegateAmount) && !isNaN(delegateCount)) {
            await this.autoDelegate(parseFloat(delegateAmount), parseInt(delegateCount));
          } else {
            this.log('error', 'Input tidak valid');
          }
          break;

        case '3':
          await this.autoClaimRewards();
          break;

        case '4':
          await this.showBalance();
          break;

        case '5':
          console.log(`\n${colors.bright}${colors.green}👋 Terima kasih telah menggunakan EMPEIRIA Bot!${colors.reset}`);
          console.log(`${colors.dim}Created by AUTODROP CENTRAL${colors.reset}\n`);
          process.exit(0);

        default:
          this.log('warning', 'Pilihan tidak valid, silakan pilih 1-5');
          break;
      }

      // Pause before showing menu again
      console.log(`\n${colors.dim}Tekan Enter untuk melanjutkan...${colors.reset}`);
      await this.getUserInput('');
      this.showHeader();
      if (this.address) await this.showBalance();
    }
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log(`\n\n${colors.red}🛑 Bot dihentikan oleh user${colors.reset}`);
  console.log(`${colors.dim}Goodbye! 👋${colors.reset}\n`);
  process.exit(0);
});

process.on('unhandledRejection', (error) => {
  console.log(`${colors.red}❌ Unhandled rejection:${colors.reset} ${error.message}`);
});

// Start the bot
const bot = new EMPEBot();
bot.start().catch(error => {
  console.log(`${colors.red}❌ Fatal error:${colors.reset} ${error.message}`);
  process.exit(1);
});