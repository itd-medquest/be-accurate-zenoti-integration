# Penerimaan Penjualan

Modul menggunakan pembayaran dari PDF/Excel invoice yang sama. Faktur harus sudah terverifikasi di Accurate sebelum pembayaran dapat dikirim. Draft, pengiriman, dan status penerimaan dipisahkan dari pengiriman faktur.

## Alur Finance

1. Super Admin menyimpan mapping pada Settings > Akun penerimaan: perusahaan, BCA/BNI, metode, akun kas/bank IDR, serta akun biaya administrasi jika diperlukan.
2. Finance membuka Penerimaan Penjualan, memilih pembayaran sumber, lalu memeriksa bank/metode, tanggal aktual, referensi pembayaran, dan nominal.
3. Simpan draft. Halaman menampilkan saldo piutang Accurate yang baru dibaca, bruto pelanggan, biaya, dan bersih bank.
4. Centang pemeriksaan dan konfirmasikan Kirim ke Accurate. Backend memeriksa ulang data, menyimpan payload final, lalu memasukkan penerimaan ke antrean tersendiri.
5. Status Berhasil memerlukan pencocokan detail receipt dan pengurangan piutang; respons HTTP 200 saja tidak cukup.

Upload, membuka review, menyimpan mapping, dan menyimpan draft tidak mengirim transaksi. Pengiriman memerlukan koneksi Accurate aktif dalam mode aktual dan hak akses token yang sesuai. Worker berjalan bersama scheduler backend; untuk worker terpisah gunakan PostgreSQL, seperti pada pengiriman faktur.

## Tarif dan nominal

| Bank | Kartu kredit | Debit | QRIS | Transfer rekening langsung |
| --- | --- | --- | --- | --- |
| BCA | 2% | 1,8% | 0,7% | 0% |
| BNI | 2% | 1,8% | 0,7% | 0% |

Biaya selalu dibulatkan **ke atas** ke rupiah penuh. Contoh QRIS Rp200.001: biaya Rp1.401, bersih bank Rp198.600. Backend menghitung tarif; request tidak dapat menentukan tarif atau nominal biaya sendiri. Nominal didukung sampai Rp2.147.483.647 per kelompok pembayaran.

Hubungan nominal pada respons receipt referensi sudah diperiksa secara read-only:

- detailInvoice.paymentAmount adalah bruto yang melunasi faktur.
- detailInvoice.discountAmount dan detailDiscount[].amount adalah potongan biaya.
- detailInvoice.invoicePayment, chequeAmount, dan totalPayment adalah bersih bank.
- Bruto = bersih + biaya. Biaya dicatat pada akun beban melalui detailDiscount, tanpa mengubah nilai penjualan pada faktur.

Contoh tanpa data pelanggan: bruto Rp150.000, biaya CC Rp3.000, bersih Rp147.000. Payload menggunakan paymentAmount 150000, chequeAmount 147000, dan detailDiscount.amount 3000. Transfer langsung tidak menyertakan detailDiscount.

Metode manual pada receipt referensi tidak digunakan untuk menebak metode sumber. Finance tetap memilih CC/debit secara eksplisit jika dokumen hanya menyebut kartu. bankNo adalah nomor **akun perkiraan**, bukan nomor rekening bank. Akun beban juga perlu diizinkan pada pengaturan akun diskon Accurate.

## Pemeriksaan dan pencegahan duplikasi

