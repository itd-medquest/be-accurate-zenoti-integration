import { boolean, int, mysqlTable, text, varchar } from 'drizzle-orm/mysql-core';
import { time, currentTime } from './columns.js';
export const integrationConfigs = mysqlTable('integration_configs', {
  id: varchar('id', { length: 100 }).primaryKey(),
  enabled: boolean('enabled').notNull().default(true),
  encryptedSecret: text('encrypted_secret'),
  updatedAt: time('updated_at').notNull().default(currentTime),
});

export const schedulerConfigs = mysqlTable('scheduler_configs', {
  id: varchar('id', { length: 100 }).primaryKey(),
  enabled: boolean('enabled').notNull().default(false),
  intervalMinutes: int('interval_minutes').notNull().default(60),
  nextRunAt: time('next_run_at'),
  lastRunAt: time('last_run_at'),
});
