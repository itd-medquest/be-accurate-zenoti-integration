import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import type { ImportCandidate, ImportPayment } from '../../types/import.types.js';
import { percentageDiscountAmount } from '../discount.js';
import { emptyCandidate } from '../import-validation.js';
export const salesHeaders = [
  'Item Type',
  'Sale Date',
  'Invoice No',
  'Guest Code',
  'Guest Name',
  'Center Code',
  'Center Name',
  'Item Code',
  'Item Name',
  'Qty',
  'Sales (Exc. Tax)',
  'Tax',
  'Sales(Inc. Tax)',
  'Redeemed',
  'Collected',
  'Due',
  'Invoice Date',
  'Invoice Closed Date',
  'Receipt No',
  'Item Category Code',
  'Item Category',
  'Item Subcategory',
  'Discount Name',
  'Discount',
  'Payment Type',
  'Sale Type',
  'Equipment',
  'Invoice status',
  'Referral Source',
  'Referred By',
  'First Visit',
  'Price',
  'Invoice Source',
  'Sales (Exc. Redemption)',
  'Vendor Name',
  'Brand Name',
  'Display name',
  'Company name',
  'TIN #',
  'TOT #',
  'VAT #',
  'Business Unit',
  'Room',
  'Closed By',
  'Consultant',
  'Sold By Code',
  'Sold By',
  'Invoice created by',
  'Invoice Notes',
  'Member',
  'Base Invoice No',
  'Taxable Redemption',
  'Non Taxable Redemption',
  'Optional field 1',
  'Optional field 2',
  'Optional field 3',
  'Optional field 4',
  'Optional field 5',
  'Optional field 6',
  'Optional field 7',
  'Optional field 8',
  'Optional field 9',
  'Optional field 10',
  'Refund Reason',
  'Service Shop Cost',
  'Guest gender',
  'Guest nationality',
];
function date(cell: ExcelJS.Cell) {
  if (cell.value instanceof Date) return cell.value.toISOString().slice(0, 10);
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(cell.text.trim());
  if (!m) return '';
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  const timestamp = Date.parse(iso);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === iso
    ? iso
    : '';
}
export function parseSalesAccrual(sheet: ExcelJS.Worksheet): ImportCandidate[] {
  if (sheet.rowCount > 2004 || sheet.columnCount > 100)
    throw new Error('Sales Accrual maksimal 2.000 baris dan 100 kolom.');
  const cols = new Map<string, number>();
  sheet.getRow(4).eachCell((c, i) => cols.set(c.text.trim(), i));
  for (const h of salesHeaders
    .slice(0, 19)
    .concat(['Discount', 'Payment Type', 'Sale Type', 'Invoice status', 'Price']))
    if (!cols.has(h)) throw new Error(`Kolom Sales Accrual tidak tersedia: ${h}.`);
  const groups = new Map<string, ExcelJS.Row[]>();
  for (let n = 5; n <= sheet.rowCount; n++) {
    const row = sheet.getRow(n),
      type = row.getCell(1).text.trim();
    if (!type || /^Total\s*:/i.test(type)) continue;
    const inv = row.getCell(cols.get('Invoice No')!).text.trim(),
      center = row.getCell(cols.get('Center Code')!).text.trim();
    const key = inv && center ? `${center}:${inv}` : `missing-identity:row:${n}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  if (groups.size > 500) throw new Error('Maksimal 500 invoice per workbook.');
  return [...groups.entries()].map(([key, rows]) => {
    const c = emptyCandidate('XLSX'),
      first = rows[0];
    const cell = (r: ExcelJS.Row, h: string) => r.getCell(cols.get(h)!);
    const text = (r: ExcelJS.Row, h: string) => cell(r, h).text.trim();
    const num = (r: ExcelJS.Row, h: string) => {
      const v = cell(r, h).value;
      return typeof v === 'number'
        ? v
        : v && typeof v === 'object' && 'result' in v && typeof v.result === 'number'
          ? v.result
          : NaN;
    };
    c.sourceId = key.startsWith('missing-identity:') ? '' : `zenoti:${key}`;
    c.sourceInvoiceNumber = text(first, 'Invoice No');
    c.sourceEntries = rows.map((r) => ({
      row: r.number,
      invoiceNumber: text(r, 'Invoice No'),
      receiptNumber: text(r, 'Receipt No'),
      itemName: text(r, 'Item Name'),
      quantity: num(r, 'Qty'),
      net: num(r, 'Sales (Exc. Tax)'),
      tax: num(r, 'Tax'),
      total: num(r, 'Sales(Inc. Tax)'),
    }));
    for (const row of rows) {
      if (!text(row, 'Invoice No') || !text(row, 'Center Code'))
        c.errors.push(`Invoice No / Center Code kosong di baris ${row.number}.`);
      row.eachCell((cell) => {
        const v = cell.value;
        if (v && typeof v === 'object' && ('formula' in v || 'sharedFormula' in v))
          c.errors.push(
            `Formula pada baris data ${row.number}, sel ${cell.address}: gunakan nilai asli sebelum submit. Formula tidak dijalankan.`,
          );
        if (v && typeof v === 'object' && 'hyperlink' in v)
          c.warnings.push(
            `Teks tautan pada ${cell.address} dibaca sebagai teks; tautan tidak dibuka.`,
          );
      });
    }
    c.number = text(first, 'Receipt No') || text(first, 'Invoice No');
    c.customer = text(first, 'Guest Name');
    c.customerId = text(first, 'Guest Code');
    c.sourceCenter = text(first, 'Center Code');
    c.sourceSheet = sheet.name;
    c.sourceRows = rows.map((r) => r.number);
    c.date = date(cell(first, 'Invoice Date'));
    const status = text(first, 'Invoice status').toLowerCase();
    c.businessStatus = status === 'closed' ? 'CLOSED' : status === 'open' ? 'OPEN' : 'UNKNOWN';
    const identities = ['Guest Code', 'Guest Name', 'Invoice Date', 'Invoice status', 'Receipt No'];
    if (rows.some((r) => identities.some((h) => text(r, h) !== text(first, h))))
      c.errors.push('Identitas, tanggal, receipt atau status berbeda dalam satu invoice.');
    const occurrences = new Map<string, number>();
    for (const r of rows) {
      const type = text(r, 'Item Type').toLowerCase(),
        qty = num(r, 'Qty'),
        price = num(r, 'Price'),
        sourceDiscount = cell(r, 'Discount'),
        percentText = /^(\d+(?:[.,]\d+)?)\s*%$/.exec(sourceDiscount.text.trim()),
        discountPercent =
          typeof sourceDiscount.value === 'number' && /%/.test(sourceDiscount.numFmt)
            ? sourceDiscount.value * 100
            : percentText
              ? Number(percentText[1].replace(',', '.'))
              : undefined,
        discount =
          discountPercent === undefined
            ? num(r, 'Discount')
            : percentageDiscountAmount(qty * price, discountPercent),
        tax = num(r, 'Tax'),
        net = num(r, 'Sales (Exc. Tax)'),
        gross = num(r, 'Sales(Inc. Tax)'),
        paid = num(r, 'Collected'),
        due = num(r, 'Due'),
        redeemed = num(r, 'Redeemed');
      const signature = JSON.stringify([
        text(r, 'Item Code'),
        text(r, 'Item Name'),
        qty,
        price,
        discount,
        tax,
        net,
        gross,
        text(r, 'Payment Type'),
        text(r, 'Sale Date'),
      ]);
      const hash = createHash('sha256').update(signature).digest('hex').slice(0, 20),
        occurrence = (occurrences.get(hash) ?? 0) + 1;
      occurrences.set(hash, occurrence);
      const id = `${c.sourceId}:${hash}:${occurrence}`;
      const kind =
        type === 'service'
          ? 'service'
          : type === 'product'
            ? 'product'
            : type === 'package'
              ? 'service'
              : null;
      if (!kind) c.errors.push(`Jenis item ${text(r, 'Item Type')} memerlukan review khusus.`);

      if (redeemed !== 0)
        c.errors.push(
          'Pemakaian paket / redemption ditahan agar pendapatan tidak dicatat dua kali.',
        );
      if (text(r, 'Sale Type').toLowerCase() !== 'sale')
        c.errors.push('Refund/koreksi memerlukan review khusus.');
      if (qty * price - discount !== net || net + tax !== gross)
        c.errors.push(
          `Nilai item pada baris ${r.number} tidak cocok dengan harga, diskon, dan pajak sumber.`,
        );
      if (paid + due + redeemed !== gross)
        c.errors.push(
          `Collected + Due + Redeemed berbeda dari Sales(Inc. Tax) pada baris ${r.number}.`,
        );
      c.items.push({
        id,
        name: text(r, 'Item Name'),
        kind: kind ?? 'service',
        quantity: qty,
        unitPrice: price,
        discount,
        discountPercent,
        tax,
        mapped: true,
      });
      if (type === 'package') (c.packageParents ??= []).push({ ...c.items[c.items.length - 1] });
      c.subtotal += net;
      c.tax += tax;
      c.total += gross;
      c.totalPaid += paid;
      c.outstanding += due;
      c.discount += discount;
      if (paid > 0) {
        const payment = text(r, 'Payment Type').toLowerCase();
        let method: ImportPayment['method'] = /qris/.test(payment)
          ? 'qris'
          : /cash/.test(payment)
            ? 'cash'
            : /card/.test(payment)
              ? 'card'
              : /bank|transfer/.test(payment)
                ? 'bank'
                : 'other';
        if (method === 'other' || /[,;]|\s\+\s/.test(payment))
          c.errors.push(`Metode pembayaran di baris ${r.number} memerlukan rincian/alokasi.`);
        c.payments.push({
          id: `${id}:collection`,
          method,
          amount: paid,
          paidAt: `${date(cell(r, 'Sale Date'))}T00:00:00+07:00`,
        });
      }
    }
    c.items.sort((a, b) => a.id.localeCompare(b.id));
    c.payments.sort((a, b) => a.id.localeCompare(b.id));
    c.warnings.push(
      'Sumber Sales Accrual: satu invoice menggabungkan seluruh baris Invoice No + Center Code. Identitas item/pembayaran diturunkan untuk simulasi; bukan ID transaksi API Zenoti.',
    );
    c.warnings.push(
      'Sales Accrual tidak memuat rincian manfaat paket. Nilai sumber dipertahankan tanpa penyesuaian pembulatan.',
    );
    return c;
  });
}
export async function salesTemplateBuffer(example = false) {
  const w = new ExcelJS.Workbook(),
    s = w.addWorksheet('Sales-Accrual');
  s.addRow(['Perusahaan Contoh']);
  s.addRow(['Sales-Accrual — contoh struktur export Zenoti, data fiktif']);
  s.addRow([]);
  s.addRow(salesHeaders);
  s.views = [{ state: 'frozen', ySplit: 4, xSplit: 3 }];
  s.getRow(4).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  s.getRow(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7760CB' } };
  s.columns.forEach((col) => (col.width = 24));
  if (example) {
    const values: Record<string, string | number> = {
      'Item Type': 'Service',
      'Sale Date': '15/10/2026',
      'Invoice No': 'DEMO-001',
      'Guest Code': 'DEMO001',
      'Guest Name': 'Pelanggan Contoh',
      'Center Code': 'MPA',
      'Center Name': 'Cabang Contoh',
      'Item Code': 'DEMO-SVC',
      'Item Name': 'Layanan Contoh',
      Qty: 1,
      'Sales (Exc. Tax)': 180180,
      Tax: 19820,
      'Sales(Inc. Tax)': 200000,
      Redeemed: 0,
      Collected: 200000,
      Due: 0,
      'Invoice Date': '15/10/2026',
      'Invoice Closed Date': '15/10/2026',
      'Receipt No': 'DEMO-R001',
      Discount: 0,
      'Payment Type': 'Custom - QRIS',
      'Sale Type': 'Sale',
      'Invoice status': 'Closed',
      Price: 180180,
    };
    s.addRow(salesHeaders.map((h) => values[h] ?? ''));
  }
  return Buffer.from(await w.xlsx.writeBuffer());
}
