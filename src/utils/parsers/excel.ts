import ExcelJS from 'exceljs';
import type { ImportCandidate } from '../../types/import.types.js';
import { emptyCandidate } from '../import-validation.js';
import { parseSalesAccrual } from './sales-accrual.js';
const headers = {
  Invoices: [
    'invoice_id',
    'invoice_number',
    'invoice_date',
    'customer_id',
    'customer_name',
    'business_status',
    'currency',
    'subtotal',
    'tax',
    'total',
    'total_paid',
    'outstanding',
    'due_date',
  ],
  Items: [
    'invoice_id',
    'line_id',
    'item_name',
    'kind',
    'quantity',
    'unit_price',
    'discount_amount',
    'tax_amount',
  ],
  Payments: ['invoice_id', 'payment_id', 'payment_date', 'method', 'amount'],
};
export function inspectZip(buffer: Buffer) {
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--)
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw new Error('XLSX bukan ZIP yang valid.');
  const entries = buffer.readUInt16LE(end + 10);
  let pos = buffer.readUInt32LE(end + 16);
  let total = 0;
  if (entries > 2000 || entries === 65535) throw new Error('Jumlah entri XLSX melebihi batas.');
  for (let i = 0; i < entries; i++) {
    if (pos + 46 > buffer.length || buffer.readUInt32LE(pos) !== 0x02014b50)
      throw new Error('Struktur XLSX tidak valid.');
    const size = buffer.readUInt32LE(pos + 24),
      length = buffer.readUInt16LE(pos + 28),
      extra = buffer.readUInt16LE(pos + 30),
      comment = buffer.readUInt16LE(pos + 32);
    const name = buffer.subarray(pos + 46, pos + 46 + length).toString('utf8');
    total += size;
    if (size > 20 * 1024 * 1024 || total > 40 * 1024 * 1024)
      throw new Error('Ukuran XLSX setelah dekompresi melebihi 40 MB.');
    if (
      buffer.readUInt16LE(pos + 8) & 1 ||
      /vbaProject|externalLinks|embeddings|\.bin$/i.test(name)
    )
      throw new Error(
        'Workbook dengan enkripsi, macro, atau tautan/objek eksternal tidak diterima.',
      );
    pos += 46 + length + extra + comment;
  }
}
export async function parseExcel(buffer: Buffer): Promise<ImportCandidate[]> {
  inspectZip(buffer);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as never);
  if (workbook.worksheets.length > 4) throw new Error('Maksimal 4 sheet per workbook.');
  const native = workbook.worksheets.find(
    (s) =>
      s.getRow(4).getCell(1).text.trim() === 'Item Type' &&
      s.getRow(4).getCell(3).text.trim() === 'Invoice No',
  );
  if (native) return parseSalesAccrual(native);
  if (workbook.worksheets.length > 4)
    throw new Error('Gunakan template resmi dengan sheet Guide, Invoices, Items, Payments.');
  const guide = workbook.getWorksheet('Guide');
  if (guide?.getCell('B1').text !== '1.0')
    throw new Error('TemplateVersion harus 1.0 pada sheet Guide.');
  for (const sheet of workbook.worksheets) {
    if (sheet.rowCount > 2001 || sheet.columnCount > 25)
      throw new Error('Maksimal 2.000 baris dan 25 kolom per sheet.');
    sheet.eachRow((row) =>
      row.eachCell((cell) => {
        const v = cell.value;
        if (
          v &&
          typeof v === 'object' &&
          ('formula' in v || 'sharedFormula' in v || 'hyperlink' in v)
        )
          throw new Error('Formula dan hyperlink tidak diterima. Gunakan nilai biasa.');
      }),
    );
  }
  function data(name: keyof typeof headers) {
    const sheet = workbook.getWorksheet(name);
    if (!sheet) throw new Error(`Sheet ${name} wajib tersedia.`);
    const actual = headers[name].map((_, i) => sheet.getRow(1).getCell(i + 1).text);
    if (actual.join('|') !== headers[name].join('|'))
      throw new Error(`Header sheet ${name} tidak sesuai template.`);
    const result: Record<string, string | number>[] = [];
    sheet.eachRow((row, index) => {
      if (index === 1 || !row.getCell(1).text.trim()) return;
      const values: Record<string, string | number> = {};
      headers[name].forEach((h, i) => {
        const cell = row.getCell(i + 1);
        values[h] =
          cell.value instanceof Date
            ? cell.value.toISOString().slice(0, 10)
            : typeof cell.value === 'number'
              ? cell.value
              : cell.text.trim();
      });
      result.push(values);
    });
    return result;
  }
  const invs = data('Invoices'),
    lines = data('Items'),
    payments = data('Payments');
  if (invs.length > 500) throw new Error('Maksimal 500 invoice per workbook.');
  const ids = new Set(invs.map((i) => String(i.invoice_id)));
  if (ids.size !== invs.length) throw new Error('Invoice ID pada sheet Invoices duplikat.');
  if ([...lines, ...payments].some((i) => !ids.has(String(i.invoice_id))))
    throw new Error('Ada item atau pembayaran yang tidak memiliki header invoice.');
  const str = (r: Record<string, string | number>, key: string) => String(r[key] ?? '').trim();
  const num = (r: Record<string, string | number>, key: string) =>
    r[key] === '' ? NaN : Number(r[key]);
  return invs.map((row) => {
    const c = emptyCandidate('XLSX');
    c.sourceId = str(row, 'invoice_id');
    c.number = str(row, 'invoice_number');
    c.date = str(row, 'invoice_date');
    c.customerId = str(row, 'customer_id');
    c.customer = str(row, 'customer_name');
    const status = str(row, 'business_status');
    if (!['OPEN', 'CLOSED', 'VOIDED'].includes(status))
      c.errors.push('business_status harus OPEN, CLOSED, atau VOIDED.');
    else c.businessStatus = status as ImportCandidate['businessStatus'];
    c.currency = str(row, 'currency');
    c.subtotal = num(row, 'subtotal');
    c.tax = num(row, 'tax');
    c.total = num(row, 'total');
    c.totalPaid = num(row, 'total_paid');
    c.outstanding = num(row, 'outstanding');
    c.dueDate = str(row, 'due_date') || null;
    c.items = lines
      .filter((i) => str(i, 'invoice_id') === c.sourceId)
      .map((i) => {
        const kind = str(i, 'kind');
        if (!['service', 'product', 'gift_card', 'voucher', 'tip', 'service_charge'].includes(kind))
          c.errors.push('Jenis item tidak dikenali.');
        return {
          id: str(i, 'line_id'),
          name: str(i, 'item_name'),
          kind: kind as ImportCandidate['items'][number]['kind'],
          quantity: num(i, 'quantity'),
          unitPrice: num(i, 'unit_price'),
          discount: num(i, 'discount_amount'),
          tax: num(i, 'tax_amount'),
          mapped: true,
        };
      });
    c.discount = c.items.reduce((n, i) => n + i.discount, 0);
    c.payments = payments
      .filter((p) => str(p, 'invoice_id') === c.sourceId)
      .map((p) => {
        const method = str(p, 'method');
        if (!['bank', 'cash', 'gift_card', 'voucher', 'qris', 'card', 'other'].includes(method))
          c.errors.push('Metode pembayaran tidak dikenali.');
        return {
          id: str(p, 'payment_id'),
          method: method as ImportCandidate['payments'][number]['method'],
          amount: num(p, 'amount'),
          paidAt: `${str(p, 'payment_date')}T00:00:00+07:00`,
        };
      });
    c.warnings.push(
      'Mapping kode master Accurate belum diverifikasi. Submit menggunakan draft simulasi.',
    );
    return c;
  });
}
export async function templateBuffer(example = false) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Integration Management Platform';
  const guide = workbook.addWorksheet('Guide');
  guide.addRows([
    ['TemplateVersion', '1.0'],
    [
      'Format',
      'Invoices: satu baris per invoice. Items: satu baris per item. Payments: satu baris per pembayaran.',
    ],
    ['Tanggal', 'YYYY-MM-DD, timezone Asia/Jakarta.'],
    [
      'Nominal',
      'Angka rupiah bulat tanpa Rp atau pemisah ribuan. Isi 0 jika memang nol, jangan kosongkan.',
    ],
    ['Identitas', 'ID harus berasal dari sumber dan stabil. Pilih cabang tujuan di aplikasi.'],
    ['Status', 'OPEN / CLOSED / VOIDED. Jangan menyamakan PAID dengan CLOSED.'],
    [
      'Paket',
      'Isi layanan setelah breakdown, dengan harga sebelum diskon dan discount_amount nominal. Jangan tambahkan paket induk lagi.',
    ],
    [
      'Pajak',
      'Jumlah tax_amount item harus tepat sama dengan tax header. Subtotal + tax harus sama persis dengan total sumber.',
    ],
    [
      'Pembayaran',
      'Metode: bank, cash, gift_card, voucher, qris, card, other. Jangan mengarang payment_id untuk Accurate live.',
    ],
    ['Contoh', 'File contoh berisi data fiktif untuk simulasi; bukan transaksi pelanggan asli.'],
  ]);
  guide.getColumn(1).width = 20;
  guide.getColumn(2).width = 110;
  for (const [name, cols] of Object.entries(headers)) {
    const sheet = workbook.addWorksheet(name);
    sheet.addRow(cols);
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    cols.forEach((_, i) => (sheet.getColumn(i + 1).width = 25));
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7760CB' } };
  }
  if (example) {
    const id = '00000000-0000-4000-8000-000000000001';
    workbook
      .getWorksheet('Invoices')!
      .addRow([
        id,
        'DEMO-MPA-001',
        '2026-10-15',
        'DEMO001',
        'Pelanggan Contoh',
        'CLOSED',
        'IDR',
        180180,
        19820,
        200000,
        200000,
        0,
        '',
      ]);
    workbook.getWorksheet('Items')!.addRows([
      [id, 'LINE-1', 'Collagen Dew Facial', 'service', 1, 450450, 315315, 14865],
      [id, 'LINE-2', 'Relaxing Body Massage 30 Minutes', 'service', 1, 180180, 135135, 4955],
    ]);
    workbook.getWorksheet('Payments')!.addRow([id, 'PAYMENT-DEMO-1', '2026-10-15', 'qris', 200000]);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
