# Migrasi ke MySQL

Target yang diuji: **MySQL Community 8.4.13 LTS**, InnoDB, `utf8mb4`, collation `utf8mb4_0900_bin`, waktu UTC. MariaDB bukan target. Patch Compose dikunci; tinjau pembaruan keamanan sebelum mengganti image.

Frontend dan bentuk request/response tetap sama. Backend menggunakan `mysql2`, schema MySQL Drizzle, dan adapter Better Auth `mysql`. Aturan pajak, full redeem, customer Accurate, biaya bank, No. Bukti, konfirmasi Finance, serta pemeriksaan duplikasi tetap berlaku.

## Data yang dipindahkan

- Identitas pengguna: ID, nama, email, verifikasi email, role, status aktif, gambar, dan tanggal.
- Akun `credential` beserta **hash password yang sudah ada**, tanpa mengubah password atau hak akses.
- Sesi login, OTP, token reset/OAuth, invoice, dokumen upload, mapping, kredensial Accurate, audit lama, dan antrean **tidak disalin**.

Pengguna login ulang memakai password sebelumnya. Pengguna nonaktif tetap nonaktif. Import mensyaratkan minimal satu super admin aktif dengan akun password. Jika tidak ada, selesaikan pengelolaan akun pada sistem lama terlebih dahulu.

## Backup dan export

Hentikan API/worker sebelum backup atau export PGlite; jangan membuka direktori PGlite dari dua proses. Export PostgreSQL memakai transaksi read-only dengan snapshot konsisten. Simpan backup sumber dan `.env` privat di luar Git. Jangan hapus database lama sebelum verifikasi selesai.

Migration PostgreSQL tetap disimpan di `src/db/migrations/` sebagai arsip. Runtime dan Drizzle Kit MySQL hanya memakai **`src/db/migrations/mysql/`**, dengan jurnal tersendiri. Jangan menerapkan SQL atau menyalin jurnal PostgreSQL ke MySQL.

Jalankan export pada checkout migrasi dengan dependency pengembangan terpasang (`npm ci`). Driver PostgreSQL/PGlite hanya menjadi dependency pengembangan untuk export dan tes; API produksi tidak membukanya.

Siapkan environment privat:

- `SOURCE_DATABASE_URL`: URL PostgreSQL atau `pglite:` dengan path absolut ke sumber lama.
- `DATABASE_URL`: URL MySQL untuk konfigurasi aplikasi baru; export tidak membukanya.
- `USER_TRANSFER_KEY`: kunci acak 64 karakter hex, sama saat export/import. Jika tidak diisi, tooling memakai `ENCRYPTION_KEY`.

```sh
npm run db:export:users -- data/mysql-login-users.encrypted.json
```

File memakai AES-256-GCM, tanpa email/hash plaintext, dan tidak menimpa file yang sudah ada. Tetap perlakukan file sebagai rahasia. Salurkan file dan kunci melalui kanal privat terpisah. Jangan push export, `.env`, atau kunci; jangan tulis URL/password asli pada command line, issue, PR, atau chat.

## Database tujuan

Buat database MySQL baru:

```sql
CREATE DATABASE intgrte CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
```

Gunakan user aplikasi tersendiri, bukan root. Job migration membutuhkan DDL; API/worker membutuhkan akses baca/tulis. Jika haknya dipisah, jalankan job dengan URL user migration, lalu jalankan API memakai URL user runtime.

Untuk koneksi TLS, atur `DATABASE_SSL=true`. Jika CA privat diperlukan, gunakan `NODE_EXTRA_CA_CERTS`; jangan menonaktifkan verifikasi sertifikat.

```sh
npm ci
npm run build
node dist/db/migrate.js
node dist/db/import-users.js data/mysql-login-users.encrypted.json
```

Import hanya diizinkan pada target tanpa pengguna atau data bisnis/configuration. Seluruh import berada dalam satu transaksi dengan mutex, validasi, dan audit ringkasan. Import ulang ditolak tanpa menimpa akun; kegagalan tidak meninggalkan sebagian akun. Untuk environment tanpa akun lama, gunakan `node dist/db/seed-admin.js` **sebagai pengganti import**. Jangan menjalankan seed demo.

Migration hanya mengisi jurnal internal dan baris `application_locks` untuk bootstrap. API tidak menjalankan migration otomatis pada startup.

