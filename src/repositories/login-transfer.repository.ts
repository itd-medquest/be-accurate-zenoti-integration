import { count } from 'drizzle-orm';
import {
  user,
  account,
  invoices,
  importBatches,
  branches,
  integrationConfigs,
  accurateReceipts,
  accurateDeliveries,
  receiptAccountMappings,
  accurateMappings,
  accurateDestinations,
  auditLogs,
  session,
  verification,
  importFiles,
  importRows,
  invoiceSyncs,
  jobs,
  simulatedDrafts,
  syncAttempts,
  schedulerConfigs,
} from '../db/schema/index.js';
import type { DbTransaction } from './unit-of-work.repository.js';
import type { LoginTransfer } from '../validations/user-transfer.validation.js';

export async function isEmptyTarget(context: DbTransaction) {
  for (const table of [
    user,
    account,
    invoices,
    importBatches,
    branches,
    integrationConfigs,
    accurateReceipts,
    accurateDeliveries,
    receiptAccountMappings,
    accurateMappings,
    accurateDestinations,
    auditLogs,
    session,
    verification,
    importFiles,
    importRows,
    invoiceSyncs,
    jobs,
    simulatedDrafts,
    syncAttempts,
    schedulerConfigs,
  ]) {
    const [row] = await context.select({ total: count() }).from(table);
    if (row.total) return false;
  }
  return true;
}
export async function insertLoginUsers(data: LoginTransfer, context: DbTransaction) {
  await context.insert(user).values(data.users);
  if (data.accounts.length) await context.insert(account).values(data.accounts);
}
