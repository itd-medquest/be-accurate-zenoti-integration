import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { invoiceSyncs } from '../db/schema/index.js';
import type { DbExecutor } from './unit-of-work.repository.js';

export function upsertTarget(
  data: typeof invoiceSyncs.$inferInsert,
  changes: Partial<typeof invoiceSyncs.$inferInsert>,
  context: DbExecutor = db,
) {
  return context.insert(invoiceSyncs).values(data).onDuplicateKeyUpdate({ set: changes });
}

export function listForInvoice(id: string, context: DbExecutor = db) {
  return context.select().from(invoiceSyncs).where(eq(invoiceSyncs.invoiceId, id));
}
