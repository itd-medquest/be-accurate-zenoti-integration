import { randomUUID } from 'node:crypto';
import * as branches from '../repositories/branches.repository.js';
import * as connections from '../repositories/integration-configs.repository.js';
import * as users from '../repositories/user.repository.js';
import * as audits from '../repositories/audit-logs.repository.js';
import { withTransaction } from '../repositories/unit-of-work.repository.js';
import { companyConnectionId } from '../utils/company-connection.js';
import { HttpError } from '../utils/http-error.js';
import { connectionFromRow } from './accurate-connection.service.js';

export async function listCompanies() {
  const [rows, configs] = await Promise.all([branches.listManaged(), connections.list()]);
  return rows.map(({ hasHistory, ...branch }) => {
    const row =
      configs.find((value) => value.id === companyConnectionId(branch.id)) ??
      (!branch.centerId.startsWith('company:')
        ? configs.find((value) => value.id === 'accurate')
        : undefined);
    const current = connectionFromRow(
      row,
      branch.centerId.startsWith('company:') ? 'live' : 'simulation',
    );
    return {
      ...branch,
      canDelete: !hasHistory,
      deleteReason: hasHistory
        ? 'Perusahaan memiliki riwayat upload atau transaksi yang harus dipertahankan.'
        : null,
      connection: {
        mode: current.mode,
        taxPolicy: 'gross-no-tax' as const,
        hasApiToken: !!current.credentials?.apiToken,
        hasSignatureSecret: !!current.credentials?.signatureSecret,
        enabled: current.enabled,
      },
    };
  });
}

export async function createCompany(name: string, actorId: string) {
  return withTransaction(async (tx) => {
    // Use the same registration lock as the existing CLI company bootstrap.
    await users.lockForBootstrap(tx);
    if ((await branches.findByName(name, tx)).length)
      throw new HttpError(
        409,
        'Nama perusahaan sudah digunakan. Gunakan perusahaan yang sudah terdaftar.',
      );
    const id = randomUUID();
    await branches.create(
      {
        id,
        name,
        centerId: `company:${id}`,
        accurateDatabaseId: 'unconfigured',
        accurateBranchId: 'unconfigured',
        active: true,
      },
      tx,
    );
    await connections.seedMissing([{ id: companyConnectionId(id), enabled: false }], tx);
    await audits.create(
      { id: randomUUID(), actorId, action: 'company.create', entityId: id, details: { name } },
      tx,
    );
    return { id, name };
  });
}

export async function deleteCompany(id: string, confirmationName: string, actorId: string) {
  return withTransaction(async (tx) => {
    const [branch] = await branches.lockById(id, tx);
    if (!branch) throw new HttpError(404, 'Perusahaan tidak ditemukan.');
    if (branch.name !== confirmationName)
      throw new HttpError(400, 'Nama konfirmasi harus sama persis dengan nama perusahaan.');
    const current = (await branches.listManaged(tx)).find((row) => row.id === id);
    if (current?.hasHistory)
      throw new HttpError(
        409,
        'Perusahaan memiliki riwayat upload atau transaksi. Data tersebut harus dipertahankan sehingga perusahaan tidak dapat dihapus.',
      );
    await branches.removeCompany(id, tx);
    await audits.create(
      {
        id: randomUUID(),
        actorId,
        action: 'company.delete',
        entityId: id,
        details: { name: branch.name, localSettingsRemoved: true },
      },
      tx,
    );
    return { ok: true };
  });
}
