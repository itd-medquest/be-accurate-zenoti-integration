import { and, desc, eq, gte, or, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { invoices } from '../db/schema/index.js';
import type { DbExecutor } from './unit-of-work.repository.js';
import { isDuplicateEntry } from './mysql-errors.js';

import type { InvoiceFilters, InvoicePaging } from '../validations/invoices.validation.js';
function scope(filters: InvoiceFilters, asOf: Date) {
  const predicates = [gte(invoices.date, new Date(asOf.getTime() - filters.days * 86400000))];
  if (filters.branch) predicates.push(eq(invoices.branchId, filters.branch));
  if (filters.status) predicates.push(eq(invoices.syncStatus, filters.status));
  if (filters.search) {
    const term = '%' + filters.search.toLowerCase().replace(/[!%_]/g, '!$&') + '%';
    predicates.push(
      or(
        sql`lower(${invoices.number}) like ${term} escape '!'`,
        sql`lower(${invoices.customer}) like ${term} escape '!'`,
      )!,
    );
  }
  return and(...predicates);
}
export function listScoped(filters: InvoiceFilters, context: DbExecutor = db) {
  return context
    .select()
    .from(invoices)
    .where(scope(filters, new Date()))
    .orderBy(desc(invoices.date));
}
export function listPage(
  filters: InvoiceFilters,
  paging: InvoicePaging,
  asOf: Date,
  context: DbExecutor = db,
) {
  return context
    .select()
    .from(invoices)
    .where(scope(filters, asOf))
    .orderBy(desc(invoices.date))
    .limit(paging.pageSize)
    .offset((paging.page - 1) * paging.pageSize);
}
export function countScoped(filters: InvoiceFilters, asOf: Date, context: DbExecutor = db) {
  return context
    .select({ total: sql.raw('count(*)').mapWith(Number) })
    .from(invoices)
    .where(scope(filters, asOf));
}
export function lockById(id: string, context: DbExecutor = db) {
  return context.select().from(invoices).where(eq(invoices.id, id)).for('update');
}
export function findById(id: string, context: DbExecutor = db) {
  return context.query.invoices.findFirst({ where: eq(invoices.id, id) });
}
export function findByBranch(branchId: string, context: DbExecutor = db) {
  return context.query.invoices.findFirst({ where: eq(invoices.branchId, branchId) });
}
export function findBySource(
  sourceId: string,
  number: string,
  branchId: string,
  context: DbExecutor = db,
) {
  return context.query.invoices.findFirst({
    where: and(
      or(eq(invoices.sourceId, sourceId), eq(invoices.number, number)),
      eq(invoices.branchId, branchId),
    ),
  });
}
export function create(data: typeof invoices.$inferInsert, context: DbExecutor = db) {
  return context.insert(invoices).values(data);
}
export function updateById(
  changes: Partial<typeof invoices.$inferInsert>,
  id: string,
  context: DbExecutor = db,
) {
  return context.update(invoices).set(changes).where(eq(invoices.id, id));
}
export async function seedMissing(
  data: (typeof invoices.$inferInsert)[],
  context: DbExecutor = db,
) {
  const inserted: (typeof invoices.$inferSelect)[] = [];
  for (const row of data) {
    try {
      await context.insert(invoices).values(row);
    } catch (error) {
      if (isDuplicateEntry(error)) continue;
      throw error;
    }
    const [created] = await context.select().from(invoices).where(eq(invoices.id, row.id));
    if (created) inserted.push(created);
  }
  return inserted;
}
export async function insertMissingIds(
  data: (typeof invoices.$inferInsert)[],
  context: DbExecutor = db,
) {
  return (await seedMissing(data, context)).map(({ id }) => ({ id }));
}
