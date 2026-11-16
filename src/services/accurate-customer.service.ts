import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import * as audits from '../repositories/audit-logs.repository.js';
import * as batches from '../repositories/import-batches.repository.js';
import * as rows from '../repositories/import-rows.repository.js';
import * as accurate from '../repositories/accurate.repository.js';
import * as branches from '../repositories/branches.repository.js';
import * as connections from '../repositories/integration-configs.repository.js';
import { withTransaction, type DbExecutor } from '../repositories/unit-of-work.repository.js';
import { connectedAccurate } from './accurate-connection.service.js';
import { AccurateWriteUncertain } from './integrations/accurate-client.js';
import type {
  AccurateCustomerDefaults,
  AccurateCustomerPayload,
  AccurateMaster,
} from '../types/accurate.types.js';
import { customerCreateInput } from '../validations/accurate.validation.js';
import { normalizeCustomerName, nextMpaCustomerNumber } from '../utils/accurate-customer.js';
import { chargeableItems } from '../utils/redemption.js';
import { HttpError } from '../utils/http-error.js';

const REQUESTED = 'accurate.customer.requested';
const CREATED = 'accurate.customer.created';
const REJECTED = 'accurate.customer.rejected';
const UNCERTAIN = 'accurate.customer.uncertain';
type CreateInput = z.output<typeof customerCreateInput>;

async function invoiceContext(
  batchId: string,
  rowId: string,
  version: number,
  context?: DbExecutor,
) {
  const batch = await batches.findById(batchId, context);
  const row = await rows.findInBatch(rowId, batchId, context);
  if (
    !batch ||
    batch.status !== 'PREVIEW' ||
    batch.version !== version ||
    !row ||
    row.status === 'DELETED' ||
    row.invoiceId
  )
    throw new HttpError(409, 'Preview berubah atau sudah disubmit. Muat ulang invoice.');
  if (!chargeableItems(row.candidate.items).length)
    throw new HttpError(422, 'Invoice tanpa item yang dikirim tidak memerlukan customer Accurate.');
  const destination = await accurate.destination(batch.branchId, context);
  const branch = await branches.findById(batch.branchId, context);
  if (!destination || !branch?.active)
    throw new HttpError(422, 'Atur tujuan cabang Accurate terlebih dahulu.');
  return { batch, destination };
}

function named(records: Record<string, unknown>[], expected: string, label: string) {
  const matches = records.filter(
    (row) =>
      typeof row.name === 'string' &&
      normalizeCustomerName(row.name) === normalizeCustomerName(expected) &&
      row.suspended !== true,
  );
  if (matches.length !== 1)
    throw new HttpError(
      422,
      `Master ${label} “${expected}” harus tersedia tepat satu dan aktif di Accurate. Ditemukan ${matches.length}.`,
    );
  return matches[0];
}

async function setup(
  connection: Awaited<ReturnType<typeof connectedAccurate>>,
  targetBranchId: string,
) {
  const { client, profile } = connection;
  const numbers = await client.customerSetupList(profile, 'customer', {
    'filter.no.op': 'CONTAIN',
    'filter.no.val': 'MPA-',
    fields: 'id,customerNo',
  });
  const customerNo = nextMpaCustomerNumber(numbers);
  const fields = { fields: 'id,name,suspended' };
  const category = named(
    await client.customerSetupList(profile, 'customer-category', fields),
    'Astetic',
    'kategori pelanggan',
  );
  const branch = named(
    await client.customerSetupList(profile, 'branch', fields),
    'PT Mylab Prima Inovatif',
    'cabang',
  );
  const branchId = Number(branch.id);
  if (!Number.isSafeInteger(branchId) || branchId <= 0 || String(branchId) !== targetBranchId)
    throw new HttpError(
      422,
      'Cabang PT Mylab Prima Inovatif tidak sesuai dengan tujuan invoice. Periksa tujuan perusahaan di Settings.',
    );
  const currencies = (
    await client.customerSetupList(profile, 'currency', { fields: 'id,code,name' })
  ).filter(
    (row) =>
      row.suspended !== true &&
      (String(row.code ?? row.currencyCode ?? row.symbol) === 'IDR' ||
        normalizeCustomerName(String(row.name ?? '')) === 'indonesian rupiah'),
  );
  if (currencies.length !== 1)
    throw new HttpError(422, 'Master mata uang Indonesian Rupiah (IDR) harus tersedia tepat satu.');
  const price = named(
    await client.customerSetupList(profile, 'price-category', fields),
    'Umum',
    'kategori harga/diskon',
  );
  const term = named(
    await client.customerSetupList(profile, 'payment-term'),
    'C.O.D',
    'syarat pembayaran',
  );
  const defaults: AccurateCustomerDefaults = {
    categoryName: String(category.name),
    branchId,
    branchName: String(branch.name),
    currencyCode: 'IDR',
    currencyName: String(currencies[0].name || 'Indonesian Rupiah'),
    priceCategoryName: String(price.name),
    discountCategoryName: String(price.name),
    termName: String(term.name),
  };
  return { customerNo, defaults };
}

