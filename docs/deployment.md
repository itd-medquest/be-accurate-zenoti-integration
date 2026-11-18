# Database kosong dan super admin pertama

Panduan ini menyiapkan environment baru tanpa menyalin data lokal. Gunakan MySQL 8.4 LTS untuk deployment.

## Struktur database

Struktur tersedia dalam migration yang sudah ada di `src/db/migrations/mysql/`, termasuk folder `meta/`. DevOps cukup menggunakan repository backend beserta migration tersebut, lalu menerapkannya ke database MySQL 8.4 LTS baru. Tidak perlu dump database lokal.

Migration membuat tabel, relasi, indeks, dan constraint. Pada database baru, tabel aplikasi tetap kosong; tabel internal Drizzle berisi riwayat migration dan `application_locks` berisi satu mutex akun. Migration yang sudah diterapkan akan dilewati saat perintah dijalankan kembali. Migration bukan perintah untuk mengosongkan database yang sudah berisi data: pastikan `DATABASE_URL` menunjuk ke database baru yang memang disiapkan untuk environment tujuan.

Jangan menyalin `.env` lokal, `data/`, file invoice sumber, token Accurate, atau session pengguna. Buat secret environment tujuan secara terpisah. Gunakan migration dari versi aplikasi yang akan dijalankan; jangan membuat migration ulang dengan `db:generate` atau menggantinya dengan `db:push` saat deployment.

## Konfigurasi sebelum menjalankan perintah

DevOps perlu membuat database MySQL 8.4 LTS kosong dan menyediakan environment berikut melalui secret manager atau `.env` privat di server:

| Variabel                    | Nilai yang disiapkan                                                                                  |
| --------------------------- | ----------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                  | `production`                                                                                          |
| `DATABASE_URL`              | Koneksi MySQL 8.4 LTS environment tujuan, dengan pengaturan TLS sesuai penyedia database              |
| `DATABASE_SSL`              | `true` untuk koneksi TLS dengan sertifikat terverifikasi                                              |
| `FRONTEND_URL`              | Origin frontend environment tujuan                                                                    |
| `BETTER_AUTH_URL`           | URL publik backend environment tujuan                                                                 |
| `BETTER_AUTH_SECRET`        | Secret acak baru, minimal 32 karakter                                                                 |
| `ENCRYPTION_KEY`            | Kunci acak baru, 64 karakter heksadesimal; simpan tetap agar kredensial Accurate dapat dibaca kembali |
| `IMPORT_PACKAGE_TAX_POLICY` | `proportional`, mengikuti konfigurasi aplikasi saat ini                                               |
| `RUN_WORKER`                | `true` untuk API dan worker dalam satu proses; `false` jika worker dijalankan terpisah                |
| `SEED_ADMIN_NAME`           | Nama admin pertama, opsional; default `Administrator`                                                 |
| `SEED_ADMIN_EMAIL`          | Email admin pertama yang akan dipakai login                                                           |
| `SEED_ADMIN_PASSWORD`       | Password awal, 12–128 karakter                                                                        |

Buat database dengan InnoDB, charset `utf8mb4`, collation `utf8mb4_0900_bin`, serta UTC. Lengkapi juga variabel lain di `.env.example` sesuai kebutuhan. Nilai contoh adalah placeholder. Jangan mencantumkan password asli dalam command line, dokumentasi, atau Git.

## Instalasi, migration, dan bootstrap

Jalankan dari direktori repository backend dengan Node.js 22.16 atau lebih baru. Environment di atas harus sudah tersedia. Database lokal pengembang tidak digunakan untuk langkah ini.

```sh
npm ci
npm run build
node dist/db/migrate.js
node dist/db/seed-admin.js
node dist/db/setup-company.js
npm start
```

Build menyalin migration ke `dist/db/migrations/mysql/`. Perintah `node dist/db/...` menggunakan hasil build, sehingga bootstrap juga dapat dijalankan dari image runtime yang tidak memasang `tsx` atau dependency pengembangan. Jalankan migration dan bootstrap sebagai satu job persiapan sebelum API dan worker menerima trafik. Jangan menjalankan bootstrap otomatis pada setiap startup.

Jika source dan dependency pengembangan tersedia, perintah yang setara adalah:

```sh
npm run db:migrate
npm run db:seed:admin
```

**Gunakan `db:seed:admin`, bukan `db:seed`.** Seed demo membuat pengguna tambahan, invoice simulasi, dan simulasi pengiriman. Jika membawa akun lama, gunakan import terenkripsi sebagai pengganti seed admin; ikuti [panduan migrasi MySQL](mysql-migration.md).

## Perilaku seed khusus admin

- Hanya membuat satu pengguna aktif dengan role `super_admin`, satu akun kredensial dengan password yang di-hash menggunakan Better Auth, dan satu catatan audit `user.bootstrap`.
- Tidak membuat invoice, perusahaan/cabang demo, konfigurasi integrasi, antrean pengiriman, atau akun lain.
- Email dinormalisasi menjadi huruf kecil. Nama default dapat diganti dengan `SEED_ADMIN_NAME`.
- Pada database tanpa pengguna, pembuatan akun dan kredensial dilakukan dalam satu transaksi dengan lock baris mutex infrastruktur untuk mencegah bootstrap bersamaan membuat dua admin.
- Jika email yang sama sudah merupakan super admin aktif dengan kredensial password, perintah berhasil tanpa mengubah nama, password, atau data akun tersebut. Password environment tidak digunakan untuk mereset akun yang sudah ada.
- Jika sudah ada pengguna lain, atau email tersebut milik akun non-admin/nonaktif/tanpa kredensial, perintah gagal tanpa menaikkan hak akses atau mengganti password. Kelola pengguna melalui admin yang sudah ada; bootstrap bukan mekanisme pemulihan akun.
- Kegagalan validasi atau database menghasilkan exit code nonzero dan tidak menampilkan password maupun connection string. Jika gagal, hentikan job persiapan dan periksa konfigurasi serta status migration sebelum mencoba lagi.

Sesudah berhasil, hapus `SEED_ADMIN_PASSWORD` dari environment aplikasi yang berjalan. Simpan password awal melalui pengelola kredensial tim; jangan mengandalkan rerun seed untuk menggantinya. Variabel seed tidak diperlukan untuk login maupun operasi aplikasi selanjutnya.

## Pemeriksaan setelah bootstrap

1. Login memakai email dan password admin yang baru dibuat.
2. Periksa `GET /api/health` dan akses Settings.
3. Siapkan `SETUP_COMPANY_ID`, `SETUP_COMPANY_NAME`, serta `SETUP_CENTER_ID`, lalu jalankan `db:setup:company` untuk perusahaan kosong. Konfigurasikan koneksi Accurate dan perusahaan tujuan melalui Settings. Pengaturan ini tidak dibawa dari database lokal dan harus diverifikasi untuk environment tujuan sebelum submit invoice.
4. Tambahkan pengguna Finance/Viewer melalui pengelolaan pengguna sesuai kebutuhan tim.

Untuk pemulihan password dan batas kesiapan undangan pengguna, ikuti [hasil audit email dan OTP](email-readiness.md). Konfigurasi Resend dan domain pengirim perlu disiapkan sebelum pemulihan password melalui email digunakan oleh tim.

Sebelum login, hasil bootstrap hanya menambahkan baris pada `users`, `accounts`, dan `audit_logs`. Login menambah session serta audit login; aktivitas berikutnya menambah data sesuai penggunaan. Tidak ada invoice atau dokumen lokal yang ikut dipindahkan.
