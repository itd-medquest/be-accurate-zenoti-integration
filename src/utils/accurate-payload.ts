import type { ImportCandidate } from '../types/import.types.js';
import type { AccuratePayload } from '../types/accurate.types.js';
import { HttpError } from './http-error.js';
import { candidateErrors } from './import-validation.js';
import { chargeableItems, isFullRedemption, isLocalOnlyInvoice } from './redemption.js';

export type AccurateDestination = { databaseId: string; targetBranchId: string };
export function liveInvoiceErrors(candidate: ImportCandidate, destination?: AccurateDestination) {
  const errors: string[] = [];
  if (isLocalOnlyInvoice(candidate)) {
    if (!candidate.accountingReviewedAt)
      errors.push('Konfirmasikan pemeriksaan invoice yang disimpan lokal sebelum menyimpan.');
    if (!['OPEN', 'CLOSED'].includes(candidate.businessStatus))
      errors.push('Pilih Status Invoices Open atau Closed setelah memeriksa sumber.');
    return errors;
  }
  if (!destination) errors.push('Mapping cabang Accurate aktual belum tersedia di Settings.');
  const selection = candidate.accurateSelection;
  if (
    !selection ||
    !destination ||
    selection.databaseId !== destination.databaseId ||
    selection.targetBranchId !== destination.targetBranchId
  )
    errors.push('Pilih customer dan item Accurate untuk tujuan cabang saat ini.');
  else {
    if (!selection.customer?.code) errors.push('Customer Accurate belum dipilih.');
    if (
      chargeableItems(candidate.items).some(
        (item) => !selection.items[item.id]?.code || !selection.items[item.id]?.unitName,
      )
    )
      errors.push('Pemetaan kode item dan satuan Accurate belum lengkap.');
  }
  if (candidate.sourceFormat === 'PDF' && !candidate.sourceInvoiceNumber)
    errors.push(
      'Nomor Invoice No. belum terbaca. Gunakan dokumen yang memuat nomor faktur, bukan hanya nomor receipt.',
    );
  if (!candidate.accountingReviewedAt)
    errors.push('Konfirmasikan pemeriksaan setelah melengkapi mapping Accurate.');
  if (!['OPEN', 'CLOSED'].includes(candidate.businessStatus))
    errors.push('Pilih Status Invoices Open atau Closed setelah memeriksa sumber.');
  return errors;
}
export function buildAccuratePayload(
  candidate: ImportCandidate,
  destination: AccurateDestination,
): AccuratePayload {
  if (isLocalOnlyInvoice(candidate))
    throw new HttpError(
      422,
      `Invoice ${isFullRedemption(candidate) ? 'full redeem' : 'Consultation gratis'} hanya disimpan di intgrte; tidak dikirim ke Accurate.`,
    );
  const errors = [...candidateErrors(candidate), ...liveInvoiceErrors(candidate, destination)];
  if (errors.length) throw new HttpError(422, errors.join(' '));
  const selection = candidate.accurateSelection;
  if (!selection?.customer) throw new HttpError(422, 'Customer Accurate belum dipilih.');
  const [year, month, day] = candidate.date.split('-');
  const payload: AccuratePayload = {
    number: candidate.sourceInvoiceNumber || candidate.number,
    customerNo: selection.customer.code,
    transDate: `${day}/${month}/${year}`,
    shipDate: `${day}/${month}/${year}`,
    branchId: destination.targetBranchId,
    currencyCode: 'IDR',
    description: `${candidate.customer} - ${[...new Set(chargeableItems(candidate.items).map((item) => item.name))].join(', ')}`,
    reverseInvoice: 'false',
    taxable: 'false',
    inclusiveTax: 'false',
  };
  chargeableItems(candidate.items).forEach((item, index) => {
    const mapping = selection.items[item.id];
    const final = item.quantity * item.unitPrice - item.discount + item.tax;
    const price = Number((final / item.quantity).toFixed(6));
    if (
      !Number.isFinite(price) ||
      price < 0 ||
      item.quantity <= 0 ||
      Math.round(price * item.quantity) !== final
    )
      throw new HttpError(
        422,
        `Harga akhir ${item.name} tidak dapat dikirim dengan presisi 6 desimal. Periksa qty dan harga.`,
      );
    payload[`detailItem[${index}].itemNo`] = mapping.code;
    payload[`detailItem[${index}].unitPrice`] = String(price);
    payload[`detailItem[${index}].quantity`] = String(item.quantity);
    payload[`detailItem[${index}].itemUnitName`] = mapping.unitName;
  });
  return payload;
}
