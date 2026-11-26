import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import * as receipts from '../repositories/receipts.repository.js';
import * as branches from '../repositories/branches.repository.js';
import * as audits from '../repositories/audit-logs.repository.js';
import { withTransaction, type DbExecutor } from '../repositories/unit-of-work.repository.js';
import { accurateConnection } from './accurate-connection.service.js';
import {
  draftSource,
  expectedReceiptNumber,
  lockActor,
  publicDraft,
  type Receipt,
  type Source,
} from './receipt-context.service.js';
import { allocationAmounts, receiptMode } from './receipt-settlement.service.js';
import {
  receiptBanks,
  receiptMethods,
  receiptRates,
  type AccurateReceiptPayload,
  type ReceiptVerification,
} from '../types/receipt.types.js';
import type { AccurateProfile } from '../types/accurate.types.js';
import { isSimulationReceipt, simulationReceiptDatabase } from '../utils/receipt-mode.js';
import { HttpError } from '../utils/http-error.js';

const accounts = [
  {
    id: '101',
    code: 'SIM-BCA',
    name: 'Simulasi - Bank BCA',
    type: 'CASH_BANK',
    currency: 'IDR',
    currencyId: '50',
  },
  {
    id: '102',
    code: 'SIM-BNI',
    name: 'Simulasi - Bank BNI',
    type: 'CASH_BANK',
    currency: 'IDR',
    currencyId: '50',
  },
  {
    id: '201',
    code: 'SIM-FEE',
    name: 'Simulasi - Biaya Administrasi Umum',
    type: 'EXPENSE',
    currency: 'IDR',
    currencyId: '50',
  },
];

export async function simulationReceiptConnection(branchId?: string, context?: DbExecutor) {
  if (!branchId) throw new HttpError(422, 'Pilih perusahaan untuk simulasi penerimaan.');
  const branch = await branches.findById(branchId, context);
  const connection = await accurateConnection(context, branchId);
  // The connection switch controls Accurate access; local simulations never use it.
  if (!branch?.active || connection.mode !== 'simulation')
    throw new HttpError(
      409,
      'Simulasi penerimaan dihentikan. Periksa perusahaan dan mode koneksi.',
    );
  return {
    profile: {
      id: simulationReceiptDatabase(branchId),
      name: `Simulasi - ${branch.name}`,
      host: 'https://simulation.invalid',
    },
    client: {
      async receiptAccounts(
        _profile: AccurateProfile,
        kind: 'bank' | 'fee',
        search = '',
        page = 1,
      ) {
        return page > 1
          ? []
          : accounts.filter(
              (row) =>
                (kind === 'bank' ? row.type === 'CASH_BANK' : row.type === 'EXPENSE') &&
                `${row.code} ${row.name}`.toLowerCase().includes(search.toLowerCase()),
            );
      },
      async receiptAccount(_profile: AccurateProfile, kind: 'bank' | 'fee', id: string) {
        const row = accounts.find(
          (row) =>
            row.id === id && (kind === 'bank' ? row.type === 'CASH_BANK' : row.type === 'EXPENSE'),
        );
        if (!row) throw new HttpError(422, 'Pilih akun contoh yang sesuai untuk simulasi.');
        return row;
      },
    },
  };
}

export async function simulationReceiptConfiguration(branchId: string) {
  const databaseId = simulationReceiptDatabase(branchId);
  const branch = await branches.findById(branchId);
  return {
    database: { id: databaseId, name: `Simulasi - ${branch?.name ?? branchId}` },
    mappings: (await receipts.mappings()).filter(
      (row) => row.databaseId === databaseId && row.branchId === branchId,
    ),
    destinations: [
      {
        branchId,
        databaseId,
        databaseName: `Simulasi - ${branch?.name ?? branchId}`,
        targetBranchId: '1',
        targetBranchName: 'Cabang simulasi',
        updatedAt: new Date(0),
      },
    ],
    banks: receiptBanks,
    methods: receiptMethods,
    rates: receiptRates,
    rounding: 'ceil' as const,
  };
}

export async function ensureSimulationMappings(branchId: string, context: DbExecutor) {
  const { profile } = await simulationReceiptConnection(branchId, context);
  for (const bank of receiptBanks)
    for (const method of receiptMethods) {
      const account = accounts[bank === 'BCA' ? 0 : 1];
      const fee = method === 'BANK_TRANSFER' ? null : accounts[2];
      await receipts.insertSimulationMapping(
        {
          id: randomUUID(),
          branchId,
          databaseId: profile.id,
          bank,
          method,
          accountId: account.id,
          accountNo: account.code,
          accountName: account.name,
          feeAccountId: fee?.id ?? null,
          feeAccountNo: fee?.code ?? null,
          feeAccountName: fee?.name ?? null,
          version: 1,
        },
        context,
      );
    }
}