export async function prepareCustomer(batchId: string, rowId: string, version: number) {
  const { destination } = await invoiceContext(batchId, rowId, version);
  const connection = await connectedAccurate(true);
  if (connection.profile.id !== destination.databaseId)
    throw new HttpError(422, 'Database token berbeda dari tujuan invoice.');
  return {
    requestId: randomUUID(),
    databaseId: connection.profile.id,
    databaseName: connection.profile.name,
    ...(await setup(connection, destination.targetBranchId)),
  };
}

async function createdOutcome(requestId: string) {
  return (await audits.findByActionAndEntity(CREATED, requestId))[0];
}
async function isTerminal(requestId: string, context: DbExecutor) {
  return (
    (await audits.findByActionAndEntity(CREATED, requestId, context)).length > 0 ||
    (await audits.findByActionAndEntity(REJECTED, requestId, context)).length > 0
  );
}
function matches(
  customer: AccurateMaster | undefined,
  input: CreateInput,
): customer is AccurateMaster {
  return (
    !!customer &&
    customer.code === input.customerNo &&
    normalizeCustomerName(customer.name) === normalizeCustomerName(input.name)
  );
}
async function outcome(
  requestId: string,
  actorId: string,
  action: string,
  details: Record<string, unknown>,
) {
  await audits.create({ id: randomUUID(), actorId, action, entityId: requestId, details });
}

async function recover(
  request: NonNullable<Awaited<ReturnType<typeof audits.findById>>>,
  batchId: string,
  rowId: string,
  input: CreateInput,
  actorId: string,
  connection: Awaited<ReturnType<typeof connectedAccurate>>,
) {
  const saved = customerCreateInput
    .extend({ batchId: z.string(), rowId: z.string() })
    .safeParse(request.details);
  if (
    request.action !== REQUESTED ||
    request.actorId !== actorId ||
    !saved.success ||
    saved.data.batchId !== batchId ||
    saved.data.rowId !== rowId ||
    saved.data.requestId !== input.requestId ||
    saved.data.databaseId !== input.databaseId ||
    saved.data.customerNo !== input.customerNo ||
    saved.data.name !== input.name ||
    saved.data.version !== input.version
  )
    throw new HttpError(409, 'Identitas permintaan customer berbeda. Muat ulang form.');
  if (connection.profile.id !== input.databaseId)
    throw new HttpError(409, 'Database Accurate berubah.');
  if ((await audits.findByActionAndEntity(REJECTED, input.requestId)).length)
    throw new HttpError(
      422,
      'Permintaan ini sudah ditolak. Tutup dan buka kembali form untuk memeriksa data terbaru.',
    );
  // Replays only read Accurate; never repeat a POST after an uncertain write.
  const customer = await connection.client.customerByNumber(connection.profile, input.customerNo);
  if (!matches(customer, input))
    throw new HttpError(
      409,
      'Hasil pembuatan customer belum dapat dipastikan. Periksa nomor dan nama di Accurate; customer tidak dikirim ulang.',
    );
  if (!(await createdOutcome(input.requestId)))
    await outcome(input.requestId, actorId, CREATED, {
      customerId: customer.id,
      customerNo: customer.code,
      name: customer.name,
      recovered: true,
    });
  return customer;
}