- Identitas faktur target, customer, database, cabang, tanggal, mata uang, dan total harus cocok dengan pengiriman faktur yang sudah terverifikasi.
- Saldo menggunakan primeOwing dari detail faktur Accurate, bukan outstanding atau status Closed pada dokumen lokal. owingForPayment tidak selalu dikembalikan oleh endpoint detail faktur; jika tersedia, nilainya harus konsisten dengan primeOwing. Kegagalan membaca saldo tidak mengunci pengisian draft, tetapi pengiriman tetap diblokir sampai saldo dan identitas faktur terverifikasi.
- Akun dipilih dari master aktif, bukan akun induk. Mata uang bank harus IDR dan sama dengan mata uang faktur.
- Versi draft, mapping, source fingerprint, role/user aktif, perusahaan, dan koneksi diperiksa lagi sebelum percobaan write.
- Maksimal satu penerimaan otomatis per faktur. Beberapa pembayaran terpisah ditahan untuk ditangani manual; sistem tetap memeriksa saldo terbaru sebelum pengiriman.
- Nomor receipt adalah No. Bukti Accurate dan harus persis nomor Faktur Accurate, tanpa awalan atau akhiran tambahan. Nomor tetap unik per database. Keterangan memakai format `{nama customer} - Pembayaran Invoices no {nomor faktur}`; ID operasi, referensi pembayaran, dan catatan Finance tetap tersimpan di intgrte. Draft lama yang belum pernah dikirim diselaraskan saat Finance menyimpan ulang draft. Payload yang sudah dibekukan tetap memakai keterangan awal untuk pengiriman dan rekonsiliasi; transaksi Accurate yang sudah ada tidak ditulis ulang. Receipt existing sebelum percobaan ini ditahan dan tidak ditimpa/adopsi otomatis.
- Payload dan identitas pemeriksaan dibekukan sebelum write. attemptedAt dicatat dalam transaksi sebelum POST. Payload yang sudah antre tidak mengikuti perubahan mapping secara diam-diam.
- Verifikasi mencocokkan header, identitas akun/customer/cabang/mata uang, tanggal, metode, keterangan yang dibekukan, seluruh alokasi bruto/netto/biaya, dan akun diskon. ID operasi tetap menjadi identitas internal pada draft dan audit; tidak ditampilkan dalam Keterangan Accurate.
- Flag `returnOverpay` dibaca sebagai boolean: `false` adalah kondisi normal, sedangkan `true` atau tipe yang tidak sesuai tetap ditolak. Flag ini tidak dihitung sebagai nominal rupiah.
- Saldo setelah pengiriman harus sudah berkurang setidaknya sebesar alokasi bruto. Pembayaran lain yang sah dapat mengurangi saldo lebih lanjut.
- Kegagalan penerimaan tidak mengubah invoice sumber, status keberhasilan faktur, atau menjalankan ulang save faktur.

## Status dan pemulihan

| Status | Tindakan |
| --- | --- |
| Belum direview | Buat draft dari pembayaran sumber |
| Draft | Periksa, simpan, lalu konfirmasi pengiriman |
| Dalam antrean / Sedang dikirim | Tunggu; halaman memperbarui status otomatis |
| Berhasil | Nomor/ID receipt tersimpan setelah hasil terverifikasi |
| Perlu diperiksa, belum ada upaya POST | Kembalikan ke draft untuk pemeriksaan ulang |
| Perlu diperiksa, respons eksplisit ditolak | Kembalikan ke draft hanya setelah pencarian read-only memastikan nomor belum dibuat |
| Perlu diperiksa, hasil POST belum pasti | Gunakan Periksa hasil di Accurate; tidak ada POST ulang otomatis |

Proses SENDING yang terputus lebih dari lima menit dipindahkan ke Perlu diperiksa, bukan diantre ulang. Jika receipt belum ditemukan setelah hasil yang tidak pasti, operasi tetap ditahan. Ketiadaan hasil pencarian sesaat bukan bukti bahwa transaksi tidak pernah tercipta. Draft/history tetap dapat dibaca ketika sumber berubah atau koneksi tidak tersedia.

## Pembayaran sumber yang didukung

- Pembayaran PDF/Excel yang berbeda tetap menjadi kelompok terpisah.
- Jika satu faktur memiliki lebih dari satu kelompok pembayaran terpisah, penerimaan ditahan untuk ditangani manual. Sistem tidak membuat nomor tambahan dan tidak menggabungkan bank, metode, atau transaksi pembayaran yang berbeda secara otomatis.
- Hanya ID alokasi item Sales Accrual berakhiran :collection yang digabung per metode dan tanggal dalam satu invoice.
- ID turunan dan Sale Date bukan bukti identitas/tanggal transaksi bank. Finance harus mencocokkan referensi, tanggal, dan metode dengan dokumen sumber.
- Invoice lokal full redeem/Consultation-only, pembayaran nol, dan invoice tanpa pembayaran tidak menghasilkan penerimaan bank.
- Tunai, voucher, gift card, refund, void, PPh, kredit/overpay, uang muka, valuta asing, serta settlement gabungan belum didukung oleh alur ini. Jangan memetakannya otomatis menjadi pembayaran bank.

