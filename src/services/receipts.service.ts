import { connectedAccurate } from './accurate-connection.service.js';
import { accurateConnection } from './accurate-connection.service.js';
import {
  simulationReceiptConnection,
  simulationReceiptConfiguration,
  ensureSimulationMappings,
} from './receipt-simulation.service.js';
import { isSimulationReceipt } from '../utils/receipt-mode.js';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import * as receipts from '../repositories/receipts.repository.js';
import * as invoices from '../repositories/invoices.repository.js';
import * as branches from '../repositories/branches.repository.js';
import * as accurate from '../repositories/accurate.repository.js';
import * as audits from '../repositories/audit-logs.repository.js';
import { withTransaction, type DbExecutor } from '../repositories/unit-of-work.repository.js';
import { HttpError } from '../utils/http-error.js';
import { receiptStageKey, receiptStageNumber } from '../utils/receipt-settlement.js';
import {
  allocationAmounts,
  paymentKey,
  receiptMode,
  sourceProgress,
} from './receipt-settlement.service.js';
import type {
  receiptDraftInput,
  receiptFilters,
  receiptMappingInput,
} from '../validations/receipts.validation.js';
import {
  draftSource,
  sourceGroups,
  singleReceiptGroups,
  receiptNumber,
  receiptBaseNumber,
  expectedReceiptNumber,
  lockActor,
  publicDraft,
  type Source,
} from './receipt-context.service.js';
import { receiptBalance } from './receipt-delivery.service.js';
import { pendingReceiptNumber } from '../utils/receipt-number.js';
import { isDuplicateEntry } from '../repositories/mysql-errors.js';
import {
  receiptBanks,
  receiptMethods,
  receiptRates,
  receiptMappingRate,
  type ReceiptSourceGroup,
} from '../types/receipt.types.js';

const day = (value: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date(value));

