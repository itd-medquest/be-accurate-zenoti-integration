import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { account } from '../db/schema/index.js';
import type { DbExecutor } from './unit-of-work.repository.js';

export function create(data: typeof account.$inferInsert, context: DbExecutor = db) {
  return context.insert(account).values(data);
}

export function findCredential(userId: string, context: DbExecutor = db) {
  return context.query.account.findFirst({
    where: and(eq(account.userId, userId), eq(account.providerId, 'credential')),
  });
}

export function replacePassword(id: string, previous: string, password: string, context: DbExecutor) {
  return context.update(account).set({ password, updatedAt: new Date() })
    .where(and(eq(account.id, id), eq(account.password, previous))).returning({ id: account.id });
}
