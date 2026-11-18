import { mysqlTable, varchar } from 'drizzle-orm/mysql-core';

/** Seeded by migration so first-admin bootstrap can lock even an empty users table. */
export const applicationLocks = mysqlTable('application_locks', {
  name: varchar('name', { length: 64 }).primaryKey(),
});