export async function receiptOverview(filters: z.infer<typeof receiptFilters>) {
  const [sources, saved, companies] = await Promise.all([
    receipts.sources(),
    receipts.list(),
    branches.list(),
  ]);
  type Row = {
    mode: 'simulation' | 'live';
    invoiceId: string;
    invoiceNumber: string;
    customer: string;
    branchId: string;
    branchName: string;
    sourceKey: string;
    sourceMethod: string;
    paidAt: string;
    gross: number | null;
    grouped: boolean;
    paymentCount: number;
    status: string;
    draft: ReturnType<typeof publicDraft> | null;
    error: string | null;
    settlement?: {
      gross: number;
      settled: number;
      remaining: number;
      paymentCount: number;
      fee: number;
    };
  };
  const rows: Row[] = [];
  const seen = new Set<string>();
  const companyName = (id: string) => companies.find((row) => row.id === id)?.name ?? id;
  const sourceErrors = new Map<string, string>();
  for (const source of sources) {
    const records = saved
      .filter(
        (row) =>
          row.draft.invoiceId === source.invoiceId &&
          isSimulationReceipt(row.draft) === (source.mode === 'simulation'),
      )
      .map((row) => row.draft);
    let groups: ReceiptSourceGroup[];
    try {
      groups = sourceGroups(source);
    } catch (cause) {
      if (!(cause instanceof HttpError)) throw cause;
      sourceErrors.set(source.invoiceId, cause.message);
      if (!records.length)
        rows.push({
          mode: source.mode,
          invoiceId: source.invoiceId,
          invoiceNumber: source.targetNumber ?? source.invoiceNumber,
          customer: source.customer,
          branchId: source.branchId,
          branchName: companyName(source.branchId),
          sourceKey: '',
          sourceMethod: 'other',
          paidAt: source.date.toISOString(),
          gross: null,
          grouped: false,
          paymentCount: 0,
          status: 'NEEDS_REVIEW',
          draft: null,
          error: cause.message,
        });
      continue;
    }
    if (!groups.length) continue;
    const payments = groups.map((group) => ({ group, ...sourceProgress(group, records) }));
    const stages = payments.flatMap((payment) => payment.stages);
    stages.forEach((row) => seen.add(row.id));
    const gross = groups.reduce((sum, group) => sum + group.gross, 0);
    const settled = payments.reduce((sum, payment) => sum + payment.settled, 0);
    const remaining = Math.max(0, gross - settled);
    const stale = payments.some(
      ({ group, stages, settled }) =>
        settled > group.gross ||
        stages.some(
          (row) =>
            row.sourceFingerprint !== group.fingerprint ||
            row.databaseId !== source.databaseId ||
            row.targetBranchId !== source.targetBranchId,
        ),
    );
    const problem = stages.find(
      (row) => row.status === 'NEEDS_REVIEW' || (row.status === 'DRAFT' && row.error),
    );
    const processing = stages.find((row) => ['QUEUED', 'SENDING'].includes(row.status));
    const draftStage = stages.find((row) => row.status === 'DRAFT');
    const chosen = problem ?? processing ?? draftStage;
    const selected =
      (chosen && payments.find((payment) => payment.group.key === paymentKey(chosen))) ||
      payments.find((payment) => payment.remaining > 0) ||
      payments[0];
    const draft = chosen ?? selected.stages.at(-1);
    const error = stale
      ? 'Pembayaran sumber atau tujuan berubah setelah draft dibuat.'
      : (problem?.error ?? null);
    const status =
      stale || problem
        ? 'NEEDS_REVIEW'
        : processing
          ? processing.status
          : settled > 0 && remaining > 0
            ? 'PARTIAL'
            : remaining === 0
              ? 'SUCCEEDED'
              : draftStage
                ? 'DRAFT'
                : 'TO_REVIEW';
    rows.push({
      mode: source.mode,
      invoiceId: source.invoiceId,
      invoiceNumber: source.targetNumber ?? source.invoiceNumber,
      customer: source.customer,
      branchId: source.branchId,
      branchName: companyName(source.branchId),
      sourceKey: selected.group.key,
      sourceMethod: groups.length > 1 ? 'mixed' : selected.group.method,
      paidAt: selected.group.paidAt,
      gross,
      grouped: groups.some((group) => group.grouped),
      paymentCount: groups.reduce((sum, group) => sum + group.payments.length, 0),
      status,
      draft: draft ? publicDraft(draft) : null,
      error,
      settlement: {
        gross,
        settled,
        remaining,
        paymentCount: groups.length,
        fee: stages.reduce((sum, row) => sum + row.feeAmount, 0),
      },
    });
  }
  // Persisted receipts remain visible even if their source is no longer eligible.
  for (const { draft, invoiceNumber, customer } of saved) {
    if (seen.has(draft.id)) continue;
    const error =
      sourceErrors.get(draft.invoiceId) ??
      'Pembayaran sumber tidak lagi cocok. Riwayat tersimpan tetap tersedia untuk pemeriksaan.';
    rows.push({
      mode: isSimulationReceipt(draft) ? 'simulation' : 'live',
      invoiceId: draft.invoiceId,
      invoiceNumber,
      customer,
      branchId: draft.branchId,
      branchName: companyName(draft.branchId),
      sourceKey: draft.sourceKey,
      sourceMethod: draft.sourceMethod,
      paidAt: draft.sourcePayments[0]?.paidAt ?? draft.createdAt.toISOString(),
      gross: draft.grossAmount,
      grouped: draft.sourcePayments.some((row) => row.id.endsWith(':collection')),
      paymentCount: draft.sourcePayments.length,
      status: draft.status === 'DRAFT' ? 'NEEDS_REVIEW' : draft.status,
      draft: publicDraft(draft),
      error,
    });
  }
  const entries = rows.filter((row) => {
    const date = row.draft?.paymentDate || day(row.paidAt);
    const search = filters.search.toLocaleLowerCase('id');
    return (
      (!filters.branch || row.branchId === filters.branch) &&
      (!filters.from || date >= filters.from) &&
      (!filters.to || date <= filters.to) &&
      (!search ||
        [
          row.invoiceNumber,
          row.customer,
          row.draft?.number,
          row.draft?.targetNumber,
          row.draft?.paymentReference,
        ].some((value) => value?.toLocaleLowerCase('id').includes(search)))
    );
  });
  const summary = { review: 0, draft: 0, processing: 0, succeeded: 0, attention: 0, partial: 0 };
  for (const row of entries) {
    if (row.status === 'PARTIAL') summary.partial++;
    else if (row.status === 'TO_REVIEW') summary.review++;
    else if (row.status === 'DRAFT') summary.draft++;
    else if (['QUEUED', 'SENDING'].includes(row.status)) summary.processing++;
    else if (row.status === 'SUCCEEDED') summary.succeeded++;
    else summary.attention++;
  }
  const filtered = entries.filter((row) =>
    filters.status === 'PROCESSING'
      ? ['QUEUED', 'SENDING'].includes(row.status)
      : !filters.status || row.status === filters.status,
  );
  const total = filtered.length;
  const page = Math.min(filters.page, Math.max(1, Math.ceil(total / filters.pageSize)));
  return {
    items: filtered.slice((page - 1) * filters.pageSize, page * filters.pageSize),
    total,
    page,
    pageSize: filters.pageSize,
    summary,
  };
}

