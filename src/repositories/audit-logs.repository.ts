import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { auditLogs } from '../db/schema/index.js';
import type { DbExecutor } from './unit-of-work.repository.js';

export function create(data: typeof auditLogs.$inferInsert, context: DbExecutor = db) {
  return context.insert(auditLogs).values(data);
}
export function listRecent(context: DbExecutor = db) {
  return context.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(100);
}
export function findById(id: string, context: DbExecutor = db) {
  return context.query.auditLogs.findFirst({ where: eq(auditLogs.id, id) });
}
export function findByActionAndEntity(action: string, entityId: string, context: DbExecutor = db) {
  return context
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.action, action), eq(auditLogs.entityId, entityId)))
    .orderBy(desc(auditLogs.createdAt));
}
export function customerRequestsForName(databaseId: string, name: string, context: DbExecutor) {
  return context
    .select()
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.action, 'accurate.customer.requested'),
        sql`${auditLogs.details}->>'databaseId' = ${databaseId}`,
        sql`lower(${auditLogs.details}->>'name') = ${name.toLocaleLowerCase('id')}`,
      ),
    );
}
