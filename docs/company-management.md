# Pengelolaan perusahaan dan koneksi Accurate

Super Admin dapat mengelola perusahaan melalui **Settings → Perusahaan**. Tidak perlu menjalankan script database untuk menambahkan perusahaan berikutnya.

## Menambahkan perusahaan

1. Pilih **Tambah perusahaan**, masukkan nama perusahaan, lalu simpan.
2. Pada perusahaan tersebut, pilih **Atur koneksi**. Pastikan pilihan **Perusahaan yang diatur** sudah benar.
3. Isi API Token dan Signature Secret milik database Accurate perusahaan tersebut. Pilih mode, aktifkan koneksi, lalu simpan.
4. Gunakan **Uji koneksi tersimpan**. Cocokkan nama dan ID database yang ditampilkan dengan tujuan yang disetujui Finance.
5. Buka tab **Tujuan perusahaan** untuk memilih cabang Accurate dari master database perusahaan yang sedang diatur.
6. Buka **Akun penerimaan** untuk menyimpan mapping bank dan biaya administrasinya.

Perusahaan baru tidak mewarisi token atau mapping perusahaan lain. Kredensial disimpan terenkripsi; UI hanya menerima penanda bahwa nilainya tersimpan. Pengosongan input saat mempertahankan kredensial tidak menghapus nilai yang sudah disimpan.

Pencarian master, pembuatan customer, batch invoice, antrean pengiriman, dan penerimaan menggunakan koneksi perusahaan sumbernya. Database tujuan yang telah dibekukan dalam transaksi tetap diperiksa sebelum pengiriman; mengganti token tidak memindahkan transaksi lama secara otomatis.

## Kompatibilitas perusahaan lama

Konfigurasi lama, termasuk PT. MMI, tetap terbaca melalui koneksi yang sebelumnya tersimpan. Ketika konfigurasi perusahaan tersebut disimpan dari UI baru, konfigurasi disimpan khusus untuk perusahaan itu. Perusahaan yang ditambahkan melalui UI atau bootstrap CLI mulai dengan koneksi tersendiri yang nonaktif dan belum memiliki kredensial.

Tidak diperlukan perubahan struktur tabel atau reset database. Konfigurasi per perusahaan memakai record terpisah pada tabel konfigurasi integrasi yang sudah ada. Endpoint lama tetap menerima request tanpa parameter perusahaan untuk kompatibilitas; frontend baru selalu menyertakan perusahaan pada pengaturan dan pencarian master, sedangkan operasi transaksi mengambil perusahaan dari data invoice/batch/penerimaan di server.

## Menghapus perusahaan

Perusahaan dapat dihapus jika belum memiliki riwayat upload, invoice, atau penerimaan. Penghapusan meminta nama perusahaan yang sama persis, diperiksa kembali di server, dan dicatat pada audit log.

Koneksi serta mapping lokal perusahaan yang belum digunakan ikut dibersihkan. Riwayat transaksi, file sumber, audit log, dan transaksi pada Accurate tidak dihapus oleh tindakan ini. Perusahaan yang memiliki riwayat tidak dapat dihapus, termasuk ketika batch pernah dihapus dari daftar draft.

## Deployment

Deploy backend terlebih dahulu, kemudian frontend dari perubahan yang sama. Frontend baru memakai endpoint pengelolaan perusahaan, parameter koneksi per perusahaan, serta endpoint audit berhalaman; backend lama belum mendukung alur tersebut. Jalankan pemeriksaan database dan build seperti biasa, lalu uji koneksi setiap perusahaan secara read-only sebelum mengirim transaksi aktual.