export async function receiptConfiguration(branchId?: string) {
  if ((await accurateConnection(undefined, branchId)).mode === 'simulation') {
    if (!branchId) throw new HttpError(422, 'Pilih perusahaan untuk simulasi penerimaan.');
    await simulationReceiptConnection(branchId);
    return simulationReceiptConfiguration(branchId);
  }
  const { profile } = await connectedAccurate(false, branchId);
  return storedConfiguration(profile.id, profile.name, branchId);
}
async function storedConfiguration(databaseId: string, databaseName: string, branchId?: string) {
  const [mappings, destinations] = await Promise.all([
    receipts.mappings(),
    accurate.destinations(),
  ]);
  return {
    database: { id: databaseId, name: databaseName },
    mappings: mappings.filter(
      (row) => row.databaseId === databaseId && (!branchId || row.branchId === branchId),
    ),
    destinations: destinations.filter(
      (row) => row.databaseId === databaseId && (!branchId || row.branchId === branchId),
    ),
    banks: receiptBanks,
    methods: receiptMethods,
    rates: receiptRates,
    rounding: 'ceil',
  };
}

export async function searchAccounts(input: {
  branchId?: string;
  kind: 'bank' | 'fee';
  search: string;
  page: number;
}) {
  const { client, profile } =
    (await accurateConnection(undefined, input.branchId)).mode === 'simulation'
      ? await simulationReceiptConnection(input.branchId)
      : await connectedAccurate(false, input.branchId);
  return {
    database: { id: profile.id, name: profile.name },
    items: await client.receiptAccounts(profile, input.kind, input.search, input.page),
  };
}

export async function saveReceiptMapping(
  input: z.infer<typeof receiptMappingInput>,
  actorId: string,
) {
  const simulation = (await accurateConnection(undefined, input.branchId)).mode === 'simulation';
  const { client, profile } = simulation
    ? await simulationReceiptConnection(input.branchId)
    : await connectedAccurate(false, input.branchId);
  const account = await client.receiptAccount(profile, 'bank', input.accountId);
  const priorMapping = (await receipts.mappings()).find(
    (row) =>
      row.branchId === input.branchId &&
      row.databaseId === profile.id &&
      row.bank === input.bank &&
      row.method === input.method,
  );
  const rateBps = input.rateBps ?? receiptMappingRate(priorMapping ?? {}, input.method);
  const needsFee = input.method !== 'BANK_TRANSFER' || rateBps > 0;
  if (!needsFee && input.feeAccountId)
    throw new HttpError(
      422,
      'Transfer rekening langsung tidak menggunakan akun biaya administrasi.',
    );
  if (needsFee && !input.feeAccountId)
    throw new HttpError(422, 'Pilih akun beban administrasi untuk metode ini.');
  const fee = input.feeAccountId
    ? await client.receiptAccount(profile, 'fee', input.feeAccountId)
    : null;
  return withTransaction(async (tx) => {
    await lockActor(actorId, ['super_admin'], tx);
    const [branch] = await branches.lockById(input.branchId, tx);
    const destination = await accurate.destination(input.branchId, tx);
    if (!branch?.active || (!simulation && destination?.databaseId !== profile.id))
      throw new HttpError(409, 'Perusahaan belum memiliki tujuan Accurate yang sesuai.');
    const previous = (await receipts.mappings(tx)).find(
      (row) =>
        row.branchId === input.branchId &&
        row.databaseId === profile.id &&
        row.bank === input.bank &&
        row.method === input.method,
    );
    if ((previous?.version ?? 0) !== input.version)
      throw new HttpError(409, 'Mapping berubah. Muat ulang pengaturan.');
    const [saved] = await receipts.saveMapping(
      {
        id: previous?.id ?? randomUUID(),
        branchId: input.branchId,
        databaseId: profile.id,
        bank: input.bank,
        method: input.method,
        accountId: account.id,
        accountNo: account.code,
        accountName: account.name,
        feeAccountId: fee?.id ?? null,
        feeAccountNo: fee?.code ?? null,
        feeAccountName: fee?.name ?? null,
        rateBps,
        version: input.version + 1,
      },
      tx,
    );
    await audits.create(
      {
        id: randomUUID(),
        actorId,
        action: 'receipt.mapping.save',
        entityId: saved.id,
        details: {
          bank: input.bank,
          method: input.method,
          branchId: input.branchId,
          accountNo: account.code,
          feeAccountNo: fee?.code ?? null,
          rateBps,
          previousRateBps: previous ? receiptMappingRate(previous, input.method) : null,
        },
      },
      tx,
    );
    return saved;
  });
}

