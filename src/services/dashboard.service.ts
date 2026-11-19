import { listScoped } from '../repositories/invoices.repository.js';
import type { InvoiceFilters } from '../validations/invoices.validation.js';
import { accurateConnection } from './accurate-connection.service.js';
import { findById } from '../repositories/branches.repository.js';

export async function getDashboard(filters: InvoiceFilters) {
  const scope = await listScoped(filters);
  const branch = filters.branch ? await findById(filters.branch) : undefined;
  const summary = {
    total: scope.length,
    synced: scope.filter((i) => i.syncStatus === 'SYNCED').length,
    processing: scope.filter((i) => i.syncStatus === 'PROCESSING').length,
    failed: scope.filter((i) => ['FAILED', 'NEEDS_REVIEW'].includes(i.syncStatus)).length,
    pending: scope.filter((i) => i.syncStatus === 'PENDING').length,
    closed: scope.filter((i) => i.businessStatus !== 'OPEN').length,
    open: scope.filter((i) => i.businessStatus === 'OPEN').length,
    outstanding: scope.reduce((n, i) => n + i.outstanding, 0),
  };
  const trend = new Map<string, { date: string; total: number; synced: number; failed: number }>();
  for (const row of scope.toReversed()) {
    const key = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Jakarta' }).format(row.date);
    const point = trend.get(key) ?? { date: key, total: 0, synced: 0, failed: 0 };
    point.total++;
    if (row.syncStatus === 'SYNCED') point.synced++;
    if (['FAILED', 'NEEDS_REVIEW'].includes(row.syncStatus)) point.failed++;
    trend.set(key, point);
  }
  const errors = new Map<string, number>();
  for (const row of scope) if (row.error) errors.set(row.error, (errors.get(row.error) ?? 0) + 1);
  return {
    integrationMode: (await accurateConnection(undefined, branch?.id)).mode,
    summary,
    rate: scope.some((invoice) => !invoice.syncStatus.startsWith('LOCAL_ONLY'))
      ? Math.round(
          (summary.synced /
            scope.filter((invoice) => !invoice.syncStatus.startsWith('LOCAL_ONLY')).length) *
            1000,
        ) / 10
      : 0,
    trend: [...trend.values()],
    recent: scope.toSorted((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).slice(0, 6),
    errors: [...errors].map(([message, count]) => ({ message, count })),
  };
}
