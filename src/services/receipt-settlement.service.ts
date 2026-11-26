import * as receipts from '../repositories/receipts.repository.js';
import type { DbExecutor } from '../repositories/unit-of-work.repository.js';
import type { accurateReceipts } from '../db/schema/receipts.schema.js';
import type { ReceiptSourceGroup, ReceiptMethod } from '../types/receipt.types.js';
import { settlementAmounts, type ReceiptAmountMode } from '../utils/receipt-settlement.js';
import { HttpError } from '../utils/http-error.js';
import { isSimulationReceipt } from '../utils/receipt-mode.js';

type Receipt = typeof accurateReceipts.$inferSelect;
export const paymentKey = (row: Receipt) => row.paymentSourceKey ?? row.sourceKey;
export function sourceProgress(group: ReceiptSourceGroup, records: Receipt[]) {
  const stages = records
    .filter((row) => paymentKey(row) === group.key)
    .sort(
      (a, b) =>
        a.receiptSequence - b.receiptSequence || a.createdAt.getTime() - b.createdAt.getTime(),
    );
  const completed = stages.filter((row) => row.status === 'SUCCEEDED');
  const settled = completed.reduce((sum, row) => sum + row.grossAmount, 0);
  return { stages, completed, settled, remaining: Math.max(0, group.gross - settled) };
}
export async function allocationAmounts(
  row: Receipt,
  group: ReceiptSourceGroup,
  method: ReceiptMethod,
  mode: ReceiptAmountMode,
  amount?: number | null,
  context?: DbExecutor,
  rateBps = row.rateBps,
) {
  const records = (await receipts.forInvoice(row.invoiceId, context)).filter(
    (record) => isSimulationReceipt(record) === isSimulationReceipt(row),
  );
  const progress = sourceProgress(
    group,
    records.filter((record) => record.id !== row.id),
  );
  if (
    progress.settled > group.gross ||
    progress.stages.some((record) => record.status !== 'SUCCEEDED')
  )
    throw new HttpError(
      409,
      'Ada tahap lain untuk pembayaran ini yang belum selesai. Periksa riwayat penerimaan.',
    );
  const bucket = progress.completed.filter(
    (record) => record.method === method && record.rateBps === rateBps,
  );
  try {
    return settlementAmounts({
      remaining: progress.remaining,
      priorGross: bucket.reduce((sum, record) => sum + record.grossAmount, 0),
      priorFee: bucket.reduce((sum, record) => sum + record.feeAmount, 0),
      rateBps,
      mode,
      amount,
    });
  } catch (cause) {
    throw new HttpError(
      422,
      cause instanceof Error ? cause.message : 'Nominal penerimaan tidak valid.',
    );
  }
}

export function receiptMode(value: string): ReceiptAmountMode {
  if (value === 'FULL' || value === 'NET' || value === 'GROSS') return value;
  throw new HttpError(422, 'Jenis nominal penerimaan tidak valid.');
}