export async function prepareReceipt(invoiceId: string, sourceKey: string, actorId: string) {
  return withTransaction(async (tx) => {
    await lockActor(actorId, ['super_admin', 'finance'], tx);
    await invoices.lockById(invoiceId, tx);
    const source = (await receipts.sources(tx)).find((value) => value.invoiceId === invoiceId);
    const group = source && singleReceiptGroups(source).find((value) => value.key === sourceKey);
    if (!source || !group || !source.targetId || !source.targetNumber)
      throw new HttpError(422, 'Faktur atau pembayaran terverifikasi tidak tersedia.');
    const records = (await receipts.forInvoice(invoiceId, tx)).filter(
      (row) => isSimulationReceipt(row) === (source.mode === 'simulation'),
    );
    if (source.mode === 'simulation') await ensureSimulationMappings(source.branchId, tx);
    const progress = sourceProgress(group, records);
    const active = progress.stages.find((row) => row.status !== 'SUCCEEDED');
    if (active) return publicDraft(active);
    if (progress.remaining <= 0) {
      const last = progress.stages.at(-1);
      if (last) return publicDraft(last);
      throw new HttpError(409, 'Pembayaran sumber sudah selesai.');
    }
    const id = randomUUID();
    const receiptSequence = records.length
      ? Math.max(...records.map((row) => row.receiptSequence)) + 1
      : 0;
    const baseNumber = await receiptBaseNumber(source, group, tx);
    let number: string;
    try {
      number = baseNumber
        ? receiptStageNumber(baseNumber, receiptSequence)
        : pendingReceiptNumber(id);
    } catch {
      throw new HttpError(
        422,
        'Nomor receipt tidak dapat diberi urutan. Periksa panjang nomor sumber.',
      );
    }
    const [created] = await receipts.insert(
      {
        id,
        invoiceId,
        branchId: source.branchId,
        databaseId: source.databaseId,
        targetBranchId: source.targetBranchId,
        sourceKey:
          source.mode === 'simulation'
            ? receiptStageKey(`simulation:${sourceKey}`, receiptSequence)
            : receiptSequence === 0
              ? sourceKey
              : receiptStageKey(sourceKey, receiptSequence),
        paymentSourceKey: sourceKey,
        receiptSequence,
        baseNumber,
        sourceFingerprint: group.fingerprint,
        sourcePayments: group.payments,
        sourceMethod: group.method,
        grossAmount: progress.remaining,
        number,
        paymentDate: day(group.paidAt),
        actorId,
      },
      tx,
    );
    if (!created)
      throw new HttpError(
        409,
        'No. Bukti sudah dipakai oleh penerimaan lain. Periksa riwayat penerimaan.',
      );
    await audits.create(
      {
        id: randomUUID(),
        actorId,
        action: 'receipt.draft.create',
        entityId: id,
        details: {
          invoiceId,
          sourceKey,
          gross: progress.remaining,
          receiptSequence,
          sourcePaymentCount: group.payments.length,
        },
      },
      tx,
    );
    const row = await receipts.find(id, tx);
    if (!row) throw new HttpError(500, 'Draft belum tersedia.');
    return publicDraft(row);
  });
}

