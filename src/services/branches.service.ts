import { randomUUID } from 'node:crypto';
import { create as createAudit } from '../repositories/audit-logs.repository.js';
import * as branches from '../repositories/branches.repository.js';
import { findByBranch } from '../repositories/invoices.repository.js';
import { withTransaction } from '../repositories/unit-of-work.repository.js';
import { HttpError } from '../utils/http-error.js';
import type { BranchMappingInput } from '../validations/settings.validation.js';

export const listBranches = () => branches.list();
export async function updateBranch(id: string, input: BranchMappingInput, actorId: string) {
  await withTransaction(async (tx) => {
    const [branch] = await branches.lockById(id, tx);
    if (!branch) throw new HttpError(404, 'Cabang tidak ditemukan.');
    if (
      branch.accurateDatabaseId !== input.accurateDatabaseId ||
      branch.accurateBranchId !== input.accurateBranchId
    ) {
      if (await findByBranch(id, tx))
        throw new HttpError(
          409,
          'Mapping tujuan tidak dapat diubah setelah cabang memiliki invoice. Buat rencana migrasi untuk menghindari duplikasi.',
        );
    }
    await branches.updateById(input, id, tx);
    await createAudit(
      { id: randomUUID(), actorId, action: 'branch.update', entityId: id, details: input },
      tx,
    );
  });
  return { ok: true };
}