Filter/pagination diterapkan setelah penggabungan sumber. Untuk volume besar, ukur query dan memori sebelum menormalisasikan sumber pembayaran lebih lanjut.

## Endpoint aplikasi

Super Admin dan Finance dapat mengoperasikan penerimaan. Mapping hanya dapat disimpan Super Admin. Viewer mengikuti kebijakan akses modul operasional saat ini dan tidak mendapat akses penerimaan.

| Endpoint | Fungsi |
| --- | --- |
| GET /api/receipts | Riwayat, ringkasan, pencarian, filter, pagination |
| GET /api/receipts/configuration | Mapping dan tujuan dalam database aktif |
| GET /api/receipts/accounts | Pencarian master kas/bank atau beban |
| PUT /api/receipts/mappings | Mapping akun berversi |
| POST /api/receipts/drafts | Prepare draft idempotent |
| GET /api/receipts/:id | Detail, saldo terbaru untuk draft, serta aksi yang tersedia |
| PUT /api/receipts/:id | Simpan draft berversi |
| POST /api/receipts/:id/submit | Konfirmasi dan antrekan payload final |
| POST /api/receipts/:id/check | Rekonsiliasi hasil melalui pembacaan vendor |
| POST /api/receipts/:id/reopen | Kembali ke draft jika upaya belum dimulai atau ditolak secara pasti |
| GET /api/receipts/reference?number=... | Pembacaan referensi keuangan dengan informasi kontak disaring |

## Accurate dan migration

Endpoint vendor relatif terhadap host database yang diverifikasi dengan prefix /accurate:

| Endpoint | Scope |
| --- | --- |
| GET /api/glaccount/list.do, detail.do | glaccount_view |
| GET /api/sales-invoice/detail.do | sales_invoice_view |
| GET /api/sales-receipt/list.do, detail.do | sales_receipt_view |
| POST /api/sales-receipt/save.do (JSON) | sales_receipt_save |

Kontrak request berasal dari OpenAPI Accurate versi 1.6041.5093 dan hubungan nominal diperiksa dari respons referensi yang diberikan pemilik project. Collection Postman dibaca sebagai referensi; script dan credential di dalamnya tidak disalin ke repository.

Migration 0005 menambah tabel receipt_account_mappings dan accurate_receipts. Migration 0006 menambahkan metadata verification untuk identitas invoice/customer/mata uang/akun, saldo sebelum write, serta penanda penolakan eksplisit. Migration lama tidak diurut ulang atau diubah. File SQL diperiksa terhadap byte NUL, UTF-8 rusak, dan file kosong pada build serta sebelum migration dijalankan. Jangan reset database untuk memperbaiki file migration yang rusak; pulihkan source SQL dan build ulang.

## Validasi dan batas UAT

- test/receipts.test.ts: tarif, grouping, role, mapping, filter, versi draft, dan riwayat.
- test/receipt-delivery.test.ts: payload, No. Bukti persis nomor faktur, penyesuaian draft lama, pembayaran terpisah ditahan manual, concurrency, primeOwing tanpa owingForPayment, pengisian draft saat pemeriksaan saldo gagal, saldo/database/mata uang/sumber berubah, operator nonaktif, pre-existing receipt, explicit rejection, timeout, mismatch, dan recovery tanpa POST ganda.
- test/migration-integrity.test.ts: file SQL rusak ditolak sebelum query; upgrade setelah perbaikan mempertahankan data lama.
- tests/e2e/receipts.spec.ts di frontend: desktop dark/mobile light, filter kalender, mapping tersimpan, draft, dialog konfirmasi, antrean, sukses, rekonsiliasi, dan kembali ke draft.

Tes memakai database sementara dan vendor/API tiruan. Belum ada receipt aktual yang dibuat selama implementasi. UAT dengan Finance tetap diperlukan untuk memeriksa mapping perusahaan, hak akses token, preferensi akun biaya, dan transaksi uji di Accurate.

Referensi: [OpenAPI resmi](https://account.accurate.id/open-api/json.do), [biaya administrasi bank](https://help.accurate.id/product/accurate-online/fitur-aol/penjualan/penerimaan-penjualan/mencatat-admin-bank/).