export async function createCustomer(
  batchId: string,
  rowId: string,
  input: CreateInput,
  actorId: string,
) {
  const connectionSnapshot = await connections.findById('accurate');
  const connection = await connectedAccurate(true);
  const previous = await audits.findById(input.requestId);
  if (previous) return recover(previous, batchId, rowId, input, actorId, connection);
  const { batch, destination } = await invoiceContext(batchId, rowId, input.version);
  if (
    connection.profile.id !== destination.databaseId ||
    input.databaseId !== destination.databaseId
  )
    throw new HttpError(409, 'Database Accurate berubah. Muat ulang form customer.');
  const { customerNo, defaults } = await setup(connection, destination.targetBranchId);
  if (customerNo !== input.customerNo)
    throw new HttpError(
      409,
      'Urutan nomor MPA berubah. Muat ulang nomor customer sebelum menyimpan.',
    );
  const existing = await connection.client.customerSetupList(connection.profile, 'customer', {
    'filter.keywords.op': 'CONTAIN',
    'filter.keywords.val': input.name,
    fields: 'id,customerNo,name',
  });
  if (
    existing.some(
      (row) => normalizeCustomerName(String(row.name ?? '')) === normalizeCustomerName(input.name),
    )
  )
    throw new HttpError(
      409,
      'Nama customer sudah ditemukan di Accurate. Cari dan gunakan customer yang sudah ada.',
    );

  const claimed = await withTransaction(async (tx) => {
    const [lockedConnection] = await connections.lockById('accurate', tx);
    if (
      !lockedConnection?.enabled ||
      lockedConnection.encryptedSecret !== connectionSnapshot?.encryptedSecret
    )
      throw new HttpError(409, 'Koneksi Accurate berubah. Muat ulang form.');
    await batches.lockById(batchId, tx);
    await branches.lockById(batch.branchId, tx);
    const current = await invoiceContext(batchId, rowId, input.version, tx);
    if (
      current.destination.databaseId !== destination.databaseId ||
      current.destination.targetBranchId !== destination.targetBranchId
    )
      throw new HttpError(409, 'Tujuan invoice berubah. Muat ulang form.');
    if (await audits.findById(input.requestId, tx)) return false;
    const key = `${input.databaseId}:${input.customerNo}`;
    const reservations = [
      ...(await audits.findByActionAndEntity(REQUESTED, key, tx)),
      ...(await audits.customerRequestsForName(input.databaseId, input.name, tx)),
    ];
    for (const request of reservations)
      if (!(await isTerminal(request.id, tx)))
        throw new HttpError(
          409,
          'Nomor customer ini sedang diproses atau hasilnya belum pasti. Periksa Accurate terlebih dahulu.',
        );
    // Commit the write intent before contacting Accurate, including across process restarts.
    await audits.create(
      {
        id: input.requestId,
        actorId,
        action: REQUESTED,
        entityId: key,
        details: { ...input, batchId, rowId },
      },
      tx,
    );
    return true;
  });
  if (!claimed) {
    const request = await audits.findById(input.requestId);
    if (!request) throw new HttpError(409, 'Permintaan customer berubah.');
    return recover(request, batchId, rowId, input, actorId, connection);
  }
  const { branchName: _branchName, currencyName: _currencyName, ...masterDefaults } = defaults;
  const payload: AccurateCustomerPayload = { name: input.name, customerNo, ...masterDefaults };
  let customer: AccurateMaster;
  try {
    customer = await connection.client.saveCustomer(connection.profile, payload);
    if (!matches(customer, input))
      throw new AccurateWriteUncertain('Customer hasil Accurate berbeda dari permintaan.');
  } catch (error) {
    if (error instanceof AccurateWriteUncertain) {
      await outcome(input.requestId, actorId, UNCERTAIN, {
        customerNo,
        databaseId: input.databaseId,
      });
      throw new HttpError(
        409,
        'Hasil pembuatan customer belum pasti. Klik Periksa hasil; sistem tidak akan membuat customer ulang.',
      );
    }
    await outcome(input.requestId, actorId, REJECTED, { customerNo, databaseId: input.databaseId });
    throw error;
  }
  await outcome(input.requestId, actorId, CREATED, {
    customerId: customer.id,
    customerNo,
    name: customer.name,
  });
  return customer;
}
