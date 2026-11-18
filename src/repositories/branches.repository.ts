import { eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { branches } from '../db/schema/index.js';
import type { DbExecutor } from './unit-of-work.repository.js';

export function findById(id: string, context: DbExecutor = db) {
  return context.query.branches.findFirst({ where: eq(branches.id, id) });
}
export function listActive(context: DbExecutor = db) {
  return context.select().from(branches).where(eq(branches.active, true));
}
export function list(context: DbExecutor = db) {
  return context.select().from(branches);
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