export async function simulationReceiptBalance(row: Receipt, source: Source, context?: DbExecutor) {
  if (
    !isSimulationReceipt(row) ||
    source.mode !== 'simulation' ||
    row.databaseId !== simulationReceiptDatabase(source.branchId)
  )
    throw new HttpError(409, 'Tujuan penerimaan bukan faktur simulasi.');
  const completed = (await receipts.forInvoice(row.invoiceId, context)).filter(
    (receipt) => receipt.status === 'SUCCEEDED' && receipt.databaseId === row.databaseId,
  );
  const outstanding =
    source.expectedTotal - completed.reduce((sum, receipt) => sum + receipt.grossAmount, 0);
  if (outstanding < 0) throw new HttpError(409, 'Alokasi simulasi melebihi tagihan sumber.');
  return { outstanding, checkedAt: new Date().toISOString() };
}

async function prepare(row: Receipt, context: DbExecutor) {
  const { source, group } = await draftSource(row, context);
  await simulationReceiptConnection(row.branchId, context);
  if (
    source.mode !== 'simulation' ||
    source.total !== source.expectedTotal ||
    source.exception === 'REFUND' ||
    source.businessStatus === 'VOIDED'
  )
    throw new HttpError(422, 'Faktur simulasi tidak sesuai atau memerlukan pemeriksaan Finance.');
  if (row.number !== (await expectedReceiptNumber(row, source, group, context)))
    throw new HttpError(409, 'Nomor receipt simulasi berubah. Simpan ulang draft.');
  const mapping = row.mappingId ? await receipts.mapping(row.mappingId, context) : undefined;
  const method = receiptMethods.find((value) => value === row.method);
  if (
    !mapping ||
    !method ||
    !receiptBanks.some((bank) => bank === row.bank) ||
    mapping.databaseId !== row.databaseId ||
    mapping.branchId !== row.branchId ||
    mapping.version !== row.mappingVersion ||
    mapping.method !== method ||
    mapping.bank !== row.bank ||
    mapping.accountNo !== row.bankAccountNo ||
    mapping.feeAccountNo !== row.feeAccountNo
  )
    throw new HttpError(409, 'Mapping simulasi berubah. Simpan ulang draft.');
  if (
    ['cash', 'gift_card', 'voucher'].includes(row.sourceMethod) ||
    (row.sourceMethod === 'qris' && method !== 'QRIS') ||
    (row.sourceMethod === 'bank' && method !== 'BANK_TRANSFER') ||
    (row.sourceMethod === 'card' && !['CREDIT_CARD', 'DEBIT_CARD'].includes(method))
  )
    throw new HttpError(422, 'Metode sumber tidak cocok dengan penerimaan bank yang dipilih.');
  const amounts = await allocationAmounts(
    row,
    group,
    method,
    receiptMode(row.amountMode),
    row.inputAmount,
    context,
  );
  if (
    amounts.gross !== row.grossAmount ||
    amounts.fee !== row.feeAmount ||
    amounts.net !== row.netAmount ||
    amounts.rateBps !== row.rateBps ||
    !row.paymentReference.trim()
  )
    throw new HttpError(409, 'Simpan dan periksa ulang nominal penerimaan simulasi.');
  const balance = await simulationReceiptBalance(row, source, context);
  if (
    balance.outstanding < amounts.gross ||
    row.paymentDate <
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(source.date)
  )
    throw new HttpError(
      422,
      'Nominal melebihi sisa tagihan atau tanggal mendahului faktur simulasi.',
    );
  if ((await receipts.unresolved(row.invoiceId, row.id, context)).length)
    throw new HttpError(409, 'Penerimaan lain untuk faktur ini masih diproses.');
  const { client, profile } = await simulationReceiptConnection(row.branchId, context);
  const account = await client.receiptAccount(profile, 'bank', mapping.accountId);
  const fee =
    amounts.fee && mapping.feeAccountId
      ? await client.receiptAccount(profile, 'fee', mapping.feeAccountId)
      : null;
  if (
    account.code !== row.bankAccountNo ||
    (amounts.fee && (!fee || fee.code !== row.feeAccountNo))
  )
    throw new HttpError(409, 'Akun simulasi tidak sesuai mapping.');
  const payload: AccurateReceiptPayload = {
    number: row.number,
    bankNo: account.code,
    customerNo: source.customerId,
    branchId: 1,
    currencyCode: 'IDR',
    transDate: `${row.paymentDate.slice(8)}/${row.paymentDate.slice(5, 7)}/${row.paymentDate.slice(0, 4)}`,
    chequeAmount: amounts.net,
    paymentMethod: method,
    description: `SIMULASI - ${source.customer.trim()} - Pembayaran Invoices no ${source.targetNumber}`,
    detailInvoice: [
      {
        invoiceNo: source.targetNumber,
        paymentAmount: amounts.gross,
        ...(amounts.fee && fee
          ? {
              detailDiscount: [
                {
                  accountNo: fee.code,
                  amount: amounts.fee,
                  discountNotes: 'Biaya administrasi bank',
                },
              ],
            }
          : {}),
      },
    ],
  };
  const verification: ReceiptVerification = {
    simulation: true,
    invoiceId: source.targetId,
    customerId: source.customerId,
    currencyId: '50',
    bankId: account.id,
    feeAccountId: fee?.id ?? null,
    outstandingBefore: balance.outstanding,
    writeRejected: false,
  };
  return { payload, verification };
}

