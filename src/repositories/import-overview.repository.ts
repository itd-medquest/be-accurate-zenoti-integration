import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import type { ImportOverview } from '../types/import-overview.types.js';
import type { ImportOverviewQuery } from '../validations/import-overview.validation.js';

export async function overview(query: ImportOverviewQuery) {
  const term = '%' + query.search.replace(/[\\%_]/g, '\\$&') + '%';
  // Explicit calendar dates use inclusive WIB days, independently of the server timezone.
  // Retain the previous rolling-period query for existing clients.
  const since = query.dateFrom
    ? new Date(`${query.dateFrom}T00:00:00+07:00`).toISOString()
    : !query.dateTo && query.days
      ? new Date(Date.now() - query.days * 86400000).toISOString()
      : null;
  const until = query.dateTo
    ? new Date(new Date(`${query.dateTo}T00:00:00+07:00`).getTime() + 86400000).toISOString()
    : null;
  // One statement gives the page and aggregate counts the same database snapshot.
  // SYNCED without a live delivery is a simulation, never a verified Accurate success.
  const result = await db.execute<ImportOverview>(sql`
    with scoped_batches as (
      select b.* from import_batches b
      where b.status not in ('DELETED', 'ARCHIVED')
        ${query.branch ? sql`and b.branch_id = ${query.branch}` : sql``}
        ${since ? sql`and b.created_at >= ${since}::timestamptz` : sql``}
        ${until ? sql`and b.created_at < ${until}::timestamptz` : sql``}
        ${
          query.search
            ? sql`and (
          b.id ilike ${term} or exists (
            select 1 from import_rows r join import_files f on f.id = r.file_id
            where r.batch_id = b.id and r.status <> 'DELETED'
              and (r.candidate->>'number' ilike ${term}
                or r.candidate->>'sourceInvoiceNumber' ilike ${term}
                or r.candidate->>'customer' ilike ${term}
                or f.name ilike ${term})
          )
        )`
            : sql``
        }
    ), classified as (
      select b.id as batch_id, r.id,
        coalesce(i.id, b.branch_id || ':' || coalesce(nullif(r.candidate->>'sourceId', ''), r.id)) as identity,
        coalesce(nullif(r.candidate->>'sourceInvoiceNumber', ''), nullif(r.candidate->>'number', ''), 'Belum terbaca') as reference,
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
    ), matching_batches as (
      select b.* from scoped_batches b
      ${query.status ? sql`where exists (select 1 from classified c where c.batch_id = b.id and c.category = ${query.status})` : sql``}
    ), paged as (
      select * from matching_batches order by created_at desc, id desc
      limit ${query.pageSize} offset ${(query.page - 1) * query.pageSize}
    )
    select
      (select count(*)::int from matching_batches) as total,
      (select json_build_object(
        'sent', count(distinct identity) filter (where category = 'sent'),
        'draft', count(distinct identity) filter (where category = 'draft'),
        'failed', count(distinct identity) filter (where category = 'failed'),
        'redeem', count(distinct identity) filter (where category = 'redeem'),
        'processing', count(distinct identity) filter (where category = 'processing')
      ) from classified) as summary,
      coalesce((select json_agg(entry order by "createdAt" desc, id desc) from (
        select p.id, p.status, p.branch_id as "branchId", p.version, p.created_at as "createdAt",
          (select count(*)::int from classified c where c.batch_id = p.id) as "invoiceCount",
          (select coalesce(json_agg(reference), '[]'::json) from (
            select distinct reference from classified c where c.batch_id = p.id order by reference limit 3
          ) refs) as "references",
          (select json_build_object(
            'sent', count(distinct identity) filter (where category = 'sent'),
            'draft', count(distinct identity) filter (where category = 'draft'),
            'failed', count(distinct identity) filter (where category = 'failed'),
            'redeem', count(distinct identity) filter (where category = 'redeem'),
            'processing', count(distinct identity) filter (where category = 'processing'),
            'simulation', count(distinct identity) filter (where category = 'simulation'),
            'local', count(distinct identity) filter (where category = 'local')
          ) from classified c where c.batch_id = p.id) as counts
        from paged p
      ) entry), '[]'::json) as items
  `);
  return result.rows[0];
}
