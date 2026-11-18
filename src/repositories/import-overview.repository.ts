import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import type { ImportOverview } from '../types/import-overview.types.js';
import type { ImportOverviewQuery } from '../validations/import-overview.validation.js';

export async function overview(query: ImportOverviewQuery) {
  const term = '%' + query.search.toLowerCase().replace(/[!%_]/g, '!$&') + '%';
  // Explicit calendar dates use inclusive WIB days, independently of the server timezone.
  // Retain the previous rolling-period query for existing clients.
  const since = query.dateFrom
    ? new Date(`${query.dateFrom}T00:00:00+07:00`).toISOString().replace('T', ' ').replace('Z', '')
    : !query.dateTo && query.days
      ? new Date(Date.now() - query.days * 86400000)
          .toISOString()
          .replace('T', ' ')
          .replace('Z', '')
      : null;
  const until = query.dateTo
    ? new Date(new Date(`${query.dateTo}T00:00:00+07:00`).getTime() + 86400000)
        .toISOString()
        .replace('T', ' ')
        .replace('Z', '')
    : null;
  // One statement gives the page and aggregate counts the same database snapshot.
  // SYNCED without a live delivery is a simulation, never a verified Accurate success.
  const [result] = await db.execute(sql`
    with scoped_batches as (
      select b.* from import_batches b
      where b.status not in ('DELETED', 'ARCHIVED')
        ${query.branch ? sql`and b.branch_id = ${query.branch}` : sql``}
        ${since ? sql`and b.created_at >= ${since}` : sql``}
        ${until ? sql`and b.created_at < ${until}` : sql``}
        ${
          query.search
            ? sql`and (
          lower(b.id) like ${term} escape '!' or exists (
            select 1 from import_rows r join import_files f on f.id = r.file_id
            where r.batch_id = b.id and r.status <> 'DELETED'
              and (lower((JSON_UNQUOTE(JSON_EXTRACT(r.candidate, '$.number')) COLLATE utf8mb4_0900_bin)) like ${term} escape '!'
                or lower((JSON_UNQUOTE(JSON_EXTRACT(r.candidate, '$.sourceInvoiceNumber')) COLLATE utf8mb4_0900_bin)) like ${term} escape '!'
                or lower((JSON_UNQUOTE(JSON_EXTRACT(r.candidate, '$.customer')) COLLATE utf8mb4_0900_bin)) like ${term} escape '!'
                or lower(f.name) like ${term} escape '!')
          )
        )`
            : sql``
        }
    ), classified as (
      select b.id as batch_id, r.id,
        coalesce(i.id, concat(b.branch_id, ':', coalesce(nullif((JSON_UNQUOTE(JSON_EXTRACT(r.candidate, '$.sourceId')) COLLATE utf8mb4_0900_bin), ''), r.id))) as invoice_identity,
        coalesce(nullif((JSON_UNQUOTE(JSON_EXTRACT(r.candidate, '$.sourceInvoiceNumber')) COLLATE utf8mb4_0900_bin), ''), nullif((JSON_UNQUOTE(JSON_EXTRACT(r.candidate, '$.number')) COLLATE utf8mb4_0900_bin), ''), 'Belum terbaca') as reference,
        case
          when b.status = 'PREVIEW' and r.status <> 'DUPLICATE' then 'draft'
          when i.sync_status = 'LOCAL_ONLY' then 'redeem'
          when i.sync_status = 'LOCAL_ONLY_CONSULTATION' then 'local'
          when d.status = 'SUCCEEDED' and d.target_id is not null and d.target_number is not null then 'sent'
          when i.sync_status in ('FAILED', 'NEEDS_REVIEW') then 'failed'
          when d.invoice_id is not null and i.sync_status in ('PENDING', 'PROCESSING') then 'processing'
          when i.id is not null and d.invoice_id is null then 'simulation'
          else 'draft'
        end as category
      from scoped_batches b
      join import_rows r on r.batch_id = b.id and r.status <> 'DELETED'
      left join invoices i on i.id = coalesce(r.invoice_id, r.duplicate_invoice_id)
      left join accurate_deliveries d on d.invoice_id = i.id
    ), reference_ranks as (
      select batch_id, reference, row_number() over (partition by batch_id order by reference) as position
      from (select distinct batch_id, reference from classified) refs
    ), matching_batches as (
      select b.* from scoped_batches b
      ${query.status ? sql`where exists (select 1 from classified c where c.batch_id = b.id and c.category = ${query.status})` : sql``}
    ), paged as (
      select * from matching_batches order by created_at desc, id desc
      limit ${query.pageSize} offset ${(query.page - 1) * query.pageSize}
    )
    select
      (select count(*) from matching_batches) as total,
      (select JSON_OBJECT(
        'sent', count(distinct case when category = 'sent' then invoice_identity end),
        'draft', count(distinct case when category = 'draft' then invoice_identity end),
        'failed', count(distinct case when category = 'failed' then invoice_identity end),
        'redeem', count(distinct case when category = 'redeem' then invoice_identity end),
        'processing', count(distinct case when category = 'processing' then invoice_identity end)
      ) from classified) as summary,
      coalesce((select JSON_ARRAYAGG(entry) from (
        select JSON_OBJECT('id', p.id, 'status', p.status, 'branchId', p.branch_id, 'version', p.version,
          'createdAt', DATE_FORMAT(p.created_at, '%Y-%m-%dT%H:%i:%s.%fZ'),
          'invoiceCount', (select count(*) from classified c where c.batch_id = p.id),
          'references', (select coalesce(JSON_ARRAYAGG(reference), JSON_ARRAY())
            from reference_ranks refs where refs.batch_id = p.id and refs.position <= 3),
          'counts',
          (select JSON_OBJECT(
            'sent', count(distinct case when category = 'sent' then invoice_identity end),
            'draft', count(distinct case when category = 'draft' then invoice_identity end),
            'failed', count(distinct case when category = 'failed' then invoice_identity end),
            'redeem', count(distinct case when category = 'redeem' then invoice_identity end),
            'processing', count(distinct case when category = 'processing' then invoice_identity end),
            'simulation', count(distinct case when category = 'simulation' then invoice_identity end),
            'local', count(distinct case when category = 'local' then invoice_identity end)
          ) from classified c where c.batch_id = p.id)) as entry
        from paged p
      ) entry), JSON_ARRAY()) as items
  `);
  const overview = overviewResult.parse(Array.isArray(result) ? result[0] : undefined);
  overview.items.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  for (const item of overview.items) item.references.sort();
  return overview;
}

const count = z.number().int().nonnegative();
const counts = z.object({
  sent: count,
  draft: count,
  failed: count,
  redeem: count,
  processing: count,
});
const overviewResult: z.ZodType<ImportOverview> = z.object({
  total: z.coerce.number().int().nonnegative(),
  summary: counts,
  items: z.array(
    z.object({
      id: z.string(),
      status: z.string(),
      branchId: z.string(),
      version: count,
      createdAt: z.string(),
      invoiceCount: count,
      references: z.array(z.string()),
      counts: counts.extend({ simulation: count, local: count }),
    }),
  ),
});
