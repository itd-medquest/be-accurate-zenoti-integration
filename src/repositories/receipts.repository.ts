import { and, desc, eq, inArray, isNotNull, lt, ne, or } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  accurateDeliveries,
  accurateReceipts,
  invoices,
  receiptAccountMappings,
} from '../db/schema/index.js';
import type { DbExecutor } from './unit-of-work.repository.js';
import { isDuplicateEntry } from './mysql-errors.js';

export function sources(context: DbExecutor = db) {
  return context
    .select({
      invoiceId: invoices.id,
      branchId: invoices.branchId,
      invoiceNumber: invoices.number,
      customer: invoices.customer,
      date: invoices.date,
      total: invoices.total,
      sourceId: invoices.sourceId,
      payments: invoices.payments,
      sourceVersion: invoices.version,
      databaseId: accurateDeliveries.databaseId,
      targetId: accurateDeliveries.targetId,
      targetNumber: accurateDeliveries.targetNumber,
      targetBranchId: accurateDeliveries.targetBranchId,
      invoicePayload: accurateDeliveries.payload,
      deliveredVersion: accurateDeliveries.sourceVersion,
      expectedTotal: accurateDeliveries.expectedTotal,
      exception: invoices.exception,
      businessStatus: invoices.businessStatus,
    })
    .from(accurateDeliveries)
    .innerJoin(invoices, eq(invoices.id, accurateDeliveries.invoiceId))
    .where(eq(accurateDeliveries.status, 'SUCCEEDED'))
    .orderBy(desc(invoices.date));
}
export function pending(context: DbExecutor = db) {
  return context
    .select()
    .from(accurateReceipts)
    .where(eq(accurateReceipts.status, 'QUEUED'))
    .orderBy(accurateReceipts.queuedAt)
    .limit(20);
}
export function lockInvoice(id: string, context: DbExecutor, skipLocked = false) {
  return context
    .select({ id: invoices.id })
    .from(invoices)
    .where(eq(invoices.id, id))
    .for('update', skipLocked ? { skipLocked: true } : undefined);
}
export function unresolved(invoiceId: string, exceptId: string, context: DbExecutor) {
  return context
    .select({ id: accurateReceipts.id })
    .from(accurateReceipts)
    .where(
      and(
        eq(accurateReceipts.invoiceId, invoiceId),
        ne(accurateReceipts.id, exceptId),
        or(
          inArray(accurateReceipts.status, ['QUEUED', 'SENDING']),
          and(eq(accurateReceipts.status, 'NEEDS_REVIEW'), isNotNull(accurateReceipts.attemptedAt)),
        ),
      ),
    )
    .limit(1);
}
export function stale(context: DbExecutor = db) {
  return context
    .select()
    .from(accurateReceipts)
    .where(
      and(
        eq(accurateReceipts.status, 'SENDING'),
        lt(accurateReceipts.updatedAt, new Date(Date.now() - 5 * 60000)),
      ),
    );
}
export const mappings = (context: DbExecutor = db) => context.select().from(receiptAccountMappings);
export const mapping = (id: string, context: DbExecutor = db) =>
  context.query.receiptAccountMappings.findFirst({ where: eq(receiptAccountMappings.id, id) });
export const list = (context: DbExecutor = db) =>
  context
    .select({
      draft: accurateReceipts,
      invoiceNumber: invoices.number,
      customer: invoices.customer,
      total: invoices.total,
    })
    .from(accurateReceipts)
    .innerJoin(invoices, eq(invoices.id, accurateReceipts.invoiceId))
    .orderBy(desc(accurateReceipts.createdAt));
export const find = (id: string, context: DbExecutor = db) =>
  context.query.accurateReceipts.findFirst({ where: eq(accurateReceipts.id, id) });
export function lock(id: string, context: DbExecutor) {
  return context.select().from(accurateReceipts).where(eq(accurateReceipts.id, id)).for('update');
}
export function sourceDraft(invoiceId: string, sourceKey: string, context: DbExecutor = db) {
  return context.query.accurateReceipts.findFirst({
    where: and(
      eq(accurateReceipts.invoiceId, invoiceId),
      eq(accurateReceipts.sourceKey, sourceKey),
    ),
  });
}
export async function insert(data: typeof accurateReceipts.$inferInsert, context: DbExecutor) {
  try {
    await context.insert(accurateReceipts).values(data);
  } catch (error) {
    if (isDuplicateEntry(error)) return [];
    throw error;
  }
  return context.select().from(accurateReceipts).where(eq(accurateReceipts.id, data.id));
}
export function findByNumber(databaseId: string, number: string, context: DbExecutor = db) {
  return context.query.accurateReceipts.findFirst({
    where: and(eq(accurateReceipts.databaseId, databaseId), eq(accurateReceipts.number, number)),
  });
}
export async function update(
  id: string,
  data: Partial<typeof accurateReceipts.$inferInsert>,
  context: DbExecutor = db,
) {
  await context
    .update(accurateReceipts)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(accurateReceipts.id, id));
  return context.select().from(accurateReceipts).where(eq(accurateReceipts.id, id));
}
export async function saveMapping(
  data: typeof receiptAccountMappings.$inferInsert,
  context: DbExecutor,
) {
  await context
    .insert(receiptAccountMappings)
    .values(data)
    .onDuplicateKeyUpdate({
      set: {
        accountId: data.accountId,
        accountNo: data.accountNo,
        accountName: data.accountName,
        feeAccountId: data.feeAccountId,
        feeAccountNo: data.feeAccountNo,
        feeAccountName: data.feeAccountName,
        version: data.version,
        updatedAt: new Date(),
      },
    });
  return context
    .select()
    .from(receiptAccountMappings)
    .where(
      and(
        eq(receiptAccountMappings.branchId, data.branchId),
        eq(receiptAccountMappings.databaseId, data.databaseId),
        eq(receiptAccountMappings.bank, data.bank),
        eq(receiptAccountMappings.method, data.method),
      ),
    );
}
