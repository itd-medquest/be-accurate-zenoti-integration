import { boolean, mysqlTable, text, varchar } from 'drizzle-orm/mysql-core';
import { time, currentTime } from './columns.js';
export const user = mysqlTable('users', {
  id: varchar('id', { length: 100 }).primaryKey(),
  name: text('name').notNull(),
  email: varchar('email', { length: 320 }).notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  role: varchar('role', { length: 255 }).notNull().default('viewer'),
  active: boolean('active').notNull().default(true),
  createdAt: time('created_at').notNull().default(currentTime),
  updatedAt: time('updated_at').notNull().default(currentTime),
});

export const session = mysqlTable('sessions', {
  id: varchar('id', { length: 100 }).primaryKey(),
  expiresAt: time('expires_at').notNull(),
  token: varchar('token', { length: 255 }).notNull().unique(),
  createdAt: time('created_at').notNull().default(currentTime),
  updatedAt: time('updated_at').notNull().default(currentTime),
  ipAddress: varchar('ip_address', { length: 255 }),
  userAgent: text('user_agent'),
  userId: varchar('user_id', { length: 100 })
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
});

export const account = mysqlTable('accounts', {
  id: varchar('id', { length: 100 }).primaryKey(),
  accountId: varchar('account_id', { length: 255 }).notNull(),
  providerId: varchar('provider_id', { length: 255 }).notNull(),
  userId: varchar('user_id', { length: 100 })
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: time('access_token_expires_at'),
  refreshTokenExpiresAt: time('refresh_token_expires_at'),
  scope: text('scope'),
  password: varchar('password', { length: 255 }),
  createdAt: time('created_at').notNull().default(currentTime),
  updatedAt: time('updated_at').notNull().default(currentTime),
});

export const verification = mysqlTable('verifications', {
  id: varchar('id', { length: 100 }).primaryKey(),
  identifier: varchar('identifier', { length: 255 }).notNull(),
  value: text('value').notNull(),
  expiresAt: time('expires_at').notNull(),
  createdAt: time('created_at').notNull().default(currentTime),
  updatedAt: time('updated_at').notNull().default(currentTime),
});
