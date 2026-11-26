import { createHash } from 'node:crypto';

export const simulationReceiptDatabase = (branchId: string) =>
  `SIMULATION:${createHash('sha256').update(branchId).digest('hex')}`;
export const isSimulationReceipt = (row: { databaseId: string }) =>
  /^SIMULATION:[a-f0-9]{64}$/.test(row.databaseId);
