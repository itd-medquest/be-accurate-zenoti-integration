import { createHmac } from 'node:crypto';
import { z } from 'zod';
import type {
  AccurateCredentials,
  AccurateCustomerPayload,
  AccurateInvoiceResult,
  AccurateMaster,
  AccuratePayload,
  AccurateProfile,
  MasterKind,
} from '../../types/accurate.types.js';
import { HttpError } from '../../utils/http-error.js';

const record = z.record(z.string(), z.unknown());
const envelope = z.object({
  s: z.boolean(),
  d: z.unknown().optional(),
  r: z.unknown().optional(),
  sp: z.unknown().optional(),
});
const text = (value: unknown) =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '';
const object = (value: unknown): Record<string, unknown> => record.safeParse(value).data ?? {};
const identifier = (value: unknown) => text(value).trim();
export class AccurateWriteUncertain extends HttpError {
  constructor(
    message = 'Hasil pengiriman belum pasti. Cari faktur di Accurate sebelum mencoba kembali.',
  ) {
    super(422, message);
  }
}

export function accurateHost(input: string) {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new HttpError(502, 'Host Accurate tidak valid.');
  }
  if (
    url.protocol !== 'https:' ||
    !url.hostname.endsWith('.accurate.id') ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    !['', '/', '/accurate', '/accurate/'].includes(url.pathname)
  )
    throw new HttpError(502, 'Host hasil koneksi harus merupakan HTTPS Accurate resmi.');
  return url.origin;
}
export class AccurateClient {
  constructor(private readonly credentials: AccurateCredentials) {}
  private redact(message: string) {
    let clean = message;
    for (const secret of [this.credentials.apiToken, this.credentials.signatureSecret])
      if (secret) clean = clean.split(secret).join('[disembunyikan]');
    return clean.replace(/aat\.[\w+/=.-]+/g, '[token disembunyikan]').slice(0, 700);
  }
  private async request(
    url: string,
    method: 'GET' | 'POST',
    payload?: AccuratePayload | AccurateCustomerPayload,
    format: 'form' | 'json' = 'form',
  ) {
    const timestamp = new Date().toISOString();
    const signature = createHmac('sha256', this.credentials.signatureSecret)
      .update(timestamp)
      .digest('base64');
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
        headers: {
          Authorization: `Bearer ${this.credentials.apiToken}`,
          'X-Api-Timestamp': timestamp,
          'X-Api-Signature': signature,
          ...(payload
            ? {
                'Content-Type':
                  format === 'json' ? 'application/json' : 'application/x-www-form-urlencoded',
              }
            : {}),
        },
        body: payload
          ? format === 'json'
            ? JSON.stringify(payload)
            : new URLSearchParams(
                Object.entries(payload).map(([key, value]) => [key, String(value)]),
              ).toString()
          : undefined,
      });
    } catch {
      if (method === 'POST' && payload) throw new AccurateWriteUncertain();
      throw new HttpError(502, 'Accurate tidak dapat dihubungi. Periksa koneksi dan coba kembali.');
    }
    const json: unknown = await response.json().catch(() => null);
    const parsed = envelope.safeParse(json);
    if (!response.ok || !parsed.success || !parsed.data.s) {
      if (method === 'POST' && payload && (response.status >= 500 || !parsed.success))
        throw new AccurateWriteUncertain();
      const detail = parsed.success ? parsed.data.d : undefined;
      const messages =
        typeof detail === 'string'
          ? detail
          : Array.isArray(detail)
            ? detail.filter((v): v is string => typeof v === 'string').join('; ')
            : '';
      throw new HttpError(
        response.status === 429 ? 429 : 422,
        this.redact(
          messages ||
            `Accurate menolak request (HTTP ${response.status}). Periksa token, hak akses, atau data yang dikirim.`,
        ),
      );
    }
    return parsed.data;
  }
  async profile(): Promise<AccurateProfile> {
    const response = await this.request('https://account.accurate.id/api/api-token.do', 'POST');
    const detail = object(response.d);
    const database = object(detail.database ?? detail['data usaha']);
    const id = identifier(database.id);
    if (!id || !database.host)
      throw new HttpError(502, 'Respons API Token belum memuat identitas database dan host.');
    return {
      id,
      name: text(database.alias ?? database.name ?? database.databaseName) || id,
      host: accurateHost(text(database.host)),
    };
  }
  private master(kind: MasterKind, data: unknown): AccurateMaster {
    const row = object(data);
    return {
      id: identifier(row.id),
      code: text(
        kind === 'customer' ? (row.customerNo ?? row.no) : kind === 'item' ? row.no : row.id,
      ),
      name: text(row.name),
      unitName: text(row.unit1Name ?? object(row.unit1).name),
      itemType: text(row.itemType),
      suspended: row.suspended === true,
    };
  }
  async masters(profile: AccurateProfile, kind: MasterKind, search: string, page = 1) {
    const url = new URL(`${profile.host}/accurate/api/${kind}/list.do`);
    url.searchParams.set('sp.page', String(page));
    url.searchParams.set('sp.pageSize', '20');
    url.searchParams.set(
      'fields',
      kind === 'customer'
        ? 'id,customerNo,name'
        : kind === 'item'
          ? 'id,no,name,itemType'
          : 'id,name',
    );
    if (search) {
      url.searchParams.set('filter.keywords.op', 'CONTAIN');
      url.searchParams.set('filter.keywords.val', search);
    }
    const response = await this.request(url.href, 'GET');
    if (!Array.isArray(response.d))
      throw new HttpError(502, 'Daftar master Accurate tidak dikenali.');
    return response.d
      .map((row) => this.master(kind, row))
      .filter((row) => row.id && row.code && !row.suspended);
  }
  async masterDetail(profile: AccurateProfile, kind: MasterKind, id: string) {
    const response = await this.request(
      `${profile.host}/accurate/api/${kind}/detail.do?id=${encodeURIComponent(id)}`,
      'GET',
    );
    const result = this.master(kind, response.d ?? response.r);
    if (!result.id || !result.code || !result.name || result.suspended)
      throw new HttpError(422, 'Master Accurate tidak tersedia atau dinonaktifkan.');
    return result;
  }
  async customerSetupList(
    profile: AccurateProfile,
    kind:
      'customer' | 'customer-category' | 'branch' | 'currency' | 'price-category' | 'payment-term',
    params: Record<string, string> = {},
  ) {
    const url = new URL(`${profile.host}/accurate/api/${kind}/list.do`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const paginated = kind !== 'payment-term';
    if (paginated) {
      url.searchParams.set('sp.pageSize', '100');
      url.searchParams.set('sp.sort', 'id|desc');
    }
    const result: Record<string, unknown>[] = [];
    let pages = 1;
    const seen = new Set<string>();
    for (let page = 1; page <= pages; page++) {
      if (paginated) url.searchParams.set('sp.page', String(page));
      // Keep setup pagination below the vendor's burst limit.
      await new Promise<void>((resolve) => setTimeout(resolve, 180));
      const response = await this.request(url.href, 'GET');
      if (!Array.isArray(response.d))
        throw new HttpError(502, `Daftar ${kind} Accurate tidak dikenali.`);
      if (paginated) {
        const count = object(response.sp).pageCount;
        // request() preserves pagination metadata from the vendor envelope.
        if (typeof count !== 'number' || !Number.isInteger(count) || count < 0 || count > 1000)
          throw new HttpError(
            422,
            'Metadata halaman Accurate tidak lengkap. Nomor customer belum dapat dipastikan.',
          );
        if (page === 1) pages = Math.max(1, count);
        else if (Math.max(1, count) !== pages)
          throw new HttpError(409, 'Daftar master Accurate berubah. Muat ulang form customer.');
        if ((count === 0 && response.d.length) || (page < pages && response.d.length !== 100))
          throw new HttpError(
            422,
            'Halaman master Accurate tidak lengkap. Muat ulang form customer.',
          );
      }
      for (const value of response.d) {
        const row = object(value);
        const id = identifier(row.id);
        if (!id || seen.has(id))
          throw new HttpError(422, 'Daftar master Accurate tidak lengkap atau berulang.');
        seen.add(id);
        result.push(row);
      }
    }
    return result;
  }
  async customerByNumber(profile: AccurateProfile, customerNo: string) {
    const rows = await this.customerSetupList(profile, 'customer', {
      'filter.no.op': 'EQUAL',
      'filter.no.val': customerNo,
      fields: 'id,customerNo,name',
    });
    const matches = rows.filter((row) => text(row.customerNo ?? row.no) === customerNo);
    if (matches.length > 1)
      throw new HttpError(422, 'Nomor customer Accurate tidak unik. Periksa di Accurate.');
    return matches.length
      ? this.masterDetail(profile, 'customer', identifier(matches[0].id))
      : undefined;
  }
  async saveCustomer(profile: AccurateProfile, payload: AccurateCustomerPayload) {
    let response: z.infer<typeof envelope>;
    try {
      response = await this.request(
        `${profile.host}/accurate/api/customer/save.do`,
        'POST',
        payload,
        'json',
      );
    } catch (error) {
      if (error instanceof AccurateWriteUncertain)
        throw new AccurateWriteUncertain(
          'Hasil pembuatan customer belum pasti. Periksa hasil sebelum mencoba kembali.',
        );
      throw error;
    }
    try {
      const id = identifier(object(response.r ?? response.d).id);
      const customer = id
        ? await this.masterDetail(profile, 'customer', id)
        : await this.customerByNumber(profile, payload.customerNo);
      if (!customer) throw new AccurateWriteUncertain();
      return customer;
    } catch {
      throw new AccurateWriteUncertain(
        'Customer dikirim tetapi belum dapat diverifikasi. Periksa hasil sebelum mencoba kembali.',
      );
    }
  }
  async findInvoice(
    profile: AccurateProfile,
    number: string,
  ): Promise<AccurateInvoiceResult | undefined> {
    const url = new URL(`${profile.host}/accurate/api/sales-invoice/list.do`);
    url.searchParams.set('filter.number.op', 'EQUAL');
    url.searchParams.set('filter.number.val', number);
    url.searchParams.set('fields', 'id,number');
    url.searchParams.set('sp.pageSize', '2');
    const response = await this.request(url.href, 'GET');
    if (!Array.isArray(response.d))
      throw new HttpError(502, 'Hasil pencarian faktur Accurate tidak dikenali.');
    const rows = response.d.filter((value) => text(object(value).number) === number);
    if (rows.length > 1)
      throw new HttpError(
        422,
        'Lebih dari satu faktur Accurate memiliki nomor yang sama. Periksa secara manual.',
      );
    if (!rows.length) return undefined;
    const id = identifier(object(rows[0]).id);
    if (!id) throw new HttpError(502, 'Pencarian faktur tidak mengembalikan ID.');
    return this.invoiceDetail(profile, id);
  }
  async invoiceDetail(profile: AccurateProfile, id: string): Promise<AccurateInvoiceResult> {
    const response = await this.request(
      `${profile.host}/accurate/api/sales-invoice/detail.do?id=${encodeURIComponent(id)}`,
      'GET',
    );
    const row = object(response.d ?? response.r);
    const customer = object(row.customer),
      branch = object(row.branch),
      currency = object(row.currency);
    const total = Number(row.totalAmount);
    if (
      !identifier(row.id) ||
      !text(row.number) ||
      row.totalAmount === null ||
      row.totalAmount === '' ||
      !Number.isFinite(total)
    )
      throw new AccurateWriteUncertain(
        'Detail faktur belum lengkap. Periksa faktur Accurate sebelum melanjutkan.',
      );
    return {
      id: identifier(row.id),
      number: text(row.number),
      customerNo: text(customer.customerNo ?? customer.no ?? row.customerNo),
      branchId: identifier(branch.id ?? row.branchId),
      total,
      approvalStatus: text(row.approvalStatus) || 'SAVED',
      currencyCode: text(currency.code ?? row.currencyCode),
      date: text(row.transDate),
    };
  }
  async saveInvoice(profile: AccurateProfile, payload: AccuratePayload) {
    const response = await this.request(
      `${profile.host}/accurate/api/sales-invoice/save.do`,
      'POST',
      payload,
    );
    const id = identifier(object(response.r ?? response.d).id);
    if (id) return this.invoiceDetail(profile, id);
    const found = await this.findInvoice(profile, payload.number);
    if (!found) throw new AccurateWriteUncertain();
    return found;
  }
}