export async function submitSimulatedReceipt(row: Receipt, version: number, actorId: string) {
  return withTransaction(async (tx) => {
    await lockActor(actorId, ['super_admin', 'finance'], tx);
    const [branch] = await branches.lockById(row.branchId, tx);
    if (!branch?.active) throw new HttpError(409, 'Perusahaan dinonaktifkan.');
    await receipts.lockInvoice(row.invoiceId, tx);
    const [current] = await receipts.lock(row.id, tx);
    if (!current) throw new HttpError(404, 'Penerimaan tidak ditemukan.');
    if (['QUEUED', 'SENDING', 'SUCCEEDED'].includes(current.status)) return publicDraft(current);
    if (current.status !== 'DRAFT' || current.version !== version || current.attemptedAt)
      throw new HttpError(409, 'Draft berubah atau sudah dikirim. Muat ulang halaman.');
    const prepared = await prepare(current, tx);
    const [saved] = await receipts.update(
      current.id,
      {
        status: 'QUEUED',
        ...prepared,
        reviewedAt: new Date(),
        queuedAt: new Date(),
        error: null,
        actorId,
        version: current.version + 1,
      },
      tx,
    );
    await audits.create(
      {
        id: randomUUID(),
        actorId,
        action: 'receipt.simulation.enqueue',
        entityId: current.id,
        details: {
          simulation: true,
          gross: saved.grossAmount,
          fee: saved.feeAmount,
          net: saved.netAmount,
        },
      },
      tx,
    );
    return publicDraft(saved);
  });
}

export async function completeSimulatedReceipt(row: Receipt) {
  return withTransaction(async (tx) => {
    if (!row.actorId) throw new HttpError(409, 'Operator simulasi tidak tersedia.');
    await lockActor(row.actorId, ['super_admin', 'finance'], tx);
    const [branch] = await branches.lockById(row.branchId, tx);
    if (!branch?.active) throw new HttpError(409, 'Perusahaan dinonaktifkan.');
    await receipts.lockInvoice(row.invoiceId, tx);
    const [current] = await receipts.lock(row.id, tx);
    if (
      !current ||
      current.status !== 'SENDING' ||
      current.version !== row.version ||
      current.attemptedAt
    )
      throw new HttpError(409, 'Antrean simulasi berubah.');
    const prepared = await prepare(current, tx);
    if (!current.verification?.simulation || !isDeepStrictEqual(prepared.payload, current.payload))
      throw new HttpError(409, 'Payload simulasi berbeda dari pemeriksaan Finance.');
    const now = new Date();
    const [saved] = await receipts.update(
      current.id,
      {
        status: 'SUCCEEDED',
        targetId: `SIM-RC:${current.id}`,
        targetNumber: current.number,
        attemptedAt: now,
        completedAt: now,
        error: null,
        version: current.version + 1,
      },
      tx,
    );
    await audits.create(
      {
        id: randomUUID(),
        actorId: row.actorId,
        action: 'receipt.simulation.succeeded',
        entityId: row.id,
        details: {
          simulation: true,
          number: saved.number,
          gross: saved.grossAmount,
          fee: saved.feeAmount,
          net: saved.netAmount,
        },
      },
      tx,
    );
    return publicDraft(saved);
  });
}