export async function receiptDetail(id: string) {
  const draft = await receipts.find(id);
  if (!draft) throw new HttpError(404, 'Penerimaan tidak ditemukan.');
  const invoice = await invoices.findById(draft.invoiceId);
  if (!invoice) throw new HttpError(404, 'Invoice sumber tidak ditemukan.');
  let source: Source | undefined;
  let group: ReceiptSourceGroup = {
    key: paymentKey(draft),
    fingerprint: draft.sourceFingerprint,
    method: draft.sourcePayments[0]?.method ?? 'other',
    paidAt: draft.sourcePayments[0]?.paidAt ?? draft.createdAt.toISOString(),
    gross: draft.sourcePayments.reduce((sum, payment) => sum + payment.amount, 0),
    payments: draft.sourcePayments,
    grouped: draft.sourcePayments.some((row) => row.id.endsWith(':collection')),
  };
  const issues: string[] = [];
  let sourceNumber: string | null = null;
  let effectiveNumber: string | null = draft.targetNumber ?? draft.number;
  try {
    const current = await draftSource(draft);
    source = current.source;
    group = current.group;
    if (draft.status === 'DRAFT' && !draft.attemptedAt) {
      singleReceiptGroups(source);
      effectiveNumber = await expectedReceiptNumber(draft, source, group);
      sourceNumber = (await receiptNumber(source, group)) ? effectiveNumber : null;
    }
  } catch (cause) {
    if (!(cause instanceof HttpError)) throw cause;
    issues.push(cause.message);
  }
  let config: Awaited<ReturnType<typeof storedConfiguration>>;
  try {
    if (isSimulationReceipt(draft)) {
      await simulationReceiptConnection(draft.branchId);
      config = await simulationReceiptConfiguration(draft.branchId);
    } else config = await receiptConfiguration(draft.branchId);
    if (config.database.id !== draft.databaseId) {
      issues.push('Koneksi Accurate berbeda dari database penerimaan ini.');
      config = await storedConfiguration(draft.databaseId, draft.databaseId, draft.branchId);
    }
  } catch (cause) {
    if (!(cause instanceof HttpError)) throw cause;
    issues.push(cause.message);
    config = isSimulationReceipt(draft)
      ? await simulationReceiptConfiguration(draft.branchId)
      : await storedConfiguration(draft.databaseId, draft.databaseId, draft.branchId);
  }
  let balance: Awaited<ReturnType<typeof receiptBalance>> | null = null;
  let balanceIssue = '';
  if (draft.status === 'DRAFT' && issues.length === 0) {
    try {
      balance = await receiptBalance(draft);
    } catch (cause) {
      if (!(cause instanceof HttpError)) throw cause;
      balanceIssue = cause.message;
    }
  }
  const records = (await receipts.forInvoice(draft.invoiceId)).filter(
    (row) => isSimulationReceipt(row) === isSimulationReceipt(draft),
  );
  const progress = sourceProgress(group, records);
  const available = Math.max(
    0,
    group.gross -
      progress.completed
        .filter((row) => row.id !== draft.id)
        .reduce((sum, row) => sum + row.grossAmount, 0),
  );
  const paymentSummaries = source
    ? sourceGroups(source).map((payment) => {
        const state = sourceProgress(payment, records);
        return {
          key: payment.key,
          method: payment.method,
          paidAt: payment.paidAt,
          gross: payment.gross,
          settled: state.settled,
          remaining: state.remaining,
          receiptId: state.stages.at(-1)?.id ?? null,
        };
      })
    : [];
  const settled = paymentSummaries.reduce((sum, payment) => sum + payment.settled, 0);
  const sourceTotal = paymentSummaries.reduce((sum, payment) => sum + payment.gross, 0);
  return {
    settlement: {
      available,
      settled: progress.settled,
      remaining: progress.remaining,
      invoiceGross: sourceTotal,
      invoiceSettled: settled,
      invoiceRemaining: Math.max(0, sourceTotal - settled),
      payments: paymentSummaries,
      history: progress.stages.map((row) => ({
        id: row.id,
        number: row.targetNumber ?? row.number,
        gross: row.grossAmount,
        fee: row.feeAmount,
        net: row.netAmount,
        method: row.method,
        status: row.status,
        paymentDate: row.paymentDate,
        error: row.error,
        rateBps: row.rateBps,
      })),
      feeBasisByRate: progress.completed
        .filter((row) => row.id !== draft.id)
        .map((row) => ({
          method: row.method,
          rateBps: row.rateBps,
          gross: row.grossAmount,
          fee: row.feeAmount,
        })),
      feeBasis: Object.fromEntries(
        receiptMethods.map((method) => {
          const completed = progress.completed.filter(
            (row) =>
              row.id !== draft.id && row.method === method && row.rateBps === receiptRates[method],
          );
          return [
            method,
            {
              gross: completed.reduce((sum, row) => sum + row.grossAmount, 0),
              fee: completed.reduce((sum, row) => sum + row.feeAmount, 0),
            },
          ];
        }),
      ),
    },
    draft: publicDraft(draft),
    receiptNumber: effectiveNumber === pendingReceiptNumber(draft.id) ? null : effectiveNumber,
    invoice: {
      number: source?.targetNumber ?? invoice.number,
      customer: invoice.customer,
      total: invoice.total,
    },
    source: { ...group, receiptNumber: sourceNumber },
    configuration: {
      ...config,
      mappings: config.mappings.filter((row) => row.branchId === draft.branchId),
    },
    validation: { editable: issues.length === 0, message: issues.join(' ') || null },
    delivery: {
      enabled:
        issues.length === 0 &&
        !balanceIssue &&
        !!effectiveNumber &&
        effectiveNumber !== pendingReceiptNumber(draft.id) &&
        !!balance &&
        balance.outstanding >= draft.grossAmount &&
        !['cash', 'gift_card', 'voucher'].includes(draft.sourceMethod),
      message: issues.length
        ? issues.join(' ')
        : !effectiveNumber || effectiveNumber === pendingReceiptNumber(draft.id)
          ? 'Isi No. Receipt dan simpan draft sebelum mengirim ke Accurate.'
          : balanceIssue ||
            (balance && balance.outstanding < draft.grossAmount
              ? 'Pembayaran melebihi sisa tagihan Accurate. Periksa pembayaran yang sudah dicatat.'
              : ['cash', 'gift_card', 'voucher'].includes(draft.sourceMethod)
                ? 'Metode sumber belum mendukung pengiriman penerimaan bank.'
                : ''),
    },
    balance,
    actions: {
      canContinue:
        issues.length === 0 &&
        draft.status === 'SUCCEEDED' &&
        progress.remaining > 0 &&
        progress.stages.every((row) => row.status === 'SUCCEEDED'),
      canSetNumber:
        issues.length === 0 &&
        draft.status === 'DRAFT' &&
        !draft.attemptedAt &&
        sourceNumber === null &&
        (records.length === 1 || records.every((row) => !row.baseNumber)),
      canCheck: draft.status === 'NEEDS_REVIEW' && !!draft.attemptedAt,
      canReopen:
        draft.status === 'NEEDS_REVIEW' &&
        (!draft.attemptedAt || !!draft.verification?.writeRejected),
    },
  };
}

