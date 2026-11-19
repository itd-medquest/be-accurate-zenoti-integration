import { createHash } from 'node:crypto';
import type { ImportCandidate } from '../types/import.types.js';
import { percentageDiscountAmount, validUnitPrice } from './discount.js';
import { roundedPercentageAmount } from './package-calculation.js';
import { redemptionAmount, isConsultation, isFreeConsultation } from './redemption.js';
export function allocateTax(nets: number[], total: number) {
  const base = nets.reduce((a, b) => a + b, 0);
  if (base <= 0) return nets.map(() => 0);
  const shares = nets.map((net, index) => ({
    index,
    exact: (net * total) / base,
    value: Math.floor((net * total) / base),
  }));
  let remaining = total - shares.reduce((n, p) => n + p.value, 0);
  for (const part of [...shares].sort(
    (a, b) => b.exact - b.value - (a.exact - a.value) || a.index - b.index,
  )) {
    if (remaining-- <= 0) break;
    part.value++;
  }
  return shares.map((p) => p.value);
}
export function candidateErrors(c: ImportCandidate) {
  const errors = [...c.errors];
  if (
    c.items.some(
      (i) =>
        i.discountPercent !== undefined &&
        (i.discountRoundingAdjustment === undefined
          ? percentageDiscountAmount(i.quantity * i.unitPrice, i.discountPercent) !== i.discount
          : !Number.isSafeInteger(i.discountRoundingAdjustment) ||
            Math.abs(i.discountRoundingAdjustment) > 2 ||
            roundedPercentageAmount(i.quantity * i.unitPrice, i.discountPercent) +
              i.discountRoundingAdjustment !==
              i.discount),
    )
  )
    errors.push(
      'Persentase diskon tidak sesuai nilai item sumber; nominal pecahan rupiah tidak dibulatkan otomatis.',
    );
  if (
    c.items.some(
      (i) =>
        i.taxPercent !== undefined &&
        (!Number.isSafeInteger(i.taxRoundingAdjustment ?? 0) ||
          Math.abs(i.taxRoundingAdjustment ?? 0) > 2 ||
          roundedPercentageAmount(i.quantity * i.unitPrice - i.discount, i.taxPercent) +
            (i.taxRoundingAdjustment ?? 0) !==
            i.tax),
    )
  )
    errors.push('Persentase pajak tidak sesuai nilai pajak item.');
  if (!c.sourceId) errors.push('Identitas invoice sumber tidak ditemukan.');
  if (!c.number && !c.sourceInvoiceNumber) errors.push('Nomor invoice/receipt belum tersedia.');
  if (!c.customer || !c.customerId) errors.push('Nama atau ID customer belum tersedia.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.date) || !Number.isFinite(Date.parse(c.date)))
    errors.push('Tanggal invoice tidak valid.');
  if (c.currency !== 'IDR') errors.push('Versi impor ini hanya menerima IDR.');
  if (!c.items.length) errors.push('Detail item tagihan belum lengkap.');
  if (c.items.some((item) => isConsultation(item) && !isFreeConsultation(item)))
    errors.push(
      'Consultation harus bernilai Rp0 tanpa diskon atau pajak. Periksa pembacaan dan dokumen sumber.',
    );
  const amounts = [
    c.subtotal,
    c.discount,
    c.tax,
    c.total,
    c.totalPaid,
    c.outstanding,
    ...c.items.flatMap((i) => [i.discount, i.tax]),
    ...c.payments.map((p) => p.amount),
  ];
  if (amounts.some((n) => !Number.isSafeInteger(n) || n < 0 || n > 2147483647))
    errors.push('Nominal harus rupiah bulat, non-negatif, maksimal 2.147.483.647.');
  if (
    c.items.some(
      (i) =>
        !i.id ||
        !i.name ||
        !Number.isFinite(i.quantity) ||
        i.quantity <= 0 ||
        !validUnitPrice(i.unitPrice) ||
        !Number.isSafeInteger(i.quantity * i.unitPrice) ||
        i.discount > i.quantity * i.unitPrice,
    )
  )
    errors.push('ID, nama, kuantitas, atau diskon item tidak valid.');
  if (
    c.dueDate &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(c.dueDate) || !Number.isFinite(Date.parse(c.dueDate)))
  )
    errors.push('Jatuh tempo tidak valid.');
  if (c.items.reduce((n, i) => n + i.unitPrice * i.quantity - i.discount, 0) !== c.subtotal)
    errors.push('Jumlah item setelah diskon tidak sama dengan subtotal.');
  if (c.items.reduce((n, i) => n + i.tax, 0) !== c.tax)
    errors.push('Jumlah pajak item tidak sama dengan pajak invoice.');
  if (
    c.items.some(
      (item) => item.redeemed && (item.tax !== 0 || item.discount !== 0 || !item.redemptionNote),
    )
  )
    errors.push(
      'Item redeem harus memiliki penanda sumber, tanpa alokasi diskon atau pajak penjualan baru.',
    );
  if (c.subtotal - redemptionAmount(c.items) + c.tax !== c.total)
    errors.push(
      c.items.some((item) => item.redeemed)
        ? 'Subtotal setelah pengurangan redeem + pajak tidak sama dengan total invoice.'
        : 'Subtotal + pajak tidak sama dengan total invoice.',
    );
  if (c.totalPaid + c.outstanding !== c.total)
    errors.push('Total dibayar + outstanding tidak sama dengan total invoice.');
  if (c.payments.reduce((n, p) => n + p.amount, 0) !== c.totalPaid)
    errors.push('Rincian pembayaran tidak sama dengan total dibayar.');
  if (c.payments.some((p) => !p.id || !Number.isFinite(Date.parse(p.paidAt))))
    errors.push('Identitas/tanggal pembayaran tidak valid.');
  if (
    new Set(c.items.map((i) => i.id)).size !== c.items.length ||
    new Set(c.payments.map((p) => p.id)).size !== c.payments.length
  )
    errors.push('Identitas item/pembayaran duplikat.');
  return [...new Set(errors)];
}
export function candidateHash(c: ImportCandidate) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        sourceId: c.sourceId,
        number: c.number,
        customerId: c.customerId,
        date: c.date,
        dueDate: c.dueDate,
        businessStatus: c.businessStatus,
        currency: c.currency,
        subtotal: c.subtotal,
        tax: c.tax,
        total: c.total,
        totalPaid: c.totalPaid,
        outstanding: c.outstanding,
        items: c.items.map(
          ({
            discountPercent,
            discountRoundingAdjustment,
            taxPercent,
            taxRoundingAdjustment,
            ...item
          }) => item,
        ),
        payments: c.payments,
      }),
    )
    .digest('hex');
}
export function emptyCandidate(format: 'PDF' | 'XLSX'): ImportCandidate {
  return {
    sourceId: '',
    number: '',
    customer: '',
    customerId: '',
    date: '',
    dueDate: null,
    businessStatus: 'UNKNOWN',
    currency: 'IDR',
    subtotal: 0,
    discount: 0,
    tax: 0,
    total: 0,
    totalPaid: 0,
    outstanding: 0,
    items: [],
    payments: [],
    benefits: [],
    packageName: null,
    sourceFormat: format,
    warnings: [],
    errors: [],
  };
}
