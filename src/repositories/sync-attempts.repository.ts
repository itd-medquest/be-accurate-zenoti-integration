import { desc, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { syncAttempts } from '../db/schema/index.js';
import type { DbExecutor } from './unit-of-work.repository.js';

export function create(data: typeof syncAttempts.$inferInsert, context: DbExecutor = db) {
  return context.insert(syncAttempts).values(data);
}

export function listForInvoice(id: string, context: DbExecutor = db) {
  return context
    .select()
    .from(syncAttempts)
    .where(eq(syncAttempts.invoiceId, id))
    .orderBy(desc(syncAttempts.createdAt));
}
