# Arsip: backup sumber dan transfer akun PostgreSQL/PGlite ke MySQL

Panduan opsional jika akun login database lama harus dipertahankan. **Server dev baru dengan akun baru cukup mengikuti [setup MySQL](mysql-migration.md)**. Langkah di sini tidak diperlukan untuk seed perusahaan dan akun penerimaan.

Tooling bawaan hanya memindahkan identitas pengguna dan akun password. Tidak tersedia tooling umum untuk menyalin seluruh database, konfigurasi Accurate, tujuan perusahaan, atau mapping bank. Konfigurasi PT MMI dan 8 akun penerimaan pada server baru diisi mengikuti panduan utama.

## Data yang dibawa

- Identitas pengguna: ID, nama, email, verifikasi email, role, status aktif, gambar, dan tanggal.
- Akun `credential` beserta hash password yang sudah ada. Password dan hak akses tidak diubah.
- Sesi login, OTP, token reset/OAuth, invoice, dokumen upload, mapping, kredensial Accurate, audit lama, dan antrean tidak disalin.

Pengguna perlu login ulang dengan password sebelumnya. Pengguna nonaktif tetap nonaktif. Export harus mempunyai minimal satu Super Admin aktif dengan akun password; jika tidak ada, selesaikan pengelolaan akun pada sistem sumber dahulu.

## 1. Backup sumber dan secret

Hentikan API/worker sebelum backup atau export PGlite; jangan membuka direktori PGlite dari dua proses. Setelah berhenti, salin seluruh direktori data PGlite ke lokasi backup privat, beserta konfigurasi secret aslinya. Untuk PostgreSQL server, gunakan prosedur backup konsisten yang dikelola DevOps. Export akun di bawah bukan pengganti backup penuh.

Simpan backup sumber dan `.env` privat di luar Git. Jangan hapus sumber sebelum verifikasi selesai. Migration PostgreSQL di `src/db/migrations/` tetap menjadi arsip; runtime MySQL hanya memakai `src/db/migrations/mysql/`. Jangan menyalin jurnal PostgreSQL atau menerapkan SQL arsip ke MySQL.

## 2. Export akun terenkripsi

Jalankan pada checkout backend migrasi dengan dependency pengembangan terpasang:

```sh
npm ci --include=dev
```

Driver PostgreSQL/PGlite menjadi dependency pengembangan untuk membaca sumber lama. API produksi tidak membuka database tersebut.

Siapkan environment privat:

| Variabel | Kegunaan |
| --- | --- |
| `SOURCE_DATABASE_URL` | URL PostgreSQL atau `pglite:` dengan path absolut ke sumber lama yang sudah ada |
| `DATABASE_URL` | URL MySQL untuk konfigurasi aplikasi baru; export tidak membukanya |
| `USER_TRANSFER_KEY` | Kunci acak 64 karakter hex yang sama saat export dan import; bila kosong memakai `ENCRYPTION_KEY` |
| Secret backend lainnya | Lengkapi variabel wajib `.env.example`, karena CLI memuat konfigurasi backend |

```sh
npm run db:export:users -- data/mysql-login-users.encrypted.json
```

PostgreSQL dibaca melalui transaksi read-only dengan snapshot konsisten. PGlite juga memakai transaksi read-only. Output menggunakan AES-256-GCM dan tidak menimpa file yang sudah ada; tidak ada email/hash plaintext pada file export. Perlakukan file sebagai rahasia dan salurkan file serta kunci melalui kanal privat terpisah. Jangan menuliskan URL, password, atau kunci asli pada command line, Git, issue, atau chat.

## 3. Import ke MySQL kosong sebelum bootstrap lain

Siapkan database, environment, dan build sesuai langkah 1–3 pada [panduan MySQL](mysql-migration.md), tetapi **jangan jalankan seed admin, setup perusahaan, login, konfigurasi integrasi, API, atau worker terlebih dahulu**. Tabel aplikasi harus kosong setelah migration; hanya jurnal internal dan mutex yang boleh terisi.

```sh
npm run build
node dist/db/migrate.js
node dist/db/import-users.js data/mysql-login-users.encrypted.json
```

Pasang `USER_TRANSFER_KEY` yang dipakai saat export secara privat. Jika memakai fallback, `ENCRYPTION_KEY` import harus cocok dengan export. Kunci aplikasi tujuan dapat tetap berbeda jika memakai `USER_TRANSFER_KEY` terpisah.

Import berlangsung atomik dalam satu transaksi dan mutex, memvalidasi struktur/referensi, dan membuat audit ringkasan. Target dengan pengguna, data bisnis, konfigurasi, sesi, OTP, atau audit yang sudah ada ditolak. Import ulang tidak menimpa akun. Jika gagal, periksa file, kunci, koneksi, migration, serta keadaan target; jangan menghapus data target untuk memaksa import.

Import ini **menggantikan** seed admin. Setelah berhasil, lepaskan kunci transfer dari environment runtime, lanjutkan `node dist/db/setup-company.js`, lalu ikuti panduan utama untuk menjalankan aplikasi, mengisi koneksi Accurate, tujuan PT MMI, dan 8 mapping akun penerimaan.

## 4. Verifikasi dan pemulihan

Periksa jumlah pengguna, login memakai password lama, role, dan status aktif tanpa menampilkan hash atau password. Riwayat invoice/penerimaan tetap kosong; sesi baru dibuat saat login. Simpan export serta backup sesuai kebijakan retensi tim di lokasi privat.

Rollback ke aplikasi PostgreSQL memerlukan checkout aplikasi lama, database lama, dan secret aslinya. Jangan menjalankan aplikasi PostgreSQL terhadap MySQL. Jika MySQL sudah menerima transaksi baru, lakukan rekonsiliasi sebelum rollback karena kedua database tidak disinkronkan. Penanganan kegagalan DDL MySQL mengikuti bagian operasional pada panduan utama.
