import { and, asc, eq, getTableColumns, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  branches,
  invoices,
  importBatches,
  accurateDeliveries,
  accurateReceipts,
  accurateDestinations,
  accurateMappings,
  receiptAccountMappings,
  integrationConfigs,
} from '../db/schema/index.js';
import { companyConnectionId } from '../utils/company-connection.js';
import type { DbExecutor } from './unit-of-work.repository.js';

export function findById(id: string, context: DbExecutor = db) {
  return context.query.branches.findFirst({ where: eq(branches.id, id) });
}
export function listActive(context: DbExecutor = db) {
  return context.select().from(branches).where(eq(branches.active, true));
}
export function list(context: DbExecutor = db) {
  return context.select().from(branches).where(eq(branches.active, true));
}
export function lockById(id: string, context: DbExecutor = db) {
  return context.select().from(branches).where(eq(branches.id, id)).for('update');
}
export function updateById(
  changes: Partial<typeof branches.$inferInsert>,
  id: string,
  context: DbExecutor = db,
) {
  return context.update(branches).set(changes).where(eq(branches.id, id));
}
export function seedMissing(data: typeof branches.$inferInsert, context: DbExecutor = db) {
  return context
    .insert(branches)
    .values(data)
    .onDuplicateKeyUpdate({ set: { id: sql`${branches.id}` } });
}

export function create(data: typeof branches.$inferInsert, context: DbExecutor) {
  return context.insert(branches).values(data);
}

export function findByName(name: string, context: DbExecutor) {
  return context
    .select({ id: branches.id })
    .from(branches)
    .where(
      and(eq(branches.active, true), sql`lower(trim(${branches.name})) = ${name.toLowerCase()}`),
    )
    .limit(1);
}

export function listManaged(context: DbExecutor = db) {
  const references = [invoices, accurateDeliveries, accurateReceipts].map(
    (table) => sql`exists (select 1 from ${table} where ${table.branchId} = ${branches.id})`,
  );
  references.push(sql`exists (select 1 from ${importBatches}
    where ${importBatches.branchId} = ${branches.id}
      and (${importBatches.status} <> 'DELETED' or ${importBatches.submittedAt} is not null
        or ${importBatches.submittedBy} is not null))`);
  const deletedUploads = sql`exists (select 1 from ${importBatches}
    where ${importBatches.branchId} = ${branches.id} and ${importBatches.status} = 'DELETED')`;
  return context
    .select({
      ...getTableColumns(branches),
      hasHistory: sql<number>`(${sql.join(references, sql` or `)})`,
      // Nest the correlated SQL so Drizzle retains table qualifiers in this single-table select.
      hasDeletedUploads: sql<number>`${deletedUploads}`.mapWith(Number),
    })
    .from(branches)
    .where(eq(branches.active, true))
    .orderBy(asc(branches.name), asc(branches.id));
}

export async function removeCompany(id: string, context: DbExecutor, retainDeletedUploads = false) {
  await context.delete(accurateMappings).where(eq(accurateMappings.branchId, id));
  await context.delete(receiptAccountMappings).where(eq(receiptAccountMappings.branchId, id));
  await context.delete(accurateDestinations).where(eq(accurateDestinations.branchId, id));
  await context
    .delete(integrationConfigs)
    .where(eq(integrationConfigs.id, companyConnectionId(id)));
  if (retainDeletedUploads)
    await context.update(branches).set({ active: false }).where(eq(branches.id, id));
  else await context.delete(branches).where(eq(branches.id, id));
}
