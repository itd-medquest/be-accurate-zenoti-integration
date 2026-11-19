import { companyBootstrapSchema } from '../validations/company-bootstrap.validation.js';
import { randomUUID } from 'node:crypto';
import * as audit from '../repositories/audit-logs.repository.js';
import * as branches from '../repositories/branches.repository.js';
import * as users from '../repositories/user.repository.js';
import * as connections from '../repositories/integration-configs.repository.js';
import { companyConnectionId } from '../utils/company-connection.js';
import { withTransaction } from '../repositories/unit-of-work.repository.js';

/** CLI-only configuration: no sample invoices, external mapping, or remote writes. */
export async function bootstrapCompany(input: unknown) {
  const data = companyBootstrapSchema.parse(input);
  return withTransaction(async (context) => {
    await users.lockForBootstrap(context);
    const existing = await branches.findById(data.id, context);
    if (existing) {
      if (existing.centerId !== data.centerId)
        throw new Error('ID perusahaan telah dipakai dengan center berbeda.');
      return { created: false };
    }
    await branches.create(
      { ...data, accurateDatabaseId: 'unconfigured', accurateBranchId: 'unconfigured' },
      context,
    );
    await connections.seedMissing([{ id: companyConnectionId(data.id), enabled: false }], context);
    await audit.create(
      {
        id: randomUUID(),
        action: 'company.bootstrap',
        entityId: data.id,
        details: { centerId: data.centerId },
      },
      context,
    );
    return { created: true };
  });
}
