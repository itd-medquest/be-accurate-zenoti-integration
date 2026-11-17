import { z } from 'zod';
import { HttpError } from './http-error.js';
import type { AccurateReceiptPayload, ReceiptVerification } from '../types/receipt.types.js';

const record = z.record(z.string(), z.unknown());
const object = (value: unknown) => record.parse(value);
const text = (value: unknown) =>
  typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
const required = (value: unknown) => {
  const result = text(value);
  if (!result) throw new Error('Missing identity');
  return result;
};
function amount(value: unknown) {
  if (
    (typeof value !== 'number' && typeof value !== 'string') ||
    (typeof value === 'string' && !value.trim())
  )
    throw new Error('Missing amount');
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0 || result > 2147483647)
    throw new Error('Invalid amount');
  return result;
}
export function receiptDate(value: string) {
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T|$)/);
  const local = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const result = iso
    ? `${iso[1]}-${iso[2]}-${iso[3]}`
    : local
      ? `${local[3]}-${local[2]}-${local[1]}`
      : '';
  return z.iso.date().parse(result);
}
function identity(nested: unknown, direct: unknown) {
  if (nested != null && direct != null && text(nested) !== text(direct))
    throw new Error('Conflicting identity');
  return required(nested ?? direct);
}
export function readReceiptInvoice(value: unknown) {
  try {
    const row = object(value),
      customer = object(row.customer),
      currency = object(row.currency);
    const outstanding = amount(row.primeOwing);
    // Invoice detail returns primeOwing; owingForPayment is also present in
    // receipt allocation snapshots, but is not required on invoice detail.
    if ('owingForPayment' in row && amount(row.owingForPayment) !== outstanding)
      throw new Error('Unsupported allocation');
    return {
      id: required(row.id),
      number: required(row.number),
      customerNo: required(customer.customerNo ?? customer.no),
      customerId: identity(customer.id, row.customerId),
      branchId: identity(row.branch && object(row.branch).id, row.branchId),
      currencyId: identity(currency.id, row.currencyId),
      currencyCode: text(currency.code ?? row.currencyCode),
      total: amount(row.totalAmount),
      outstanding,
      date: receiptDate(required(row.transDate)),
    };
  } catch {
    throw new HttpError(
      422,
      'Identitas atau saldo piutang Accurate belum lengkap/konsisten. Periksa faktur di Accurate.',
    );
  }
}
export type ReceiptInvoice = ReturnType<typeof readReceiptInvoice>;

export function readAccurateReceipt(value: unknown) {
  try {
    const row = object(value),
      bank = object(row.bank),
      customer = object(row.customer),
      currency = object(row.currency);
    if (row.voidCheq === true || row.useCredit === true || amount(row.rate) !== 1)
      throw new Error('Unsupported receipt');
    // Accurate uses a boolean flag here, not a monetary amount.
    if (row.returnOverpay !== undefined && row.returnOverpay !== false)
      throw new Error('Unsupported return overpayment');
    for (const key of ['creditUsed', 'existingCredit', 'overPay', 'overPayUsed'])
      if (row[key] != null && amount(row[key]) !== 0)
        throw new Error('Unsupported credit/overpayment');
    if (!Array.isArray(row.detailInvoice) || !row.detailInvoice.length)
      throw new Error('Missing allocation');
    return {
      id: required(row.id),
      number: required(row.number),
      bankNo: required(bank.no),
      bankId: identity(bank.id, row.bankId),
      customerNo: required(customer.customerNo ?? customer.no),
      customerId: identity(customer.id, row.customerId),
      branchId: required(row.branchId),
      currencyId: identity(currency.id, row.currencyId),
      currencyCode: text(currency.code ?? row.currencyCode),
      date: receiptDate(required(row.transDate)),
      method: required(row.paymentMethod),
      description: required(row.description),
      net: amount(row.chequeAmount),
      totalPayment: amount(row.totalPayment),
      totalDiscount: amount(row.totalDiscount),
      allocations: row.detailInvoice.map((value) => {
        const line = object(value),
          invoice = object(line.invoice);
        if (line.paidPph === true || (line.pphAmount != null && amount(line.pphAmount) !== 0))
          throw new Error('Unsupported tax');
        const discounts = line.detailDiscount ?? [];
        if (!Array.isArray(discounts)) throw new Error('Invalid discounts');
        return {
          invoiceId: identity(invoice.id, line.invoiceId),
          invoiceNo: required(invoice.number),
          gross: amount(line.paymentAmount),
          net: amount(line.invoicePayment),
          fee: amount(line.discountAmount),
          discounts: discounts.map((value) => {
            const discount = object(value),
              account = object(discount.account);
            return {
              accountNo: required(account.no),
              accountId: identity(account.id, discount.accountId),
              amount: amount(discount.amount),
            };
          }),
        };
      }),
    };
  } catch {
    throw new HttpError(
      422,
      'Detail penerimaan Accurate belum lengkap atau memiliki alokasi yang tidak didukung. Jangan kirim ulang.',
    );
  }
}
export type AccurateReceiptResult = ReturnType<typeof readAccurateReceipt>;

export function verifyAccurateReceipt(
  result: AccurateReceiptResult,
  payload: AccurateReceiptPayload,
  verification: ReceiptVerification,
) {
  const expected = payload.detailInvoice[0],
    allocation = result.allocations[0];
  const fee = expected.detailDiscount?.reduce((sum, row) => sum + row.amount, 0) ?? 0;
  if (
    result.number !== payload.number ||
    result.bankNo !== payload.bankNo ||
    result.bankId !== verification.bankId ||
    result.customerNo !== payload.customerNo ||
    result.customerId !== verification.customerId ||
    result.branchId !== String(payload.branchId) ||
    result.currencyId !== verification.currencyId ||
    (result.currencyCode && result.currencyCode !== 'IDR') ||
    result.date !== receiptDate(payload.transDate) ||
    result.method !== payload.paymentMethod ||
    result.description !== payload.description ||
    result.net !== payload.chequeAmount ||
    result.totalPayment !== payload.chequeAmount ||
    result.totalDiscount !== fee ||
    result.allocations.length !== 1 ||
    allocation.invoiceId !== verification.invoiceId ||
    allocation.invoiceNo !== expected.invoiceNo ||
    allocation.gross !== expected.paymentAmount ||
    allocation.net !== payload.chequeAmount ||
    allocation.fee !== fee ||
    allocation.gross !== allocation.net + allocation.fee ||
    allocation.discounts.length !== (expected.detailDiscount?.length ?? 0) ||
    allocation.discounts.some(
      (row, index) =>
        row.accountNo !== expected.detailDiscount?.[index]?.accountNo ||
        row.accountId !== verification.feeAccountId ||
        row.amount !== expected.detailDiscount?.[index]?.amount,
    )
  )
    throw new HttpError(
      422,
      'Penerimaan ditemukan, tetapi identitas, akun, referensi, atau alokasinya berbeda. Periksa Accurate; transaksi tidak dikirim ulang.',
    );
  return result;
}
