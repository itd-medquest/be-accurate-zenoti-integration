import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import * as repository from '../repositories/accurate.repository.js';
import * as batches from '../repositories/import-batches.repository.js';
import * as rows from '../repositories/import-rows.repository.js';
import * as branches from '../repositories/branches.repository.js';
import * as audits from '../repositories/audit-logs.repository.js';
import { withTransaction } from '../repositories/unit-of-work.repository.js';
import { HttpError } from '../utils/http-error.js';
import type { mappingInput, masterQuery } from '../validations/accurate.validation.js';
import { accurateConnection, connectedAccurate } from './accurate-connection.service.js';
import { mappingSourceKey } from '../utils/accurate-mapping.js';
import { isFreeConsultation } from '../utils/redemption.js';

export async function accurateStatus(branchId?: string) {
  const connection = await accurateConnection(undefined, branchId);
  return {
    mode: connection.mode,
    enabled: connection.enabled,
    configured: !!connection.credentials?.apiToken && !!connection.credentials.signatureSecret,
    taxPolicy: 'gross-no-tax',
    destinations: (await repository.destinations()).filter(
      (row) => !branchId || row.branchId === branchId,
    ),
  };
}
export const deliveredInvoices = () => repository.listDelivered();
export async function searchMasters(input: z.output<typeof masterQuery>) {
  const { client, profile } = await connectedAccurate(false, input.branchId);
  return {
    database: { id: profile.id, name: profile.name },
    items: await client.masters(profile, input.kind, input.search, input.page),
  };
}
export async function saveDestination(branchId: string, masterId: string, actorId: string) {
  const { client, profile } = await connectedAccurate(false, branchId);
  const master = await client.masterDetail(profile, 'branch', masterId);
  if (master.id !== masterId) throw new HttpError(422, 'ID cabang respons Accurate tidak sesuai.');
  await withTransaction(async (tx) => {
    const [branch] = await branches.lockById(branchId, tx);
    if (!branch?.active) throw new HttpError(404, 'Cabang aktif tidak ditemukan.');
    const previous = await repository.destination(branchId, tx);
    if (
      previous &&
      (previous.databaseId !== profile.id || previous.targetBranchId !== master.id) &&
      (await repository.branchHasDeliveries(branchId, tx))
    )
      throw new HttpError(
        409,
        'Tujuan sudah digunakan untuk pengiriman aktual. Buat cabang terpisah untuk tujuan berbeda.',
      );
    await repository.saveDestination(
      {
        branchId,
        databaseId: profile.id,
        databaseName: profile.name,
        targetBranchId: master.id,
        targetBranchName: master.name,
      },
      tx,
    );
    await audits.create(
      {
        id: randomUUID(),
        actorId,
        action: 'accurate.destination.configure',
        entityId: branchId,
        details: { databaseId: profile.id, targetBranchId: master.id },
      },
      tx,
    );
  });
  return accurateStatus(branchId);
}
export async function resolveImportMaster(
  batchId: string,
  version: number,
  kind: 'customer' | 'item',
  masterId: string,
) {
  const batchSnapshot = await batches.findById(batchId);
  if (!batchSnapshot || batchSnapshot.status !== 'PREVIEW' || batchSnapshot.version !== version)
    throw new HttpError(409, 'Preview berubah atau sudah disubmit. Muat ulang.');
  const destination = await repository.destination(batchSnapshot.branchId);
  if (!destination) throw new HttpError(422, 'Atur tujuan cabang Accurate terlebih dahulu.');
  const { client, profile } = await connectedAccurate(false, batchSnapshot.branchId);
  if (profile.id !== destination.databaseId)
    throw new HttpError(422, 'Database token berbeda dari tujuan cabang.');
  const master = await client.masterDetail(profile, kind, masterId);
  if (master.id !== masterId) throw new HttpError(422, 'ID master respons Accurate tidak sesuai.');
  if (kind === 'item' && !master.unitName)
    throw new HttpError(
      422,
      'Master item belum memiliki satuan utama. Lengkapi satuan di Accurate terlebih dahulu.',
    );
  return { destination, profile, master };
}

export async function saveRowMapping(
  batchId: string,
  rowId: string,
  input: z.output<typeof mappingInput>,
  actorId: string,
) {
  const { destination, profile, master } = await resolveImportMaster(
    batchId,
    input.version,
    input.kind,
    input.masterId,
  );
  await withTransaction(async (tx) => {
    const [batch] = await batches.lockById(batchId, tx);
    if (!batch || batch.version !== input.version || batch.status !== 'PREVIEW')
      throw new HttpError(409, 'Preview berubah. Muat ulang.');
    const [branch] = await branches.lockById(batch.branchId, tx);
    const current = await repository.destination(batch.branchId, tx);
    if (
      !branch?.active ||
      current?.databaseId !== destination.databaseId ||
      current.targetBranchId !== destination.targetBranchId
    )
      throw new HttpError(409, 'Tujuan cabang berubah. Muat ulang mapping.');
    const row = await rows.findInBatch(rowId, batchId, tx);
    if (!row || row.status === 'DELETED' || row.invoiceId)
      throw new HttpError(409, 'Invoice tidak dapat diubah.');
    const item = row.candidate.items.find((item) => item.id === input.itemId);
    if (input.kind === 'item' && item && (item.redeemed || isFreeConsultation(item)))
      throw new HttpError(
        422,
        'Item redeem atau Consultation gratis tidak dikirim ke Accurate dan tidak memerlukan mapping.',
      );
    if (input.kind === 'item' && !item) throw new HttpError(404, 'Item tidak ditemukan.');
    const previous = row.candidate.accurateSelection;
    const selection =
      previous?.databaseId === destination.databaseId &&
      previous.targetBranchId === destination.targetBranchId
        ? { ...previous, items: { ...previous.items } }
        : {
            databaseId: destination.databaseId,
            targetBranchId: destination.targetBranchId,
            customer: undefined,
            items: {} as NonNullable<typeof previous>['items'],
          };
    if (input.kind === 'customer')
      selection.customer = { id: master.id, code: master.code, name: master.name };
    else if (item)
      selection.items[item.id] = {
        id: master.id,
        code: master.code,
        name: master.name,
        unitName: master.unitName,
      };
    await rows.updateById(
      {
        candidate: {
          ...row.candidate,
          accurateSelection: selection,
          accountingReviewedAt: undefined,
        },
      },
      rowId,
      tx,
    );
    const sourceKey = mappingSourceKey(
      input.kind === 'customer' ? row.candidate.customerId : `${item?.kind}:${item?.name}`,
    );
    await repository.saveMapping(
      {
        id: randomUUID(),
        branchId: batch.branchId,
        databaseId: profile.id,
        kind: input.kind,
        sourceKey,
        targetId: master.id,
        targetCode: master.code,
        targetName: master.name,
        unitName: master.unitName,
        itemType: master.itemType,
      },
      tx,
    );
    await batches.updateById({ version: batch.version + 1 }, batchId, tx);
    await audits.create(
      {
        id: randomUUID(),
        actorId,
        action: 'accurate.mapping.select',
        entityId: rowId,
        details: {
          kind: input.kind,
          itemId: input.itemId,
          targetId: master.id,
          targetCode: master.code,
          databaseId: profile.id,
        },
      },
      tx,
    );
  });
  return { ok: true };
}
