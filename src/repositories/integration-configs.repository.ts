import { eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { integrationConfigs } from '../db/schema/index.js';
import type { DbExecutor } from './unit-of-work.repository.js';

export function seedMissing(
  data: (typeof integrationConfigs.$inferInsert)[],
  context: DbExecutor = db,
) {
  return context
    .insert(integrationConfigs)
    .values(data)
    .onDuplicateKeyUpdate({ set: { id: sql`${integrationConfigs.id}` } });
}

export function list(context: DbExecutor = db) {
  return context.select().from(integrationConfigs);
}
export function findById(id: string, context: DbExecutor = db) {
  return context.query.integrationConfigs.findFirst({ where: eq(integrationConfigs.id, id) });
}
export function lockById(id: string, context: DbExecutor) {
  return context
    .select()
    .from(integrationConfigs)
    .where(eq(integrationConfigs.id, id))
    .for('update');
}
export function configure(
  data: typeof integrationConfigs.$inferInsert,
  changes: Partial<typeof integrationConfigs.$inferInsert>,
  context: DbExecutor = db,
) {
  return context.insert(integrationConfigs).values(data).onDuplicateKeyUpdate({ set: changes });
}
