import { desc, eq, notInArray, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { importBatches } from '../db/schema/index.js';
import type { DbExecutor } from './unit-of-work.repository.js';

export function create(data: typeof importBatches.$inferInsert, context: DbExecutor = db) {
  return context.insert(importBatches).values(data);
}
export function findById(id: string, context: DbExecutor = db) {
  return context.query.importBatches.findFirst({ where: eq(importBatches.id, id) });
}
export async function hasUploadsByUser(userId: string, context: DbExecutor = db) {
  const rows = await context
    .select({ id: importBatches.id })
    .from(importBatches)
    .where(eq(importBatches.uploaderId, userId))
    .limit(1);
  return rows.length > 0;
}
export function lockById(id: string, context: DbExecutor = db) {
  return context.select().from(importBatches).where(eq(importBatches.id, id)).for('update');
}
export function updateById(
  changes: Partial<typeof importBatches.$inferInsert>,
  id: string,
  context: DbExecutor = db,
) {
  return context.update(importBatches).set(changes).where(eq(importBatches.id, id));
}
export function listVisible(page: number | undefined, pageSize: number, context: DbExecutor = db) {
  return context
    .select({
      id: importBatches.id,
      status: importBatches.status,
      version: importBatches.version,
      branchId: importBatches.branchId,
      createdAt: importBatches.createdAt,
      submittedAt: importBatches.submittedAt,
      uploaderId: importBatches.uploaderId,
    })
    .from(importBatches)
    .where(notInArray(importBatches.status, ['DELETED', 'ARCHIVED']))
    .orderBy(desc(importBatches.createdAt))
    .limit(page ? pageSize : 50)
    .offset(page ? (page - 1) * pageSize : 0);
}
export function countVisible(context: DbExecutor = db) {
  return context
    .select({ total: sql.raw('count(*)').mapWith(Number) })
    .from(importBatches)
    .where(notInArray(importBatches.status, ['DELETED', 'ARCHIVED']));
}
