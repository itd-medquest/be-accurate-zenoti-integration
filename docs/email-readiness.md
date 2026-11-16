# Kesiapan email dan OTP

Audit dilakukan pada 16 November 2026. Pemeriksaan mencakup konfigurasi backend, form frontend, pengelolaan pengguna, dan tes pemulihan password. Tidak ada email nyata yang dikirim atau akun lokal yang diubah selama audit.

## Hasil pemeriksaan

| Alur | Kondisi saat ini | Kebutuhan berikutnya |
| --- | --- | --- |
| Lupa password | Implementasi frontend, API, OTP, dan integrasi Resend tersedia; tes lulus | Isi environment Resend, verifikasi domain pengirim, lalu uji penerimaan email nyata di environment tujuan |
| Tambah pengguna | Admin mengisi nama, email, role, dan password awal; akun langsung aktif | Pengguna masuk memakai password awal yang dibagikan melalui saluran internal |
| Undangan/aktivasi akun melalui email atau OTP | Belum diimplementasikan | Memerlukan alur undangan, verifikasi/aktivasi, kedaluwarsa, kirim ulang, dan pengaturan password oleh penerima |

Mengisi environment Resend mengaktifkan pengiriman kode pemulihan password. Langkah tersebut tidak menambahkan undangan akun otomatis. Login biasa juga belum menggunakan OTP sebagai faktor kedua.

Pada pemeriksaan konfigurasi lokal, `RESEND_API_KEY` belum terisi dan `RESEND_FROM` belum ditetapkan secara eksplisit. Konfigurasi aplikasi menggunakan sender uji bawaan apabila `RESEND_FROM` tidak ditetapkan. Dengan key kosong, endpoint permintaan OTP mengembalikan HTTP 503 dan pesan bahwa layanan email belum dikonfigurasi.

## Konfigurasi Resend

Tetapkan dua variabel ini pada backend melalui secret manager atau `.env` privat. Nilai berikut hanya contoh:

```dotenv
RESEND_API_KEY=isi-api-key-resend-melalui-secret-manager
RESEND_FROM="intgrte <no-reply@domain-anda.com>"
```

Domain pada alamat `from` harus diverifikasi di Resend melalui DNS sesuai petunjuk dashboard. Pastikan API key memiliki izin pengiriman untuk domain tersebut, server dapat mengakses `https://api.resend.com`, dan proses backend direstart/redeploy setelah environment diubah. Secret Resend tidak diperlukan di frontend dan tidak boleh memakai prefix `NEXT_PUBLIC_`.

Alamat bawaan `onboarding@resend.dev` membatasi pengiriman uji ke alamat pemilik akun Resend. Untuk mengirim OTP kepada anggota tim lain, gunakan alamat dari domain yang sudah diverifikasi. Sumber: [pembatasan domain pengujian Resend](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain).

## Perilaku pemulihan password yang sudah diuji

- Kode OTP enam digit berlaku lima menit, dengan batas lima percobaan salah per kode.
- Permintaan kode ulang memiliki jeda 60 detik. Pengiriman ulang mengganti kode dan membatalkan grant sebelumnya.
- Setelah OTP diverifikasi, pengguna memiliki lima menit untuk menyimpan password baru. Grant hanya dapat dipakai sekali.
- OTP dan grant disimpan dalam bentuk hash. Password disimpan dengan hashing Better Auth.
- Penggantian password mencabut session lama dan membuat audit `password.reset`.
- Email tidak terdaftar dan akun nonaktif mendapatkan respons generik yang sama tanpa menerima email.
- Kegagalan provider dicatat tanpa menampilkan penerima, OTP, atau API key.
- Origin request diperiksa dan endpoint memiliki pembatasan percobaan berbasis IP.

Pengujian backend: `npx tsx --test test/password-reset.test.ts` — **10 tes lulus** dengan database sementara dan respons Resend tiruan. Pengujian browser: `tests/e2e/password-reset.spec.ts` — **5 tes lulus**, mencakup alur sukses, kode salah, cooldown, konfigurasi email yang belum tersedia, konfirmasi password, dan ukuran layar desktop/mobile. Browser diuji pada instance terisolasi; modul auth frontend yang diuji sama dengan source saat audit.

Hasil ini membuktikan alur aplikasi dalam pengujian. Kredensial, domain, reputasi pengirim, dan penerimaan email nyata belum diverifikasi.

## Hal yang perlu disiapkan sebelum dipakai tim

1. **Pengiriman nyata:** lengkapi environment dan domain Resend, kemudian lakukan smoke test dengan penerima yang memang ditunjuk untuk pengujian. Periksa status delivery di dashboard Resend serta inbox/spam penerima. Keberhasilan request API berarti Resend menerima permintaan; status delivered menunjukkan penerimaan oleh mail server tujuan, bukan jaminan penempatan di inbox. Sumber: [email.sent](https://resend.com/docs/webhooks/emails/sent), [email.delivered](https://resend.com/docs/webhooks/emails/delivered).
2. **Reverse proxy:** aplikasi saat audit belum menetapkan Express `trust proxy`. Jika dijalankan melalui Nginx, ingress, atau load balancer, rate limiter dapat membaca IP proxy sehingga batas percobaan terpakai bersama oleh banyak pengguna. Sesuaikan trusted proxy dengan topologi deployment dan uji pemisahan batas per pengguna/IP. Jangan mempercayai semua header forwarded tanpa membatasi proxy yang benar. Pada beberapa replica, pembatasan berbasis IP juga memerlukan penyimpanan bersama agar batas konsisten.
3. **Undangan pengguna:** fitur ini membutuhkan implementasi tambahan jika proses yang diinginkan adalah admin mengundang dan penerima memverifikasi email lalu membuat password sendiri. Proses tambah pengguna saat ini tetap memakai password awal dan tidak menunggu OTP.
4. **Keandalan pengiriman:** email dikirim setelah transaksi database selesai, melalui task dalam memori dengan timeout sepuluh detik dan idempotency key. Tidak ada antrean email persisten, retry otomatis, atau pencatatan status delivery dari webhook. Shutdown normal menunggu task pengiriman yang sedang berjalan; crash proses dapat kehilangan task. Untuk dev, pengujian dapat mencakup kirim ulang manual setelah cooldown. Untuk kebutuhan operasional yang lebih kuat, tambahkan antrean persisten, retry terbatas sebelum kode kedaluwarsa, dan pemantauan delivery tanpa menyimpan OTP dalam plaintext.

API dan UI sengaja tidak mengungkap apakah alamat tertentu terdaftar atau apakah pengiriman khusus alamat itu gagal. Respons permintaan OTP yang generik bukan bukti bahwa email sudah diterima pengguna.
