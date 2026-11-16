import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { jobs } from '../db/schema/index.js';
import type { DbExecutor } from './unit-of-work.repository.js';

export function listRecent(context: DbExecutor = db) {
  return context.select().from(jobs).orderBy(desc(jobs.createdAt)).limit(100);
}

export function create(data: typeof jobs.$inferInsert, context: DbExecutor = db) {
  return context.insert(jobs).values(data);
}

export function lockNextAvailable(context: DbExecutor = db) {
  return context
    .select()
    .from(jobs)
    .where(and(eq(jobs.status, 'QUEUED'), sql`${jobs.availableAt} <= now()`))
    .orderBy(jobs.createdAt)
    .limit(1)
    .for('update', { skipLocked: true });
}

export function updateById(
  changes: Partial<typeof jobs.$inferInsert>,
  id: string,
  context: DbExecutor = db,
) {
  return context.update(jobs).set(changes).where(eq(jobs.id, id));
}

export function lockStale(context: DbExecutor = db) {
  return context
    .select()
    .from(jobs)
    .where(and(eq(jobs.status, 'RUNNING'), sql`${jobs.lockedAt} < now() - interval '5 minutes'`))
    .for('update', { skipLocked: true });
}
