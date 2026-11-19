# Setup server dev dengan MySQL

Panduan utama DevOps untuk membuat database kosong, akun Super Admin pertama, perusahaan **PT. MMI**, koneksi Accurate, dan **8 mapping akun Penerimaan Penjualan**. Jalankan sesuai urutan; pengaturan lokal pengembang tidak otomatis tersedia di server.

Target yang diuji: **MySQL Community 8.4.13 LTS**, InnoDB, charset `utf8mb4`, collation `utf8mb4_0900_bin`, serta waktu database UTC. Aplikasi menerima MySQL 8.4.x dengan InnoDB; MariaDB bukan target. Frontend, kontrak API, serta alur Faktur dan Penerimaan Penjualan tetap sama.

Untuk server dev baru, ikuti panduan ini tanpa export database lama. Jika akun PostgreSQL/PGlite harus dipertahankan, gunakan [panduan transfer akun lama](postgresql-user-transfer.md) sebagai pengganti seed admin, **sebelum** perusahaan, koneksi, atau data lain dibuat.

## 1. Siapkan server dan penyimpanan

- Node.js **22.16 atau lebih baru**, npm, serta source backend dan frontend dari versi rilis yang sama.
- MySQL 8.4 LTS yang dapat diakses backend. Gunakan user aplikasi khusus, bukan root. Job migration memerlukan izin DDL; API/worker memerlukan izin baca/tulis. Jika dipisah, gunakan URL kredensial yang sesuai untuk masing-masing proses.
- Penyimpanan persisten `data/imports` dengan izin tulis untuk backend; file invoice disimpan di sini.
- Origin frontend dan URL publik backend, HTTPS, serta reverse proxy sesuai topologi tim. Backend memerlukan akses HTTPS keluar ke Accurate dan Resend jika lupa password digunakan.
- Secret environment tujuan yang terpisah dari laptop pengembang. Siapkan backup MySQL dan simpan `ENCRYPTION_KEY` melalui pengelolaan secret tim.

Buat database baru melalui administrator MySQL:

```sql
CREATE DATABASE intgrte CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
```

Jika memakai Compose repository, isi `MYSQL_PASSWORD` dan `MYSQL_ROOT_PASSWORD` privat, lalu jalankan `docker compose up -d mysql`. Compose membuat database/user `intgrte`, memakai volume persisten dan port loopback 3306. Tunggu healthcheck sehat sebelum migration. Untuk backend dalam container, host koneksi mengikuti jaringan/service container, bukan `localhost` container backend.

## 2. Isi environment backend

Salin `.env.example` menjadi `.env` privat atau pasang melalui secret manager. Semua perintah berikut dijalankan dari root repository backend dengan environment tersedia.

| Variabel | Pengaturan server dev |
| --- | --- |
| `NODE_ENV` | `production` untuk hasil build, meskipun server ini environment dev |
| `PORT` | Port internal backend, misalnya `4000` |
| `DATABASE_URL` | `mysql://USER:PASSWORD@HOST:3306/intgrte`; isi nilai asli secara privat dan URL-encode karakter khusus password |
| `DATABASE_SSL` | `true` untuk TLS dengan sertifikat terverifikasi; `false` hanya jika koneksi lokal/internal memang disiapkan tanpa TLS |
| `FRONTEND_URL` | Origin frontend server dev, termasuk skema dan port jika ada |
| `BETTER_AUTH_URL` | URL publik backend server dev |
| `BETTER_AUTH_SECRET` | Secret acak baru, minimal 32 karakter |
| `ENCRYPTION_KEY` | Kunci acak baru, 64 karakter hex; simpan tetap agar kredensial Accurate tersimpan dapat dibaca |
| `INTEGRATION_MODE` | `simulation` sebagai dasar; pengiriman aktual diaktifkan secara eksplisit melalui Settings Accurate |
| `IMPORT_PACKAGE_TAX_POLICY` | `proportional` |
| `RUN_WORKER` | `true` untuk API dan worker satu proses; `false` pada API jika worker terpisah |
| `SEED_ADMIN_NAME` | Nama admin pertama, misalnya `Administrator` |
| `SEED_ADMIN_EMAIL` | Email admin yang ditentukan tim untuk login |
| `SEED_ADMIN_PASSWORD` | Password awal 12–128 karakter dari pengelola kredensial tim |
| `SETUP_COMPANY_ID` | `branch-jakarta` |
| `SETUP_COMPANY_NAME` | `PT. MMI` |
| `SETUP_CENTER_ID` | `center-jakarta` |
| `RESEND_API_KEY`, `RESEND_FROM` | Key dan sender terverifikasi untuk lupa password; lihat [kesiapan email dan OTP](email-readiness.md) |

