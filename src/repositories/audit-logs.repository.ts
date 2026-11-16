import { desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { auditLogs } from '../db/schema/index.js';
import type { DbExecutor } from './unit-of-work.repository.js';

export function create(data: typeof auditLogs.$inferInsert, context: DbExecutor = db) {
  return context.insert(auditLogs).values(data);
}
export function listRecent(context: DbExecutor = db) {
  return context.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(100);
}
