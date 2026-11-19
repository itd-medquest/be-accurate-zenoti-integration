import type { ImportCandidate } from '../types/import.types.js';
import type { InvoicePayment } from '../types/invoice.types.js';

/** Resolve the document receipt, never the invoice number or Finance's reference. */
export function sourceReceiptNumber(
  payments: InvoicePayment[],
  candidates: ImportCandidate[],
): string | null {
  const numbers = new Set<string | null>();
  const add = (value: string) => {
    const number = value.trim();
    numbers.add(!number || /^0+$/.test(number) ? null : number);
  };
  for (const candidate of candidates) {
    if (!payments.every((payment) => candidate.payments.some((row) => row.id === payment.id)))
      continue;
    if (candidate.receiptNumber !== undefined) add(candidate.receiptNumber);
    else if (candidate.sourceEntries?.length)
      for (const entry of candidate.sourceEntries) add(entry.receiptNumber);
    else if (candidate.sourceFormat === 'PDF') add(candidate.number);
  }
  // Existing PDF payments already carry the parsed receipt in their immutable ID.
  for (const payment of payments) {
    const match = /:receipt:([^:]+):[1-9]\d*$/.exec(payment.id);
    if (match) add(match[1]);
  }
  if (!payments.length || numbers.size > 1)
    throw new Error(
      'Nomor receipt pada dokumen sumber tidak konsisten. Periksa dokumen sebelum melanjutkan.',
    );
  const number = [...numbers][0] ?? null;
  if (!number) return null;
  if (number.length > 255 || /[\u0000-\u001f\u007f]/.test(number))
    throw new Error('Nomor receipt pada dokumen sumber tidak valid.');
  return number;
}

/** Unique draft identity until Finance supplies the missing receipt; never sent. */
export const pendingReceiptNumber = (id: string) => `INT-PENDING-RC-${id}`;
