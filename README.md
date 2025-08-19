
# 🤖 EMPE Testnet Bot - AUTODROP CENTRAAL

Bot otomatis untuk berinteraksi dengan **EMPE Testnet** berbasis Cosmos SDK.  
Dibuat untuk mempermudah pengguna dalam melakukan **transfer, staking, dan klaim reward**.

---

## 🚀 Fitur Utama
- 🔹 **Auto Transfer** → Kirim EMPE ke alamat acak untuk meningkatkan aktivitas on-chain.  
- 🔹 **Auto Delegate** → Delegasi EMPE ke validator aktif secara otomatis.  
- 🔹 **Auto Claim Rewards** → Klaim semua reward staking dalam batch (multi-validator).  
- 🔹 **Cek Saldo** → Menampilkan saldo EMPE terkini.  
- 🔹 **Statistik** → Laporan jumlah transaksi berhasil/gagal dan uptime bot.  

---

## 📦 Instalasi

1. Clone repository:
   ```bash
   git clone https://github.com/AUTODROPCENTRAL/Empeiria-Bot.git
   cd Empeiria-Bot
```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Buat file **mnemonic.txt** di folder root:

   ```
   word1 word2 word3 ... word24
   ```

---

## ⚙️ Konfigurasi

Konfigurasi sudah ada di dalam script:

```js
const RPC       = 'https://rpc-testnet.empe.io';
const LCD       = 'https://lcd-testnet.empe.io';
const CHAIN_ID  = 'empe-testnet-2';
const DENOM     = 'uempe';
const EXPONENT  = 6;
const GAS_PRICE = `0.025${DENOM}`;
const PREFIX    = 'empe';
```

---

## ▶️ Cara Menjalankan

Jalankan bot dengan:

```bash
node index.js
```

Menu interaktif:

```
1. Auto Transfer
2. Auto Delegate
3. Auto Claim Rewards
4. Cek Saldo
5. Exit
```

---

## 📊 Contoh Output

```
ℹ Terhubung ke empe-testnet-2
✓ Saldo: 9.123456 EMPE
─────────────────────────────────────────────
🚀 AUTO TRANSFER
Amount: 0.001 EMPE
Count: 10x
─────────────────────────────────────────────
→ Transfer 1/10 → empe1abcd...xyz123 ✓
→ Transfer 2/10 → empe1pqrs...uv456 ✓
...
🎉 Auto Transfer Selesai!
📊 STATISTIK
✓ Berhasil: 10
✗ Gagal: 0
📈 Success Rate: 100%
⏱ Runtime: 2m 12s
```

---

## 🛑 Catatan

* Bot ini hanya untuk **EMPE Testnet**, jangan gunakan untuk mainnet dengan aset asli.
* **Jaga mnemonic Anda**. Jangan pernah commit `mnemonic.txt` ke GitHub.
* Script ini dibuat untuk **edukasi & testnet farming**.

---

## 👨‍💻 Author

Created by **AUTODROP CENTRAL**



