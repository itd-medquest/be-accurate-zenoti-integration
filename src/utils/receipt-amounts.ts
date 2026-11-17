import { createHash } from 'node:crypto';
import type { InvoicePayment } from '../types/invoice.types.js';
import {
  receiptBanks,
  receiptMethods,
  receiptRates,
  type ReceiptBank,
  type ReceiptMethod,
  type ReceiptSourceGroup,
} from '../types/receipt.types.js';

const MAX_RUPIAH = 2_147_483_647;
export function receiptAmounts(gross: number, bank: ReceiptBank, method: ReceiptMethod) {
  if (!Number.isSafeInteger(gross) || gross <= 0 || gross > MAX_RUPIAH)
    throw new Error(
      'Nominal pembayaran harus berupa rupiah bulat positif dalam batas yang didukung.',
    );
  if (!receiptBanks.includes(bank) || !receiptMethods.includes(method))
    throw new Error('Bank atau metode pembayaran belum didukung.');
  const rateBps = receiptRates[method];
  // Finance: BCA/BNI rates, with every fractional rupiah rounded upward.
  const fee = Number((BigInt(gross) * BigInt(rateBps) + 9999n) / 10000n);
  return { gross, rateBps, fee, net: gross - fee };
}

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Only item allocations from Sales Accrual are coalesced; distinct PDF/Excel payments stay distinct. */
export function receiptSourceGroups(payments: InvoicePayment[]): ReceiptSourceGroup[] {
  const groups = new Map<string, InvoicePayment[]>();
  const seen = new Set<string>();
  for (const payment of payments) {
    if (!payment.id || seen.has(payment.id))
      throw new Error('Identitas pembayaran sumber kosong atau berulang.');
    seen.add(payment.id);
    if (
      !Number.isSafeInteger(payment.amount) ||
      payment.amount < 0 ||
      !Number.isFinite(Date.parse(payment.paidAt))
    )
      throw new Error('Nominal atau tanggal pembayaran sumber tidak valid.');
    if (!payment.amount) continue;
    const key = payment.id.endsWith(':collection')
      ? `allocation:${payment.method}:${payment.paidAt}`
      : `payment:${payment.id}`;
    groups.set(key, [...(groups.get(key) ?? []), payment]);
  }
  return [...groups.values()].map((entries) => {
    const ordered = [...entries].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const gross = ordered.reduce((sum, payment) => sum + payment.amount, 0);
    if (!Number.isSafeInteger(gross) || gross > MAX_RUPIAH)
      throw new Error('Total pembayaran sumber melebihi batas yang didukung.');
    return {
      key: digest(ordered.map((payment) => payment.id)),
      fingerprint: digest(ordered),
      method: ordered[0].method,
      paidAt: ordered[0].paidAt,
      gross,
      payments: ordered,
      grouped: ordered.some((payment) => payment.id.endsWith(':collection')),
    };
  });
}
