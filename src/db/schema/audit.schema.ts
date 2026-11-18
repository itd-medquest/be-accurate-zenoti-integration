import { json, mysqlTable, text, varchar } from 'drizzle-orm/mysql-core';
import { time, currentTime } from './columns.js';
export const auditLogs = mysqlTable('audit_logs', {
  id: varchar('id', { length: 100 }).primaryKey(),
  actorId: varchar('actor_id', { length: 100 }),
  action: varchar('action', { length: 255 }).notNull(),
  entityId: varchar('entity_id', { length: 255 }),
  details: json('details'),
  createdAt: time('created_at').notNull().default(currentTime),
});