## Perusahaan awal dan integrasi

Import akun tidak membuat perusahaan/cabang. Agar perusahaan dapat dipilih pada UI yang sudah ada, siapkan `SETUP_COMPANY_ID`, `SETUP_COMPANY_NAME`, dan `SETUP_CENTER_ID`, lalu jalankan:

```sh
node dist/db/setup-company.js
```

Perintah opsional ini terpisah dari import akun, hanya membuat perusahaan kosong tanpa invoice/kredensial. ID yang sudah ada tidak ditimpa dan center berbeda ditolak. Setelahnya, login dan lengkapi koneksi Accurate, tujuan perusahaan, serta akun penerimaan di Settings sebelum upload.

## Pemeriksaan dan pengujian

1. Login dengan akun lama; periksa role dan status aktif.
2. Periksa `/api/health`, Dashboard, Settings, serta riwayat faktur/penerimaan yang kosong.
3. Siapkan perusahaan dan integrasi, lalu uji upload, review, full redeem, pengiriman faktur, dan penerimaan pada tujuan uji yang disetujui.
4. Cocokkan tarif, pembulatan biaya, No. Bukti, keterangan, bruto/netto, saldo piutang, dan rekonsiliasi tanpa POST ulang.
5. Siapkan Resend untuk OTP, penyimpanan persisten `data/imports`, backup MySQL, serta pengelolaan secret.

Timestamp memakai UTC `datetime(3)`; tampilan tanggal tetap WIB. Repository mengganti `RETURNING` dengan pemeriksaan affected rows dan pembacaan kembali. Konflik yang diabaikan dibatasi ke duplicate key; tidak memakai `INSERT IGNORE` yang dapat menyembunyikan kesalahan data. Transaksi, `FOR UPDATE SKIP LOCKED`, payload beku, penanda upaya sebelum POST, version check, audit, dan rekonsiliasi tetap dipertahankan.

Isi `TEST_DATABASE_URL` pada environment atau `.env.test.local` privat. Akun test harus dapat membuat/menghapus schema `imp_test_*` di server test. Helper tidak memakai `DATABASE_URL` aplikasi. Setiap proses mendapat schema baru dan vendor tetap ditiru:

```sh
npm test
npm run typecheck
npm run build
```

Fixture browser juga memerlukan `TEST_DATABASE_URL` dan membuat schema sementara. Ikuti README frontend untuk Playwright; jangan gunakan akun production.

Untuk instalasi portable Windows yang sudah diinisialisasi, `scripts/start-mysql-local.ps1` dapat menjalankan ulang server dari descriptor privat `data/mysql-local-runtime.json` (path `binary`, `dataDirectory`, dan `port`, tanpa password). Script hanya bind ke loopback dan tidak menginisialisasi atau mereset database. Lokal migrasi ini memakai port 3307; instalasi Compose memakai 3306. Jangan menghapus folder binary portable ketika masih digunakan. Descriptor dan data mesin tidak masuk Git.

## Pemulihan

Audit dependency pada checkout ini masih melaporkan advisory pada dependency lama (`body-parser`, `multer`, serta rantai dependency Drizzle Kit). Driver `mysql2` tidak tercantum dalam temuan tersebut. Tinjau patch dependency ini sebelum deployment production; keberhasilan tes migrasi bukan hasil audit keamanan menyeluruh.

DDL MySQL dapat ter-commit per statement. Jika migration gagal, hentikan job/API/worker, periksa statement yang gagal, lalu pulihkan backup atau siapkan perbaikan DDL yang ditinjau. Jangan menganggap seluruh migration sudah rollback, mereset database, atau mengulang SQL tanpa pemeriksaan.

Rollback aplikasi membutuhkan checkout PostgreSQL lama, database lama, dan secret aslinya. Jangan jalankan aplikasi PostgreSQL terhadap MySQL. Jika MySQL sudah menerima transaksi baru, rollback membutuhkan rekonsiliasi karena kedua database tidak disinkronkan.

Referensi: [rilis MySQL 8.4](https://dev.mysql.com/doc/relnotes/mysql/8.4/en/), [Drizzle MySQL](https://orm.drizzle.team/docs/get-started/mysql-new), [locking MySQL](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html).