`branch-jakarta` dan `center-jakarta` adalah identitas internal aplikasi, bukan ID cabang/database Accurate. Nilai perusahaan di atas mengikuti PT MMI yang digunakan tim. API Token dan Signature Secret Accurate diisi melalui Settings, bukan frontend.

Untuk TLS dengan CA privat, pasang CA melalui `NODE_EXTRA_CA_CERTS`; verifikasi sertifikat tetap aktif. Jangan memasukkan password atau token asli ke command line, Git, issue, atau dokumentasi.

## 3. Build, migration, dan seed awal

Jalankan satu per satu; **hentikan persiapan jika salah satu perintah gagal**:

```sh
npm ci --include=dev
npm run typecheck
npm run build
node dist/db/migrate.js
node dist/db/seed-admin.js
node dist/db/setup-company.js
```

Dependency pengembangan diperlukan saat build, termasuk ketika `NODE_ENV=production`. Build menyalin migration ke `dist/db/migrations/mysql/`. Job persiapan dapat memakai hasil build; runtime dapat memakai dependency production saja setelah build selesai.

| Langkah | Data yang dibuat |
| --- | --- |
| `migrate.js` | Struktur tabel, relasi, indeks, jurnal MySQL, dan mutex `application_locks` |
| `seed-admin.js` | Satu user aktif `super_admin`, akun password dengan hash Better Auth, dan audit `user.bootstrap` |
| `setup-company.js` | Perusahaan PT. MMI aktif dengan ID/center di atas dan audit `company.bootstrap` |

Seed admin tidak membuat user tambahan, invoice, transaksi, atau konfigurasi bank. Setup perusahaan belum membuat tujuan Accurate maupun akun penerimaan. **Gunakan `db:seed:admin`, bukan `db:seed`**, karena `db:seed` memasukkan data demo.

Dengan source dan dependency pengembangan tersedia, perintah CLI setara adalah `npm run db:migrate`, `npm run db:seed:admin`, dan `npm run db:setup:company`.

Perilaku saat dijalankan kembali:

- Migration yang sudah tercatat dilewati. API tidak menjalankan migration otomatis pada startup.
- Seed admin dengan email Super Admin aktif yang sama tidak mengubah nama/password. Target dengan pengguna lain atau akun yang tidak memenuhi syarat ditolak. Seed bukan cara reset password.
- Setup perusahaan dengan ID dan center sama tidak menimpa nama/konfigurasi. Center berbeda untuk ID yang sama ditolak.

Setelah berhasil, hapus `SEED_ADMIN_PASSWORD` dari environment runtime dan simpan password awal di pengelola kredensial tim. Jalankan persiapan sebelum API/worker menerima trafik; seed bukan bagian dari setiap startup.

## 4. Jalankan backend dan frontend

Jalankan API melalui process manager/container tim:

```sh
npm start
```

Untuk worker terpisah, set `RUN_WORKER=false` pada API dan jalankan `node dist/worker-entry.js` dengan database serta secret yang sama. Jangan sekaligus mengaktifkan worker internal API jika yang diinginkan satu proses worker tersendiri.