export async function saveReceiptDraft(
  id: string,
  input: z.infer<typeof receiptDraftInput>,
  actorId: string,
) {
  const existing = await receipts.find(id);
  if (!existing) throw new HttpError(404, 'Draft tidak ditemukan.');
  const { source, group } = await draftSource(existing);
  singleReceiptGroups(source);
  const sourceNumber = await receiptNumber(source, group);
  const previousBase = await receiptBaseNumber(source, group);
  if (sourceNumber && input.receiptNumber !== undefined)
    throw new HttpError(422, 'Nomor receipt dari dokumen sumber tidak dapat diganti manual.');
  if (
    !sourceNumber &&
    input.receiptNumber &&
    previousBase &&
    input.receiptNumber !== previousBase &&
    (await receipts.forInvoice(existing.invoiceId)).filter(
      (row) => isSimulationReceipt(row) === isSimulationReceipt(existing),
    ).length > 1
  )
    throw new HttpError(
      409,
      'Nomor dasar sudah dipakai beberapa tahap. Nomor tidak dapat diganti.',
    );
  const baseNumber = sourceNumber ?? input.receiptNumber ?? previousBase;
  let number: string | null = null;
  try {
    number = baseNumber ? receiptStageNumber(baseNumber, existing.receiptSequence) : null;
  } catch {
    throw new HttpError(422, 'Nomor receipt terlalu panjang untuk urutan penerimaan.');
  }
  if (!number) throw new HttpError(422, 'Isi No. Receipt sebelum menyimpan draft.');
  const { client, profile } = isSimulationReceipt(existing)
    ? await simulationReceiptConnection(existing.branchId)
    : await connectedAccurate(true, existing.branchId);
  const chosen = await receipts.mapping(input.mappingId);
  if (
    !chosen ||
    chosen.databaseId !== existing.databaseId ||
    profile.id !== existing.databaseId ||
    chosen.branchId !== existing.branchId
  )
    throw new HttpError(422, 'Mapping tidak sesuai dengan perusahaan dan database faktur.');
  if (chosen.version !== input.mappingVersion)
    throw new HttpError(409, 'Mapping akun berubah. Muat ulang draft sebelum menyimpan.');
  const bankResult = receiptBanks.find((bank) => bank === chosen.bank);
  const method = receiptMethods.find((value) => value === chosen.method);
  if (!bankResult || !method) throw new HttpError(422, 'Metode atau bank belum didukung.');
  if (['gift_card', 'voucher', 'cash'].includes(existing.sourceMethod))
    throw new HttpError(
      422,
      'Metode sumber ini memerlukan kebijakan akun terpisah; jangan dipetakan sebagai pembayaran bank.',
    );
  if (
    (existing.sourceMethod === 'qris' && method !== 'QRIS') ||
    (existing.sourceMethod === 'bank' && method !== 'BANK_TRANSFER') ||
    (existing.sourceMethod === 'card' && !['CREDIT_CARD', 'DEBIT_CARD'].includes(method))
  )
    throw new HttpError(422, 'Metode pilihan tidak cocok dengan metode pada dokumen sumber.');
  const account = await client.receiptAccount(profile, 'bank', chosen.accountId);
  const fee = chosen.feeAccountId
    ? await client.receiptAccount(profile, 'fee', chosen.feeAccountId)
    : null;
  if (account.code !== chosen.accountNo || (fee && fee.code !== chosen.feeAccountNo))
    throw new HttpError(
      409,
      'Kode akun di Accurate berubah. Simpan ulang mapping akun di Settings.',
    );
  const mode = receiptMode(input.amountMode ?? existing.amountMode);
  const rateOverrideBps =
    input.rateOverrideBps !== undefined
      ? input.rateOverrideBps
      : existing.mappingId === chosen.id
        ? existing.rateOverrideBps
        : null;
  const rateBps = rateOverrideBps ?? receiptMappingRate(chosen, method);
  const inputAmount = mode === 'FULL' ? null : (input.inputAmount ?? existing.inputAmount);
  if (mode === 'FULL' && input.inputAmount !== undefined)
    throw new HttpError(422, 'Mode penuh tidak menerima nominal manual.');
  const amounts = await allocationAmounts(
    existing,
    group,
    method,
    mode,
    inputAmount,
    undefined,
    rateBps,
  );
  if (amounts.net <= 0 || (amounts.fee > 0 && !chosen.feeAccountNo))
    throw new HttpError(422, 'Nilai bersih harus positif dan akun biaya harus tersedia.');
  return withTransaction(async (tx) => {
    await lockActor(actorId, ['super_admin', 'finance'], tx);
    const [branch] = await branches.lockById(existing.branchId, tx);
    if (!branch?.active) throw new HttpError(409, 'Perusahaan penerimaan dinonaktifkan.');
    await invoices.lockById(existing.invoiceId, tx);
    const [locked] = await receipts.lock(id, tx);
    const mapping = await receipts.mapping(input.mappingId, tx);
    if (
      !locked ||
      locked.version !== input.version ||
      locked.status !== 'DRAFT' ||
      locked.attemptedAt
    )
      throw new HttpError(409, 'Draft berubah atau sudah dikirim. Muat ulang sebelum melanjutkan.');
    const current = await draftSource(locked, tx);
    const currentBase = await receiptBaseNumber(current.source, current.group, tx);
    if (
      currentBase !== previousBase ||
      (!sourceNumber &&
        previousBase &&
        baseNumber !== previousBase &&
        (await receipts.forInvoice(locked.invoiceId, tx)).filter(
          (row) => isSimulationReceipt(row) === isSimulationReceipt(locked),
        ).length > 1)
    )
      throw new HttpError(409, 'Nomor dasar receipt berubah. Muat ulang draft.');
    const lockedAmounts = await allocationAmounts(
      locked,
      current.group,
      method,
      mode,
      inputAmount,
      tx,
      rateBps,
    );
    if (lockedAmounts.gross !== amounts.gross || lockedAmounts.fee !== amounts.fee)
      throw new HttpError(409, 'Sisa penerimaan berubah. Muat ulang sebelum menyimpan.');
    const usedNumber = await receipts.findByNumber(existing.databaseId, number, tx);
    if (usedNumber && usedNumber.id !== locked.id)
      throw new HttpError(
        409,
        'No. Bukti sudah dipakai oleh penerimaan lain. Periksa riwayat penerimaan.',
      );
    if (mapping?.version !== chosen.version)
      throw new HttpError(409, 'Mapping akun berubah. Muat ulang draft.');
    const [saved] = await receipts
      .update(
        id,
        {
          number,
          baseNumber,
          amountMode: mode,
          inputAmount,
          grossAmount: amounts.gross,
          mappingId: chosen.id,
          mappingVersion: chosen.version,
          bank: bankResult,
          method,
          bankAccountNo: chosen.accountNo,
          bankAccountName: chosen.accountName,
          feeAccountNo: chosen.feeAccountNo,
          feeAccountName: chosen.feeAccountName,
          rateBps: amounts.rateBps,
          rateOverrideBps,
          feeAmount: amounts.fee,
          netAmount: amounts.net,
          paymentDate: input.paymentDate,
          paymentReference: input.paymentReference,
          notes: input.notes,
          reviewedAt: null,
          version: locked.version + 1,
          error: null,
          actorId,
        },
        tx,
      )
      .catch((cause: unknown) => {
        if (isDuplicateEntry(cause))
          throw new HttpError(
            409,
            'No. Bukti sudah dipakai oleh penerimaan lain. Periksa riwayat penerimaan.',
          );
        throw cause;
      });
    if (!sourceNumber && input.receiptNumber !== undefined)
      await audits.create(
        {
          id: randomUUID(),
          actorId,
          action: 'receipt.number.manual',
          entityId: id,
          details: {
            number,
            previousNumber: publicDraft(locked).number,
            sourceFingerprint: locked.sourceFingerprint,
          },
        },
        tx,
      );
    await audits.create(
      {
        id: randomUUID(),
        actorId,
        action: 'receipt.draft.save',
        entityId: id,
        details: {
          number: saved.number,
          amountMode: mode,
          inputAmount,
          sourceKey: group.key,
          ...(locked.number !== saved.number ? { previousNumber: locked.number } : {}),
          mappingId: chosen.id,
          rateBps: amounts.rateBps,
          rateOverrideBps,
          previousRateBps: locked.rateBps,
          gross: amounts.gross,
          fee: amounts.fee,
          net: amounts.net,
        },
      },
      tx,
    );
    return publicDraft(saved);
  });
}

/** Keep inspection limited to financial identity and allocation fields, without contact data. */
function financialFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(financialFields);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) =>
            !/email|phone|mobile|address|contact|description|notes|remark|name/i.test(key) &&
            /^(id|no|number|transDate|chequeDate|currencyCode|bankNo|customerNo)$|amount|total|discount|payment|invoice|currency|branch|customer|bank|account|paid|rate|owing|due|balance/i.test(
              key,
            ),
        )
        .map(([key, entry]) => [key, financialFields(entry)]),
    );
  }
  return value;
}

export async function receiptReference(number: string, branchId?: string) {
  const { client, profile } = await connectedAccurate(false, branchId);
  const row = await client.receiptReference(profile, number);
  return {
    database: { id: profile.id, name: profile.name },
    fields: Object.keys(row),
    receipt: financialFields(row),
  };
}
