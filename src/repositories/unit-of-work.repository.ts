import { db } from '../db/index.js';

export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type DbExecutor = typeof db | DbTransaction;

export function withTransaction<T>(work: (context: DbTransaction) => Promise<T>): Promise<T> {
  return db.transaction(work);
}
