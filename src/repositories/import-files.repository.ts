import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { importFiles } from '../db/schema/index.js';
import type { DbExecutor } from './unit-of-work.repository.js';

export function create(data: typeof importFiles.$inferInsert, context: DbExecutor = db) {
  return context.insert(importFiles).values(data);
}
export function findInBatch(fileId: string, batchId: string, context: DbExecutor = db) {
  return context.query.importFiles.findFirst({
    where: and(eq(importFiles.id, fileId), eq(importFiles.batchId, batchId)),
  });
}
export function findById(id: string, context: DbExecutor = db) {
  return context.query.importFiles.findFirst({ where: eq(importFiles.id, id) });
}
export function updateById(
  changes: Partial<typeof importFiles.$inferInsert>,
  id: string,
  context: DbExecutor = db,
) {
  return context.update(importFiles).set(changes).where(eq(importFiles.id, id));
}
export function listPreview(batchId: string, context: DbExecutor = db) {
  return context
    .select({
      id: importFiles.id,
      name: importFiles.name,
      size: importFiles.size,
      format: importFiles.format,
      error: importFiles.error,
    })
    .from(importFiles)
    .where(eq(importFiles.batchId, batchId));
}
