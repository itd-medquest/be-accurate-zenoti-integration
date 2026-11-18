# intgrte — Backend

API dan worker untuk membaca invoice Zenoti, mengelola pemeriksaan Finance, serta mengirim Faktur Penjualan ke Accurate Online. Dibangun dengan Express, TypeScript, Better Auth, Drizzle ORM, dan MySQL 8.4 LTS.

## Alur utama

1. Upload PDF/Excel menghasilkan draft dan preview; upload belum memasukkan transaksi ke antrean pengiriman.
2. Finance memeriksa item, total, status invoice, serta mapping customer dan item Accurate.
3. Submit memvalidasi draft dan menyiapkan pengiriman melalui worker.
4. Hasil pengiriman dan kegagalan tercatat untuk pemeriksaan serta audit.

Item dengan penanda redeemed dan Consultation gratis tidak dikirim ke Accurate. Invoice full redeem disimpan secara lokal; invoice campuran hanya mengirim item yang memenuhi ketentuan pengakuan. Nomor faktur yang sudah digunakan di Accurate ditahan untuk pemeriksaan duplikat. Faktur dan Penerimaan Penjualan mempunyai pemeriksaan, konfirmasi pengiriman, serta antrean tersendiri.

### Penerimaan Penjualan

Pembayaran dari invoice yang faktur Accurate-nya sudah terverifikasi dapat direview, disimpan sebagai draft, dan dikirim setelah konfirmasi Finance. Settings menyediakan mapping akun kas/bank dan biaya per perusahaan, bank, dan metode. Tarif BCA/BNI: CC 2%, debit 1,8%, QRIS 0,7%, transfer langsung 0%; pecahan biaya selalu dibulatkan ke atas. Antrean receipt memeriksa saldo terbaru dan memverifikasi hasil tanpa menjalankan ulang pengiriman faktur. Hasil pengiriman yang belum pasti direkonsiliasi melalui pembacaan vendor. Lihat [alur, kontrak API, dan batas UAT receipt](docs/sales-receipts.md).

### Customer Accurate baru

Super Admin dapat membuat customer ketika pencarian saat review invoice tidak menemukan hasil. `GET /api/accurate/imports/:batchId/rows/:rowId/customer/prepare?version=...` memindai seluruh halaman customer dengan urutan ID Accurate descending dan mengambil akhiran MPA numerik terbesar + 1. Master aktif harus cocok tepat satu: kategori `Astetic`, cabang `PT Mylab Prima Inovatif`, mata uang `IDR`, kategori harga/diskon `Umum`, dan syarat pembayaran `C.O.D`. Pemetaan kategori diskon mengikuti master kategori harga pada collection API. Cabang tersebut harus sesuai dengan tujuan invoice; jika nomor MPA belum tersedia, penomoran perlu diperiksa di Accurate terlebih dahulu.

`POST /api/accurate/imports/:batchId/rows/:rowId/customer` menerima `requestId`, `version`, `databaseId`, `customerNo`, dan `name`. Backend memvalidasi ulang nomor, nama duplikat, master default, koneksi aktual, dan draft sebelum mengirim hanya field Umum/Penjualan ke `customer/save.do`. Permintaan dicatat secara durable di audit sebelum POST. Permintaan ulang dengan identitas yang sama hanya memeriksa hasil di Accurate; respons yang belum pasti tidak memicu POST ulang. Nomor/nama yang sedang diproses ditahan agar tidak dipakai dua permintaan bersamaan. Customer yang sudah dibuat tetapi mapping-nya gagal dapat digunakan kembali melalui tombol Gunakan customer atau pencarian biasa. Invoice tetap menunggu pemeriksaan dan submit. Tidak ada perubahan schema database untuk fitur ini.

## Persyaratan

- Node.js **22.16 atau lebih baru** dan npm.
- MySQL 8.4 LTS (InnoDB); Docker Compose menyediakan MySQL 8.4.13 untuk lokal.