Pada frontend, isi `NEXT_PUBLIC_API_URL` dengan URL publik backend **sebelum build**, lalu jalankan `npm ci --include=dev`, `npm run build`, dan `npm start` sesuai [README frontend](https://github.com/itd-medquest/accurate-zenoti-integration). Perubahan alamat API membutuhkan build frontend baru.

Periksa `GET /api/health`: hasil yang diharapkan HTTP 200 dengan `status: "ok"` dan `queue: "mysql"`. Login memakai Super Admin langkah 3. Perusahaan **PT. MMI** harus tersedia; riwayat Faktur dan Penerimaan Penjualan masih kosong.

## 5. Hubungkan Accurate dan simpan tujuan PT MMI

Langkah berikut dilakukan **Super Admin melalui UI**, setelah backend dan frontend aktif. Tidak ada seed otomatis untuk koneksi, tujuan Accurate, atau mapping bank.

1. Buka **Settings → Koneksi integrasi → Accurate Online** dan pilih **Perusahaan yang diatur: PT. MMI**. Untuk perusahaan tambahan, gunakan **Settings → Perusahaan → Tambah perusahaan** sesuai [panduan pengelolaan perusahaan](company-management.md).
2. Aktifkan **Aktifkan koneksi Accurate**, isi **API Token** dan **Signature Secret** untuk tujuan pengujian yang disetujui tim, lalu **Simpan koneksi**.
3. Gunakan **Uji koneksi tersimpan** dan pastikan database yang terbaca **PT MMI**. Pengujian hanya membaca data. Mode dapat tetap **Simulasi lokal** selama persiapan mapping.
4. Buka **Settings → Tujuan perusahaan**. Pada **Tujuan Faktur Penjualan aktual**, cari dan pilih **PT Mylab Prima Inovatif** untuk **PT. MMI → Tujuan Accurate**, lalu gunakan pilihan tersebut. Pastikan tampil sebagai **Tersimpan**.
5. Cocokkan database dan cabang dengan Finance sebelum melanjutkan.

Referensi tujuan tim saat ini: database **PT MMI** (`1939592`) dan cabang **PT Mylab Prima Inovatif** (`300`). Jika dev memakai database Accurate lain, pilih master milik database tersebut; jangan memaksakan ID referensi atau memakai tujuan yang belum disetujui tim.

Database mengikuti API Token tersimpan. **Mapping simulasi lokal** bukan pengaturan tujuan aktual. Tujuan aktual dikunci setelah digunakan untuk pengiriman aktual; periksa tujuan sebelum submit pertama.

## 6. Isi 8 mapping Akun Penerimaan Penjualan

Buka **Settings → Akun penerimaan → Akun Penerimaan Penjualan**. Untuk setiap baris tabel berikut:

1. Pilih **Perusahaan: PT. MMI**, **Bank / penyedia**, dan **Metode pembayaran**.
2. Cari kode pada **Akun kas/bank penerima**, lalu pilih hasil master Accurate yang tepat.
3. Untuk kartu kredit, debit, dan QRIS, pilih juga **Akun biaya administrasi**. Untuk transfer rekening langsung, akun biaya kosong.
4. Klik **Simpan mapping akun**. Ulangi hingga seluruh kombinasi tersimpan.
5. Berpindah ke kombinasi lain lalu kembali untuk memastikan pilihan tersimpan tetap tampil.

Tabel ini memakai **kode akun perkiraan** dari pengaturan PT MMI yang digunakan tim. Kode bukan nomor rekening bank atau ID internal API. Pilih melalui master Accurate; aplikasi mengambil ID, kode, dan nama akun dari hasil pilihan.

| Bank | Metode pembayaran | Kode akun kas/bank | Kode akun biaya administrasi | Tarif otomatis |
| --- | --- | --- | --- | --- |
| BCA | Kartu kredit (CC) | `11231` | `6204203` | 2% |
| BCA | Kartu debit | `11231` | `6204203` | 1,8% |
| BCA | QRIS | `11231` | `6204203` | 0,7% |
| BCA | Transfer rekening langsung | `11231` | Kosong | 0% |
| BNI | Kartu kredit (CC) | `11212` | `6204203` | 2% |
| BNI | Kartu debit | `11212` | `6204203` | 1,8% |
| BNI | QRIS | `11212` | `6204203` | 0,7% |
| BNI | Transfer rekening langsung | `11212` | Kosong | 0% |

Akun `11231` adalah kas/bank BCA PT MPI-A, `11212` kas/bank BNI PT MPI, dan `6204203` **Biaya Administrasi Umum - PT MPI** pada master referensi. Finance perlu mencocokkan nama lengkap pada master tujuan. Jika chart of accounts database dev berbeda, gunakan akun padanan yang disetujui Finance, bukan menyalin ID dari environment lain.

Akun kas/bank harus aktif, bukan akun induk, dan bermata uang **IDR**. Akun biaya harus memenuhi ketentuan Accurate dan diizinkan untuk alokasi diskon/biaya penerimaan. Tarif ditentukan backend, tidak diisi melalui seed atau form. Pecahan biaya selalu dibulatkan **ke atas** ke rupiah penuh. Contoh kartu kredit: bruto Rp150.000, biaya Rp3.000, bersih bank Rp147.000.

Jika mapping belum dapat dipilih, periksa koneksi, tujuan PT. MMI, dan kecocokan database aktif. Jika muncul **Mapping berubah**, muat ulang pengaturan sebelum menyimpan lagi; jangan mengubah tabel langsung.

## 7. Aktifkan UAT Faktur sampai Penerimaan Penjualan

1. Pastikan Finance menyetujui tujuan dan 8 mapping. Ubah **Mode pengiriman** menjadi **Aktual — membuat Faktur Penjualan di Accurate**, lalu **Simpan koneksi** saat pengujian aktual akan dimulai.
2. Upload invoice uji PDF/Excel, periksa customer/item dan nominal, lalu submit Faktur Penjualan. Upload saja belum mengirim transaksi.
3. Setelah faktur berhasil dan terverifikasi, buka **Penerimaan Penjualan**, pilih pembayaran sumber, lalu periksa bank/metode, tanggal, referensi, bruto, biaya, dan bersih bank.
4. **Simpan draft**, lalu konfirmasikan pengiriman. Cocokkan hasil di Accurate dan pastikan piutang berkurang sesuai bruto.
5. **No. Bukti harus persis nomor faktur**. Keterangan memakai `{nama customer} - Pembayaran Invoices no {nomor faktur}`. Beberapa pembayaran terpisah pada satu faktur ditahan untuk ditangani manual. Invoice full redeem tidak menghasilkan penerimaan bank.

Setup perusahaan, koneksi, dan mapping tidak membuat transaksi Accurate. Pengiriman tetap memerlukan pemeriksaan serta konfirmasi Finance. Kontrak, status, dan rekonsiliasi lengkap tersedia di [panduan Penerimaan Penjualan](sales-receipts.md).

## 8. Checklist serah terima dev

- Health API berhasil dan login Super Admin berfungsi dengan role benar.
- PT. MMI aktif; database/cabang Accurate sesuai tujuan pengujian tim.
- Seluruh 8 kombinasi mapping tersimpan dan tetap muncul setelah reload.
- Worker aktif, `data/imports` persisten, file upload dapat dibuka setelah restart.
- UAT invoice → penerimaan selesai, bruto/netto/biaya cocok, tidak ada pengiriman ganda.
- Resend dan sender terverifikasi tersedia jika lupa password dipakai; uji ke penerima yang ditunjuk. Tambah user saat ini memakai password awal dari admin; undangan email otomatis belum tersedia. Ikuti catatan reverse proxy pada [panduan email/OTP](email-readiness.md).
- Backup MySQL dan secret tersedia; `.env`, data lokal, invoice, dan export tidak masuk Git.

Untuk tes otomatis terpisah, isi `TEST_DATABASE_URL` di environment test atau `.env.test.local` privat. Akunnya harus dapat membuat/menghapus schema `imp_test_*` pada server test. Helper tidak memakai `DATABASE_URL` aplikasi. Jalankan `npm test`, `npm run typecheck`, dan `npm run build`; fixture browser mengikuti README frontend.

## Operasional dan penanganan kegagalan

Runtime dan Drizzle Kit hanya menjalankan `src/db/migrations/mysql/` dengan jurnal MySQL tersendiri. Terapkan migration dari rilis yang dijalankan; jangan gunakan `db:push`, membuat ulang migration, atau menjalankan SQL arsip PostgreSQL saat deployment.

DDL MySQL dapat ter-commit per statement. Jika migration gagal, hentikan job/API/worker, periksa statement yang gagal, lalu pulihkan backup atau siapkan perbaikan DDL yang ditinjau. Jangan menganggap seluruh migration telah rollback atau mereset database. Jika hasil kirim Accurate belum pasti, gunakan pemeriksaan/rekonsiliasi di aplikasi sebelum menentukan tindakan berikutnya.

Audit dependency pada checkout migrasi masih melaporkan advisory dependency lama (`body-parser`, `multer`, serta rantai Drizzle Kit). Driver `mysql2` tidak tercantum dalam temuan tersebut. Tinjau patch sebelum production; tes migrasi tidak menggantikan audit keamanan.

Launcher portable Windows `scripts/start-mysql-local.ps1` hanya untuk laptop yang telah diinisialisasi, memakai descriptor privat `data/mysql-local-runtime.json`; itu bukan persiapan server dev. Instalasi lokal tersebut memakai port 3307, sedangkan Compose memakai 3306.
