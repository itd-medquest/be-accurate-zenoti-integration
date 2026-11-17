import { connectedAccurate } from './accurate-connection.service.js';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import * as receipts from '../repositories/receipts.repository.js';
import * as invoices from '../repositories/invoices.repository.js';
import * as branches from '../repositories/branches.repository.js';
import * as accurate from '../repositories/accurate.repository.js';
import * as audits from '../repositories/audit-logs.repository.js';
import { withTransaction, type DbExecutor } from '../repositories/unit-of-work.repository.js';
import { HttpError } from '../utils/http-error.js';
import { receiptAmounts } from '../utils/receipt-amounts.js';
import type {
  receiptDraftInput,
  receiptFilters,
  receiptMappingInput,
} from '../validations/receipts.validation.js';
import {
  draftSource,
  sourceGroups,
  singleReceiptGroups,
  lockActor,
  publicDraft,
  type Source,
} from './receipt-context.service.js';
import { receiptBalance } from './receipt-delivery.service.js';
import {
  receiptBanks,
  receiptMethods,
  receiptRates,
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
  };
  const rows: Row[] = [];
  const seen = new Set<string>();
  const companyName = (id: string) => companies.find((row) => row.id === id)?.name ?? id;
  const sourceErrors = new Map<string, string>();
  for (const source of sources) {
    let groups: ReceiptSourceGroup[];
    try {
      groups = sourceGroups(source);
      if (!saved.some((row) => row.draft.invoiceId === source.invoiceId && row.draft.attemptedAt))
        singleReceiptGroups(source);
    } catch (cause) {
      if (!(cause instanceof HttpError)) throw cause;
      sourceErrors.set(source.invoiceId, cause.message);
      if (!saved.some((row) => row.draft.invoiceId === source.invoiceId))
        rows.push({
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
    for (const group of groups) {
      const draft = saved.find(
        (value) =>
          value.draft.invoiceId === source.invoiceId && value.draft.sourceKey === group.key,
      )?.draft;
      if (draft) seen.add(draft.id);
      const error =
        draft &&
        (draft.sourceFingerprint !== group.fingerprint ||
          source.databaseId !== draft.databaseId ||
          source.targetBranchId !== draft.targetBranchId)
          ? 'Pembayaran sumber atau tujuan berubah setelah draft dibuat.'
          : (draft?.error ?? null);
      rows.push({
        invoiceId: source.invoiceId,
        invoiceNumber: source.targetNumber ?? source.invoiceNumber,
        customer: source.customer,
        branchId: source.branchId,
        branchName: companyName(source.branchId),
        sourceKey: group.key,
        sourceMethod: group.method,
        paidAt: draft?.sourcePayments[0]?.paidAt ?? group.paidAt,
        gross: draft?.grossAmount ?? group.gross,
        grouped: group.grouped,
        paymentCount: group.payments.length,
        status:
          draft?.status === 'DRAFT' && error ? 'NEEDS_REVIEW' : (draft?.status ?? 'TO_REVIEW'),
        draft: draft ? publicDraft(draft) : null,
        error,
      });
    }
  }
  // Persisted receipts remain visible even if their source is no longer eligible.
  for (const { draft, invoiceNumber, customer } of saved) {
    if (seen.has(draft.id)) continue;
    const error =
      sourceErrors.get(draft.invoiceId) ??
      'Pembayaran sumber tidak lagi cocok. Riwayat tersimpan tetap tersedia untuk pemeriksaan.';
    rows.push({
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
  const summary = { review: 0, draft: 0, processing: 0, succeeded: 0, attention: 0 };
  for (const row of entries) {
    if (row.status === 'TO_REVIEW') summary.review++;
    else if (row.status === 'DRAFT') summary.draft++;
    else if (['QUEUED', 'SENDING'].includes(row.status)) summary.processing++;
    else if (row.status === 'SUCCEEDED') summary.succeeded++;
    else summary.attention++;
  }
  const filtered = entries.filter((row) => !filters.status || row.status === filters.status);
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

export async function receiptConfiguration() {
  const { profile } = await connectedAccurate();
  return storedConfiguration(profile.id, profile.name);
}
async function storedConfiguration(databaseId: string, databaseName: string) {
  const [mappings, destinations] = await Promise.all([
    receipts.mappings(),
    accurate.destinations(),
  ]);
  return {
    database: { id: databaseId, name: databaseName },
    mappings: mappings.filter((row) => row.databaseId === databaseId),
    destinations: destinations.filter((row) => row.databaseId === databaseId),
    banks: receiptBanks,
    methods: receiptMethods,
    rates: receiptRates,
    rounding: 'ceil',
  };
}

export async function searchAccounts(input: {
  kind: 'bank' | 'fee';
  search: string;
  page: number;
}) {
  const { client, profile } = await connectedAccurate();
  return {
    database: { id: profile.id, name: profile.name },
    items: await client.receiptAccounts(profile, input.kind, input.search, input.page),
  };
}

export async function saveReceiptMapping(
  input: z.infer<typeof receiptMappingInput>,
  actorId: string,
) {
  const { client, profile } = await connectedAccurate();
  const account = await client.receiptAccount(profile, 'bank', input.accountId);
  const needsFee = input.method !== 'BANK_TRANSFER';
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
    if (!branch?.active || destination?.databaseId !== profile.id)
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
    const previous = await receipts.sourceDraft(invoiceId, sourceKey, tx);
    if (previous) return publicDraft(previous);
    const id = randomUUID();
    const [created] = await receipts.insert(
      {
        id,
        invoiceId,
        branchId: source.branchId,
        databaseId: source.databaseId,
        targetBranchId: source.targetBranchId,
        sourceKey,
        sourceFingerprint: group.fingerprint,
        sourcePayments: group.payments,
        sourceMethod: group.method,
        grossAmount: group.gross,
        number: source.targetNumber,
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
          gross: group.gross,
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
    key: draft.sourceKey,
    fingerprint: draft.sourceFingerprint,
    method: draft.sourcePayments[0]?.method ?? 'other',
    paidAt: draft.sourcePayments[0]?.paidAt ?? draft.createdAt.toISOString(),
    gross: draft.grossAmount,
    payments: draft.sourcePayments,
    grouped: draft.sourcePayments.some((row) => row.id.endsWith(':collection')),
  };
  const issues: string[] = [];
  try {
    const current = await draftSource(draft);
    source = current.source;
    group = current.group;
    if (draft.status === 'DRAFT' && !draft.attemptedAt) singleReceiptGroups(source);
  } catch (cause) {
    if (!(cause instanceof HttpError)) throw cause;
    issues.push(cause.message);
  }
  let config: Awaited<ReturnType<typeof storedConfiguration>>;
  try {
    config = await receiptConfiguration();
    if (config.database.id !== draft.databaseId) {
      issues.push('Koneksi Accurate berbeda dari database penerimaan ini.');
      config = await storedConfiguration(draft.databaseId, draft.databaseId);
    }
  } catch (cause) {
    if (!(cause instanceof HttpError)) throw cause;
    issues.push(cause.message);
    config = await storedConfiguration(draft.databaseId, draft.databaseId);
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
  return {
    draft: publicDraft(draft),
    invoice: {
      number: source?.targetNumber ?? invoice.number,
      customer: invoice.customer,
      total: invoice.total,
    },
    source: group,
    configuration: {
      ...config,
      mappings: config.mappings.filter((row) => row.branchId === draft.branchId),
    },
    validation: { editable: issues.length === 0, message: issues.join(' ') || null },
    delivery: {
      enabled:
        issues.length === 0 &&
        !balanceIssue &&
        !!balance &&
        balance.outstanding >= draft.grossAmount &&
        !['cash', 'gift_card', 'voucher'].includes(draft.sourceMethod),
      message: issues.length
        ? issues.join(' ')
        : balanceIssue ||
          (balance && balance.outstanding < draft.grossAmount
            ? 'Pembayaran melebihi sisa tagihan Accurate. Periksa pembayaran yang sudah dicatat.'
            : ['cash', 'gift_card', 'voucher'].includes(draft.sourceMethod)
              ? 'Metode sumber belum mendukung pengiriman penerimaan bank.'
              : ''),
    },
    balance,
    actions: {
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
  const { source } = await draftSource(existing);
  singleReceiptGroups(source);
  const number = source.targetNumber;
  if (!number) throw new HttpError(422, 'Nomor faktur Accurate belum tersedia.');
  const { client, profile } = await connectedAccurate(true);
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
  const amounts = receiptAmounts(existing.grossAmount, bankResult, method);
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
    await draftSource(locked, tx);
    const usedNumber = await receipts.findByNumber(existing.databaseId, number, tx);
    if (usedNumber && usedNumber.id !== locked.id)
      throw new HttpError(
        409,
        'No. Bukti sudah dipakai oleh penerimaan lain. Periksa riwayat penerimaan.',
      );
    if (mapping?.version !== chosen.version)
      throw new HttpError(409, 'Mapping akun berubah. Muat ulang draft.');
    const [saved] = await receipts.update(
      id,
      {
        number,
        mappingId: chosen.id,
        mappingVersion: chosen.version,
        bank: bankResult,
        method,
        bankAccountNo: chosen.accountNo,
        bankAccountName: chosen.accountName,
        feeAccountNo: chosen.feeAccountNo,
        feeAccountName: chosen.feeAccountName,
        rateBps: amounts.rateBps,
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
    );
    await audits.create(
      {
        id: randomUUID(),
        actorId,
        action: 'receipt.draft.save',
        entityId: id,
        details: {
          number: saved.number,
          ...(locked.number !== saved.number ? { previousNumber: locked.number } : {}),
          mappingId: chosen.id,
          rateBps: amounts.rateBps,
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

export async function receiptReference(number: string) {
  const { client, profile } = await connectedAccurate();
  const row = await client.receiptReference(profile, number);
  return {
    database: { id: profile.id, name: profile.name },
    fields: Object.keys(row),
    receipt: financialFields(row),
  };
}
