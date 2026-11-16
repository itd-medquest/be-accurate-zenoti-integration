# intgrte — Backend

API dan worker untuk membaca invoice Zenoti, mengelola pemeriksaan Finance, serta mengirim Faktur Penjualan ke Accurate Online. Dibangun dengan Express, TypeScript, Better Auth, Drizzle ORM, dan PostgreSQL.

## Alur utama

1. Upload PDF/Excel menghasilkan draft dan preview; upload belum memasukkan transaksi ke antrean pengiriman.
2. Finance memeriksa item, total, status invoice, serta mapping customer dan item Accurate.
3. Submit memvalidasi draft dan menyiapkan pengiriman melalui worker.
4. Hasil pengiriman dan kegagalan tercatat untuk pemeriksaan serta audit.

Item dengan penanda redeemed dan Consultation gratis tidak dikirim ke Accurate. Invoice full redeem disimpan secara lokal; invoice campuran hanya mengirim item yang memenuhi ketentuan pengakuan. Nomor faktur yang sudah digunakan di Accurate ditahan untuk pemeriksaan duplikat. Tahap integrasi ini mengirim Faktur Penjualan, belum Penerimaan Penjualan.

## Persyaratan

- Node.js **22.16 atau lebih baru** dan npm.
- PostgreSQL untuk penggunaan bersama dan deployment; Docker Compose tersedia untuk PostgreSQL lokal.
- PGlite tersedia untuk demo lokal dengan satu proses backend.

Frontend terkait: [accurate-zenoti-integration](https://github.com/itd-medquest/accurate-zenoti-integration). Clone sebagai folder `frontend` dan `backend` yang berdampingan jika menjalankan pengujian integrasi frontend.

## Setup lokal dengan PostgreSQL

```powershell
git clone https://github.com/itd-medquest/be-accurate-zenoti-integration.git backend
cd backend
npm ci
Copy-Item .env.example .env
```

Lengkapi `.env`, terutama secret autentikasi, kunci enkripsi, serta akun seed lokal. Contoh `DATABASE_URL` sesuai layanan PostgreSQL pada `compose.yaml` dengan konfigurasi default lokal.

Untuk membuat nilai acak, jalankan perintah berikut dua kali: gunakan satu hasil untuk `BETTER_AUTH_SECRET` dan hasil yang berbeda untuk `ENCRYPTION_KEY`.

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Jalankan database, migrasi, dan seed pengembangan:

```powershell
docker compose up -d postgres
npm run db:migrate
npm run db:seed
npm run dev
```

API tersedia di `http://localhost:4000`. Endpoint pemeriksaan layanan: `GET /api/health`. Seed membuat akun lokal dan contoh invoice simulasi; gunakan database pengembangan untuk langkah ini.

### Alternatif demo tanpa PostgreSQL

Pada clone baru yang belum memiliki `.env`:

```powershell
npm ci
npm run demo:setup
npm run build
npm start
```

`demo:setup` membuat `.env` dengan nilai acak jika belum ada, lalu menjalankan migrasi dan seed. Jika `.env` sudah ada, konfigurasi tersebut dipertahankan. Akun admin mengikuti `SEED_ADMIN_EMAIL` dan `SEED_ADMIN_PASSWORD` di `.env`.

Demo PGlite menyimpan database di `data/demo`. Gunakan satu proses API dan worker dalam proses yang sama (`RUN_WORKER=true`). Hentikan API sebelum menjalankan migrasi/seed terpisah pada database PGlite tersebut. Script Windows `powershell -ExecutionPolicy Bypass -File scripts/start-local.ps1` memilih build/start untuk PGlite dan mode dev untuk PostgreSQL.

## Konfigurasi environment

Lihat `.env.example` untuk seluruh variabel dan contoh nilainya.

| Variabel | Kegunaan |
| --- | --- |
| `PORT` | Port API, default lokal `4000` |
| `FRONTEND_URL` | Origin frontend yang diizinkan, default `http://localhost:3000` |
| `BETTER_AUTH_URL` | Alamat publik backend untuk autentikasi |
| `BETTER_AUTH_SECRET` | Secret autentikasi, minimal 32 karakter |
| `DATABASE_URL` | Koneksi PostgreSQL atau `pglite:./data/demo` untuk demo lokal |
| `ENCRYPTION_KEY` | Kunci enkripsi kredensial, 64 karakter heksadesimal; pertahankan untuk membaca kredensial yang sudah tersimpan |
| `INTEGRATION_MODE` | Mode dasar `simulation` atau `live`; koneksi Accurate aktual dikelola secara eksplisit melalui Settings |
| `RUN_WORKER` | `true` untuk worker dalam proses API |
| `IMPORT_PACKAGE_TAX_POLICY` | Kebijakan alokasi pajak paket; contoh lokal menggunakan `proportional` |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | Akun seed lokal; password minimal 12 karakter |
| `RESEND_API_KEY`, `RESEND_FROM` | Konfigurasi pengiriman email reset password |

API Token dan Signature Secret Accurate diisi melalui Settings dan disimpan terenkripsi. Simulasi tidak memerlukan API Zenoti; sumber invoice pada alur upload berasal dari PDF/Excel. Parsing PDF dan fallback OCR diproses secara lokal menggunakan dependency yang terpasang.

File invoice sumber tersimpan secara privat di `data/imports`. Siapkan penyimpanan persisten untuk data tersebut saat deployment dan jangan memasukkannya ke Git.

## Perintah

Jalankan dari direktori repository backend.

| Perintah | Kegunaan |
| --- | --- |
| `npm run dev` | Menjalankan API dengan pemantauan perubahan source |
| `npm run typecheck` | Memeriksa TypeScript |
| `npm test` | Menjalankan pengujian backend |
| `npm run build` | Membuat output `dist/` dan menyalin migrasi |
| `npm start` | Menjalankan hasil build |
| `npm run db:migrate` | Menerapkan migrasi database |
| `npm run db:generate` | Membuat migrasi dari perubahan schema |
| `npm run db:seed` | Menyiapkan akun dan data contoh pengembangan |
| `npm run demo:setup` | Menyiapkan demo lokal |
| `npm run worker` | Worker terpisah, hanya untuk PostgreSQL |

Jika menggunakan worker terpisah, atur `RUN_WORKER=false` pada proses API. Untuk deployment, gunakan PostgreSQL, konfigurasi environment deployment, jalankan migrasi yang sudah ditinjau, lalu build/start. Seed pengembangan bukan bagian dari langkah deployment.

## Pengujian integrasi frontend

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
