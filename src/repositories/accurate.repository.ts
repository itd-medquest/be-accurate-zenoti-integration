import { and, eq, desc, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  accurateDeliveries,
  accurateDestinations,
  accurateMappings,
  invoices,
} from '../db/schema/index.js';
import type { DbExecutor } from './unit-of-work.repository.js';
import { isDuplicateEntry } from './mysql-errors.js';

export const destination = (branchId: string, context: DbExecutor = db) =>
  context.query.accurateDestinations.findFirst({
    where: eq(accurateDestinations.branchId, branchId),
  });
export const destinations = (context: DbExecutor = db) =>
  context.select().from(accurateDestinations);
export function saveDestination(
  data: typeof accurateDestinations.$inferInsert,
  context: DbExecutor = db,
) {
  return context
    .insert(accurateDestinations)
    .values(data)
    .onDuplicateKeyUpdate({ set: { ...data, updatedAt: new Date() } });
}
export function mappings(branchId: string, databaseId: string, context: DbExecutor = db) {
  return context
    .select()
    .from(accurateMappings)
    .where(
      and(eq(accurateMappings.branchId, branchId), eq(accurateMappings.databaseId, databaseId)),
    );
}
export function saveMapping(data: typeof accurateMappings.$inferInsert, context: DbExecutor = db) {
  return context
    .insert(accurateMappings)
    .values(data)
    .onDuplicateKeyUpdate({
      set: {
        targetId: data.targetId,
        targetCode: data.targetCode,
        targetName: data.targetName,
        unitName: data.unitName,
        itemType: data.itemType,
        updatedAt: new Date(),
      },
    });
}
export const delivery = (invoiceId: string, context: DbExecutor = db) =>
  context.query.accurateDeliveries.findFirst({
    where: eq(accurateDeliveries.invoiceId, invoiceId),
  });
export const deliveryByNumber = (databaseId: string, number: string, context: DbExecutor = db) =>
  context.query.accurateDeliveries.findFirst({
    where: and(
      eq(accurateDeliveries.databaseId, databaseId),
      eq(accurateDeliveries.requestedNumber, number),
    ),
  });
export const branchHasDeliveries = (branchId: string, context: DbExecutor = db) =>
  context.query.accurateDeliveries.findFirst({ where: eq(accurateDeliveries.branchId, branchId) });
export async function createDelivery(
  data: typeof accurateDeliveries.$inferInsert,
  context: DbExecutor,
) {
  try {
    await context.insert(accurateDeliveries).values(data);
  } catch (error) {
    if (isDuplicateEntry(error)) return [];
    throw error;
  }
  return context
    .select()
    .from(accurateDeliveries)
    .where(eq(accurateDeliveries.invoiceId, data.invoiceId));
}
export async function claimDelivery(invoiceId: string, context: DbExecutor = db) {
  const [result] = await context
    .update(accurateDeliveries)
    .set({ attemptedAt: new Date(), status: 'SENDING', updatedAt: new Date() })
    .where(
      and(eq(accurateDeliveries.invoiceId, invoiceId), isNull(accurateDeliveries.attemptedAt)),
    );
  if (result.affectedRows !== 1) return [];
  return context
    .select()
    .from(accurateDeliveries)
    .where(eq(accurateDeliveries.invoiceId, invoiceId));
}
export function updateDelivery(
  invoiceId: string,
  changes: Partial<typeof accurateDeliveries.$inferInsert>,
  context: DbExecutor = db,
) {
  return context
    .update(accurateDeliveries)
    .set({ ...changes, updatedAt: new Date() })
    .where(eq(accurateDeliveries.invoiceId, invoiceId));
}
export function listDelivered(context: DbExecutor = db) {
  return context
    .select({
      invoiceId: invoices.id,
      number: invoices.number,
      customer: invoices.customer,
      date: invoices.date,
      total: invoices.total,
      targetId: accurateDeliveries.targetId,
      targetNumber: accurateDeliveries.targetNumber,
      databaseId: accurateDeliveries.databaseId,
    })
    .from(accurateDeliveries)
    .innerJoin(invoices, eq(accurateDeliveries.invoiceId, invoices.id))
    .where(eq(accurateDeliveries.status, 'SUCCEEDED'))
    .orderBy(desc(accurateDeliveries.updatedAt))
    .limit(100);
}
