import { createHash } from 'node:crypto';

export const companyConnectionId = (branchId: string) =>
  `accurate-company-${createHash('sha256').update(branchId).digest('hex').slice(0, 40)}`;
