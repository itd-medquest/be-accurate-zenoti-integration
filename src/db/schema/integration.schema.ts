import { boolean, integer, pgTable, text } from 'drizzle-orm/pg-core';
import { time } from './columns.js';
export const integrationConfigs = pgTable('integration_configs', {
  id: text('id').primaryKey(),
  enabled: boolean('enabled').notNull().default(true),
  encryptedSecret: text('encrypted_secret'),
  updatedAt: time('updated_at').notNull().defaultNow(),
});

export const schedulerConfigs = pgTable('scheduler_configs', {
  id: text('id').primaryKey(),
  enabled: boolean('enabled').notNull().default(false),
  intervalMinutes: integer('interval_minutes').notNull().default(60),
  nextRunAt: time('next_run_at'),
  lastRunAt: time('last_run_at'),
});
