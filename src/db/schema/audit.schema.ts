import { jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import { time } from './columns.js';
export const auditLogs = pgTable('audit_logs', {
  id: text('id').primaryKey(),
  actorId: text('actor_id'),
  action: text('action').notNull(),
  entityId: text('entity_id'),
  details: jsonb('details'),
  createdAt: time('created_at').notNull().defaultNow(),
});
