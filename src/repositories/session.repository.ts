import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { session } from '../db/schema/index.js';
import type { DbExecutor } from './unit-of-work.repository.js';
export function deleteForUser(userId: string, context: DbExecutor = db) {
  return context.delete(session).where(eq(session.userId, userId));
}