Frontend terkait: [accurate-zenoti-integration](https://github.com/itd-medquest/accurate-zenoti-integration). Clone sebagai folder `frontend` dan `backend` yang berdampingan jika menjalankan pengujian integrasi frontend.

## Setup lokal dengan MySQL

```powershell
git clone https://github.com/itd-medquest/be-accurate-zenoti-integration.git backend
cd backend
npm ci
Copy-Item .env.example .env
```

Lengkapi `.env`, terutama secret autentikasi, kunci enkripsi, serta akun seed lokal. Samakan password pada `DATABASE_URL` dan `MYSQL_PASSWORD`; atur `MYSQL_ROOT_PASSWORD` terpisah untuk Compose.

Untuk membuat nilai acak, jalankan perintah berikut dua kali: gunakan satu hasil untuk `BETTER_AUTH_SECRET` dan hasil yang berbeda untuk `ENCRYPTION_KEY`.

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Jalankan database, migrasi, dan seed pengembangan:

```powershell
docker compose up -d mysql
npm run db:migrate
npm run db:seed:admin
npm run db:setup:company
npm run dev
```

API tersedia di `http://localhost:4000`. Endpoint pemeriksaan layanan: `GET /api/health`. Seed khusus admin membuat akun awal tanpa invoice. Setup perusahaan memerlukan SETUP_COMPANY_ID/NAME dan SETUP_CENTER_ID. Untuk data demo di database pengembangan terpisah, `npm run db:seed` tetap tersedia.

### Deployment dengan database kosong

Struktur database dapat dibuat dari migration di repository tanpa membawa data lokal. Untuk environment baru, jalankan migration lalu `npm run db:seed:admin` agar hanya akun super admin pertama yang dibuat, tanpa akun demo atau invoice simulasi. Panduan konfigurasi, perintah hasil build untuk runtime, dan perilaku saat seed dijalankan ulang tersedia di [panduan deployment](docs/deployment.md).

### Memindahkan akun lokal lama

Gunakan export terenkripsi dan import ke MySQL kosong. Password, role, dan status akun dipertahankan; invoice, history, sesi, serta konfigurasi Accurate tidak disalin. Migration PostgreSQL lama tetap diarsipkan; hanya folder `src/db/migrations/mysql/` dijalankan. Ikuti [panduan migrasi MySQL](docs/mysql-migration.md).

## Konfigurasi environment

Lihat `.env.example` untuk seluruh variabel dan contoh nilainya.

| Variabel                                                     | Kegunaan                                                                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                                                       | Port API, default lokal `4000`                                                                                            |
| `FRONTEND_URL`                                               | Origin frontend yang diizinkan, default `http://localhost:3000`                                                           |
| `BETTER_AUTH_URL`                                            | Alamat publik backend untuk autentikasi                                                                                   |
| `BETTER_AUTH_SECRET`                                         | Secret autentikasi, minimal 32 karakter                                                                                   |
| `DATABASE_URL`                                               | Koneksi `mysql://` ke MySQL 8.4 LTS                                                                                       |
| `DATABASE_SSL`                                               | `true` untuk TLS dengan verifikasi sertifikat; default `false` untuk lokal                                                |
| `ENCRYPTION_KEY`                                             | Kunci enkripsi kredensial, 64 karakter heksadesimal; pertahankan untuk membaca kredensial yang sudah tersimpan            |
| `INTEGRATION_MODE`                                           | Mode dasar `simulation` atau `live`; koneksi Accurate aktual dikelola secara eksplisit melalui Settings                   |
| `RUN_WORKER`                                                 | `true` untuk worker dalam proses API                                                                                      |
| `IMPORT_PACKAGE_TAX_POLICY`                                  | Kebijakan alokasi pajak paket; contoh lokal menggunakan `proportional`                                                    |
| `SEED_ADMIN_NAME`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | Nama opsional, email, dan password bootstrap admin; `db:seed:admin` hanya membuat admin pertama, password 12–128 karakter |
| `RESEND_API_KEY`, `RESEND_FROM`                              | Konfigurasi pengiriman email reset password                                                                               |

API Token dan Signature Secret Accurate diisi melalui Settings dan disimpan terenkripsi. Simulasi tidak memerlukan API Zenoti; sumber invoice pada alur upload berasal dari PDF/Excel. Parsing PDF dan fallback OCR diproses secara lokal menggunakan dependency yang terpasang.

Pemulihan password menggunakan OTP melalui Resend dan memerlukan `RESEND_API_KEY` serta `RESEND_FROM` dari domain terverifikasi untuk penerima anggota tim. Tambah pengguna saat ini memakai password awal dari admin; undangan/aktivasi melalui email belum tersedia. Lihat [hasil audit email dan OTP](docs/email-readiness.md) untuk konfigurasi, hasil pengujian, dan kebutuhan reverse proxy serta pengiriman email.

File invoice sumber tersimpan secara privat di `data/imports`. Siapkan penyimpanan persisten untuk data tersebut saat deployment dan jangan memasukkannya ke Git.

## Perintah

Jalankan dari direktori repository backend.

| Perintah                   | Kegunaan                                                                       |
| -------------------------- | ------------------------------------------------------------------------------ |
| `npm run dev`              | Menjalankan API dengan pemantauan perubahan source                             |
| `npm run typecheck`        | Memeriksa TypeScript                                                           |
| `npm test`                 | Menjalankan pengujian backend                                                  |
| `npm run build`            | Membuat output `dist/` dan menyalin migrasi                                    |
| `npm start`                | Menjalankan hasil build                                                        |
| `npm run db:migrate`       | Menerapkan migrasi database                                                    |
| `npm run db:generate`      | Membuat migrasi dari perubahan schema                                          |
| `npm run db:seed`          | Menyiapkan akun dan data contoh pengembangan                                   |
| `npm run db:seed:admin`    | Membuat super admin pertama tanpa data demo; tidak mereset akun yang sudah ada |
| `npm run db:setup:company` | Menambahkan perusahaan kosong untuk dikonfigurasi di Settings                  |
| `npm run db:export:users`  | Export akun PostgreSQL/PGlite terenkripsi                                      |
| `npm run db:import:users`  | Import akun ke MySQL baru tanpa menimpa pengguna                               |
| `npm run worker`           | Worker terpisah, menggunakan MySQL                                             |

Jika menggunakan worker terpisah, atur `RUN_WORKER=false` pada proses API. Untuk deployment, gunakan MySQL dan konfigurasi environment tujuan, jalankan migration yang sudah ditinjau, lalu bootstrap super admin pertama dengan `db:seed:admin` sesuai [panduan deployment](docs/deployment.md). Seed pengembangan `db:seed` bukan bagian dari langkah deployment.

## Pengujian integrasi frontend

Siapkan `TEST_DATABASE_URL` pada environment atau `.env.test.local` privat. Tes membuat schema MySQL `imp_test_*` tersendiri dan tidak memakai database aplikasi.

Backend menyediakan fixture di `test/helpers/browser-server.ts` dengan database sementara dan respons Accurate tiruan:

```powershell
npx tsx scripts/prepare-import-assets.ts
$env:ACCURATE_MOCK_SERVER = 'true'
npx tsx test/helpers/browser-server.ts
```

Fixture memerlukan konfigurasi akun seed lokal di `.env`, berjalan di port `4001`, dan menggunakan frontend di port `3001`. Script template menulis contoh Excel anonim ke `../../docs/templates/`. Ikuti README frontend untuk menjalankan web dan Playwright dengan alamat fixture tersebut.

## Struktur project

```text
src/
  routes/         Endpoint API
  validations/    Schema dan validasi request
  controllers/    Penerjemahan HTTP
  services/       Aturan bisnis dan orkestrasi transaksi
  repositories/   Akses database
  db/             Koneksi, schema, migrasi, dan seed
  config/         Konfigurasi environment
  middlewares/    Autentikasi, otorisasi, dan penanganan error
  utils/          Parser dan perhitungan bersama
test/             Pengujian backend dan fixture
scripts/          Build, ekstraksi PDF, dan utilitas lokal
```

Alur request: **route → validasi → controller → service → repository → database**. Pertahankan audit, versioning, idempotency, dan validasi total ketika mengubah alur invoice.

## Git Rules

Buat branch untuk setiap perubahan, sertakan migrasi bila diperlukan, jalankan `npm run typecheck`, `npm test`, dan `npm run build`, lalu ajukan pull request. Pertahankan `package-lock.json` dan riwayat migrasi. Environment lokal, kredensial, database, dokumen sumber, dan hasil build/testing tidak disertakan dalam commit.
