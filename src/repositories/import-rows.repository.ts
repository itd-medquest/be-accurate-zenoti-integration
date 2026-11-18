import { and, eq, notInArray, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { importRows } from '../db/schema/index.js';
import type { DbExecutor } from './unit-of-work.repository.js';

export function create(data: typeof importRows.$inferInsert, context: DbExecutor = db) {
  return context.insert(importRows).values(data);
}
export function findInBatch(rowId: string, batchId: string, context: DbExecutor = db) {
  return context.query.importRows.findFirst({
    where: and(eq(importRows.id, rowId), eq(importRows.batchId, batchId)),
  });
}
export function findById(id: string, context: DbExecutor = db) {
  return context.query.importRows.findFirst({ where: eq(importRows.id, id) });
}
export function listActive(batchId: string, context: DbExecutor = db) {
  return context
    .select()
    .from(importRows)
    .where(and(eq(importRows.batchId, batchId), notInArray(importRows.status, ['DELETED'])));
}
export function listPreview(batchId: string, context: DbExecutor = db) {
  return context
    .select()
    .from(importRows)
    .where(and(eq(importRows.batchId, batchId), notInArray(importRows.status, ['DELETED'])))
    .orderBy(importRows.createdAt, importRows.position);
}
export function updateById(
  changes: Partial<typeof importRows.$inferInsert>,
  id: string,
  context: DbExecutor = db,
) {
  return context.update(importRows).set(changes).where(eq(importRows.id, id));
}
export function listActiveForFile(batchId: string, fileId: string, context: DbExecutor = db) {
  return context
    .select()
    .from(importRows)
    .where(
      and(
        eq(importRows.batchId, batchId),
        eq(importRows.fileId, fileId),
        notInArray(importRows.status, ['DELETED']),
      ),
    );
}
export function updateByFile(
  changes: Partial<typeof importRows.$inferInsert>,
  batchId: string,
  fileId: string,
  context: DbExecutor = db,
) {
  return context
    .update(importRows)
    .set(changes)
    .where(and(eq(importRows.batchId, batchId), eq(importRows.fileId, fileId)));
}
export function countActive(batchId: string, context: DbExecutor = db) {
  return context
    .select({ count: sql.raw('count(*)').mapWith(Number) })
    .from(importRows)
    .where(and(eq(importRows.batchId, batchId), notInArray(importRows.status, ['DELETED'])));
}
