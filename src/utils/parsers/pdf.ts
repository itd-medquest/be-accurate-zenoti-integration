import { Worker } from 'node:worker_threads';
import type { ImportCandidate } from '../../types/import.types.js';
import { allocateTax, emptyCandidate } from '../import-validation.js';
import { calculatePackage } from '../package-calculation.js';
import { chargeableItems } from '../redemption.js';
export type PdfToken = { text: string; x: number; y: number; width?: number; confidence?: number };
export type PdfPage = {
  width: number;
  tokens: PdfToken[];
  extraction?: 'text' | 'ocr';
  confidence?: number;
  benefitRows?: { name: string; price: number; quantity: number; discountPercent: number }[];
  benefitTableDetected?: boolean;
  benefitTableComplete?: boolean;
};
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
export function rupiah(s: string) {
  const value = s.replace(/IDR|Rp\.?|\s/gi, '');
  if (!/^(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,00)?$/.test(value))
    throw new Error(`Format rupiah tidak dikenali: ${s.slice(0, 35)}`);
  return Number(value.replaceAll('.', '').replace(',00', ''));
}
function sourceDate(s: string) {
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) throw new Error('Tanggal PDF harus dd/mm/yyyy.');
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  if (new Date(iso).toISOString().slice(0, 10) !== iso) throw new Error('Tanggal PDF tidak valid.');
  return iso;
}
function rows(tokens: PdfToken[]) {
  const result: { y: number; tokens: PdfToken[] }[] = [];
  for (const token of [...tokens].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = result.find((r) => Math.abs(r.y - token.y) < 2.5);
    if (row) row.tokens.push(token);
    else result.push({ y: token.y, tokens: [token] });
  }
  return result.map((r) => ({ ...r, tokens: r.tokens.sort((a, b) => a.x - b.x) }));
}
function hasUsageBenefitTable(tokens: PdfToken[]) {
  return tokens
    .filter((token) => /\bBenefit\b/i.test(token.text))
    .some((header) => {
      const text = tokens
        .filter((token) => Math.abs(token.y - header.y) < 8)
        .map((token) => token.text)
        .join(' ');
      return /\bUsed\b/i.test(text) && /\bBalance\b/i.test(text);
    });
}
function allocateInvoiceItemTax(candidate: ImportCandidate) {
  const eligible = new Set(chargeableItems(candidate.items).map((item) => item.id));
  const taxes = allocateTax(
    candidate.items.map((item) =>
      eligible.has(item.id) ? item.unitPrice * item.quantity - item.discount : 0,
    ),
    candidate.tax,
  );
  candidate.items = candidate.items.map((item, index) => ({ ...item, tax: taxes[index] }));
}
function splitBenefitTable(
  c: ImportCandidate,
  entries: { name: string; price: number; quantity: number; discountPercent: number }[],
) {
  if (!entries.length || c.items.length !== 1 || !/package/i.test(c.items[0].name)) return false;
  const parent = { ...c.items[0], tax: c.tax };
  const nets = entries.map((i) => (i.price * (100 - i.discountPercent)) / 100);
  const taxes = allocateTax(nets, c.tax);
  const calculation = calculatePackage(
    entries.map((b, i) => ({
      name: b.name,
      quantity: b.quantity,
      discountPercent: b.discountPercent,
      unitPrice: b.price / b.quantity,
      tax: taxes[i],
    })),
    c.subtotal,
    c.tax,
  );
  if (!calculation) return false;
  c.benefits = entries.map((b) => ({
    ...b,
    unitPrice: b.price / b.quantity,
    netAmount: (b.price * (100 - b.discountPercent)) / 100,
  }));
  c.packageParents = [parent];
  c.packageName = parent.name;
  c.items = calculation.items.map((item, i) => ({
    ...item,
    id: parent.id + ':detail:' + (i + 1),
    kind: 'service',
    mapped: true,
  }));
  c.discount = c.items.reduce((n, i) => n + i.discount, 0);
  c.warnings.push(
    'Detail layanan dibaca dari tabel Benefit. Price merupakan total harga baris; harga unit = Price ÷ jumlah manfaat. Paket induk tidak dijumlahkan kembali.',
  );
  if (calculation.adjusted)
    c.warnings.push(
      'Diskon tabel paket dibulatkan ke rupiah dan selisih kecil direkonsiliasi ke subtotal invoice. Periksa alokasi; total sumber tidak diubah.',
    );
  if (!calculation.matches)
    c.warnings.push(
      'Tabel manfaat berhasil dibaca, tetapi jumlahnya berbeda dari tagihan sumber di luar selisih pembulatan. Periksa dan koreksi rincian sebelum submit.',
    );
  return true;
}
function parseGroup(pages: PdfPage[]): ImportCandidate {
  const c = emptyCandidate('PDF');
  const first = pages[0];
  const isOcr = pages.some((p) => p.extraction === 'ocr');
  c.extractionMethod = isOcr ? 'ocr' : 'text';
  if (isOcr) {
    c.ocrConfidence = Math.min(
      ...pages.filter((p) => p.extraction === 'ocr').map((p) => p.confidence ?? 0),
    );
    c.warnings.push(
      'Hasil OCR harus dicocokkan dengan dokumen sumber dan dikonfirmasi Accounting sebelum submit.',
    );
  }
  const tokens = first.tokens.map((t) => ({ ...t, text: clean(t.text) }));
  const all = pages
    .flatMap((p) => p.tokens)
    .map((t) => t.text)
    .join(' ');
  const header = tokens.find((t) => /ITEM\s*\(Qty\)/i.test(t.text));
  const subtotalLabel = tokens.find((t) => /^Sub\s*Total$/i.test(t.text));
  const price = tokens.find((t) => /^PRICE$/i.test(t.text));
  if (!header || !subtotalLabel || !price)
    throw new Error(
      'Layout receipt PDF belum dikenali. Periksa kualitas dokumen atau gunakan template Excel.',
    );
  const paymentHeader = tokens.find(
    (t) => /^Payment/i.test(t.text) && t.x > price.x && Math.abs(t.y - header.y) < 15,
  );
  const collectionHeader = tokens.find((t) => /Tax Based on Collection/i.test(t.text));
  const split = (paymentHeader?.x ?? collectionHeader?.x ?? price.x + (price.width ?? 30) + 4) - 2;
  const receipt = tokens.find((t) => /^Receipt No\.?$/i.test(t.text));
  c.number = clean(
    tokens
      .filter((t) => receipt && Math.abs(t.y - receipt.y) < 2.5 && t.x > receipt.x + 30)
      .map((t) => t.text)
      .join(' '),
  );
  c.receiptNumber = c.number;
  const invoiceLabel = tokens.find((t) => /^Invoice No\.?\s*:?/i.test(t.text));
  if (invoiceLabel) {
    const line = tokens
      .filter((t) => Math.abs(t.y - invoiceLabel.y) < 2.5 && t.x >= invoiceLabel.x)
      .sort((a, b) => a.x - b.x)
      .map((t) => t.text)
      .join(' ');
    const match = line.match(/^Invoice No\.?\s*:?\s*([A-Z0-9]+(?:[-/][A-Z0-9]+)+)\b/i);
    if (match) c.sourceInvoiceNumber = match[1];
  }
  c.sourceId =
    all
      .match(
        /InvId=([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})(?![a-f0-9])/i,
      )?.[1]
      ?.toLowerCase() ?? '';
  if (!c.sourceId && c.sourceInvoiceNumber) {
    c.sourceId = 'zenoti:invoice:' + c.sourceInvoiceNumber.toUpperCase();
    c.sourceIdentityKind = 'invoice_reference';
    c.warnings.push(
      'UUID terpotong. Identitas menggunakan nomor invoice dan cabang; awalan UUID tidak dianggap unik.',
    );
  }
  if (!c.sourceId && isOcr && /^[A-Z0-9]+(?:-[A-Z0-9]+)+$/.test(c.number)) {
    c.sourceId = 'zenoti:receipt:' + c.number;
    c.sourceIdentityKind = 'receipt_reference';
    c.warnings.push(
      'UUID invoice tidak tersedia lengkap. Referensi receipt digunakan untuk identitas simulasi; verifikasi nomor receipt dan cabang sebelum submit.',
    );
  }
  if (!c.sourceId)
    c.errors.push(
      'Zenoti invoice ID tidak ditemukan di PDF. Gunakan template dengan ID sumber yang terverifikasi.',
    );
  const date = tokens.find(
    (t) =>
      t.x > split &&
      /^\d{2}\/\d{2}\/\d{4}$/.test(t.text) &&
      t.y > header.y &&
      t.y < (receipt?.y ?? Infinity),
  );
  if (date) c.date = sourceDate(date.text);
  c.customer = clean(
    tokens
      .filter((t) => date && Math.abs(t.y - date.y) < 3 && t.x < split)
      .map((t) => t.text)
      .join(' '),
  );
  const patient = tokens.find((t) => /^Patient\s*ID\b/i.test(t.text));
  const patientLine = clean(
    tokens
      .filter((token) => patient && Math.abs(token.y - patient.y) < 3 && token.x >= patient.x)
      .sort((a, b) => a.x - b.x)
      .map((token) => token.text)
      .join(' '),
  );
  c.customerId = clean(patientLine.match(/^Patient\s*ID\s*:?\s*(.+)$/i)?.[1] ?? '');
  const summary = (label: RegExp, left: boolean) => {
    const token = tokens.find(
      (t) => label.test(t.text) && (left ? t.x <= subtotalLabel.x + 15 : t.x >= split),
    );
    if (!token) throw new Error(`Nilai ${label.source} tidak ditemukan.`);
    const value = tokens
      .filter(
        (t) => Math.abs(t.y - token.y) < 3 && t.x > token.x + 30 && (left ? t.x < split : true),
      )
      .find((t) => /^(?:IDR|Rp)/i.test(t.text));
    if (!value) throw new Error('Nilai ringkasan tidak terbaca lengkap.');
    return rupiah(isOcr ? value.text.replace(/\.(?=\d)/g, '') : value.text);
  };
  const rawSubtotal = summary(/^Sub\s*Total$/i, true);
  const headerDiscount = tokens.some(
    (t) =>
      /^Discounts?$/i.test(t.text) &&
      t.x <= subtotalLabel.x + 15 &&
      t.y < subtotalLabel.y &&
      t.y > subtotalLabel.y - 70,
  )
    ? summary(/^Discounts?$/i, true)
    : 0;
  c.sourceSubtotalBeforeDiscount = rawSubtotal;
  c.subtotal = rawSubtotal - headerDiscount;
  c.tax = summary(/^Tax$/i, true);
  c.total = summary(/^Total$/i, true);
  c.totalPaid = summary(/^Total Paid$/i, false);
  c.outstanding = c.total - c.totalPaid;
  const consultants = tokens.find((t) => /^CONSULTANT/i.test(t.text));
  const nameEnd = (consultants?.x ?? price.x - 30) - (isOcr ? 1 : 0);
  const body = tokens.filter((t) => t.y < header.y - 5 && t.y > subtotalLabel.y + 5);
  let nameParts: string[] = [];
  let prices: number[] = [];
  const itemRows = rows(body);
  for (let rowIndex = 0; rowIndex < itemRows.length; rowIndex++) {
    const row = itemRows[rowIndex];
    let note = clean(
      row.tokens
        .filter((t) => t.x < split)
        .map((t) => t.text)
        .join(' '),
    );
    let noteEnd = rowIndex;
    // Package usage annotations belong to the preceding billed line, never to the next name.
    if (/^Custom\s*Package\b/i.test(note) && !/\(\d+\)$/.test(note)) {
      while (
        !/\bRedeemed\s*[.!]?$/i.test(note) &&
        noteEnd + 1 < itemRows.length &&
        noteEnd - rowIndex < 5
      ) {
        const next = itemRows[noteEnd + 1];
        if (
          next.tokens.some(
            (t) => t.x >= price.x - 30 && t.x < split && /^(?:IDR)?[\d.]+(?:,00)?$/.test(t.text),
          )
        )
          break;
        const continuation = clean(
          next.tokens
            .filter((t) => t.x < split)
            .map((t) => t.text)
            .join(' '),
        );
        if (/\(\d+\)$/.test(continuation)) break;
        note += ' ' + continuation;
        noteEnd++;
      }
    }
    if (/\bRedeemed\s*[.!]?$/i.test(note)) {
      const previous = c.items.at(-1);
      if (!previous || nameParts.length || prices.length || previous.redeemed)
        c.errors.push(
          'Penanda Redeemed tidak dapat dipasangkan secara pasti ke item. Periksa dokumen sumber.',
        );
      else {
        previous.redeemed = true;
        previous.redemptionNote = note;
      }
      rowIndex = noteEnd;
      continue;
    }
    nameParts.push(...row.tokens.filter((t) => t.x < nameEnd).map((t) => t.text));
    prices.push(
      ...row.tokens
        .filter(
          (t) => t.x >= price.x - 30 && t.x < split && /^(?:IDR)?[\d.]+(?:,00)?$/.test(t.text),
        )
        .map((t) => rupiah(t.text)),
    );
    const joined = clean(nameParts.join(' '));
    const normalizedName = isOcr ? joined.replace(/\(([Il|])\)$/, '(1)') : joined;
    const qty = normalizedName.match(/\((\d+)\)$/);
    if (qty) {
      const quantity = Number(qty[1]);
      if (prices.length !== 1)
        throw new Error('Harga item PDF ambigu. Gunakan template Excel untuk detail item.');

      c.items.push({
        id: `${c.sourceId}:line:${c.items.length + 1}`,
        name: normalizedName
          .replace(/\(\d+\)$/, '')
          .replace(/-\s+/g, '-')
          .trim(),
        kind: 'service',
        quantity,
        unitPrice: prices[0],
        discount: 0,
        tax: 0,
        mapped: true,
      });
      nameParts = [];
      prices = [];
    }
  }
  if (isOcr && prices.length === 1 && nameParts.length) {
    const name = clean(nameParts.join(' '));
    c.items.push({
      id: c.sourceId + ':line:' + (c.items.length + 1),
      name,
      kind: 'service',
      quantity: 1,
      unitPrice: prices[0],
      discount: 0,
      tax: 0,
      mapped: true,
    });
    c.warnings.push(
      'OCR belum memastikan qty pada item ' +
        name +
        '. Qty sementara 1; cocokkan dengan PDF sebelum menyelesaikan pemeriksaan.',
    );
    nameParts = [];
    prices = [];
  }
  if (nameParts.length || prices.length)
    c.errors.push('Ada baris item PDF yang belum terbaca lengkap.');
  const printedSum = c.items.reduce((n, i) => n + i.unitPrice, 0);
  const unitSum = c.items.reduce((n, i) => n + i.unitPrice * i.quantity, 0);
  if (printedSum === rawSubtotal) {
    c.items = c.items.map((i) => ({ ...i, unitPrice: i.unitPrice / i.quantity }));
  } else if (unitSum !== rawSubtotal)
    c.errors.push('Jumlah harga item PDF tidak sama dengan subtotal sebelum diskon sumber.');
  if (headerDiscount) {
    const discounts = allocateTax(
      c.items.map((i) => (i.redeemed ? 0 : i.unitPrice * i.quantity)),
      headerDiscount,
    );
    c.items = c.items.map((item, i) => ({ ...item, discount: discounts[i] }));
    c.discount = headerDiscount;
    c.warnings.push(
      'Diskon invoice dialokasikan proporsional dalam rupiah bulat; periksa alokasi setiap item. Total diskon sumber tidak diubah.',
    );
  }
  const ocrTables = pages.filter((p) => p.benefitTableDetected && !hasUsageBenefitTable(p.tokens));
  const extractedBenefits = ocrTables.flatMap((p) => p.benefitRows ?? []);
  let automaticBenefits =
    ocrTables.length > 0 &&
    ocrTables.every((p) => p.benefitTableComplete) &&
    splitBenefitTable(c, extractedBenefits);
  const tablePage =
    pages.find(
      (p) => p.tokens.some((t) => /^Benefit$/i.test(t.text)) && !hasUsageBenefitTable(p.tokens),
    ) ?? first;
  const tableTokens = tablePage.tokens.map((t) => ({ ...t, text: clean(t.text) }));
  const usageTable = hasUsageBenefitTable(tableTokens);
  const benefitHeader = usageTable ? undefined : tableTokens.find((t) => /^Benefit$/i.test(t.text));
  const benefitPriceHeader = tableTokens.find(
    (t) => /^Price$/i.test(t.text) && benefitHeader && Math.abs(t.y - benefitHeader.y) < 8,
  );
  const benefitTypeHeader = tableTokens.find(
    (t) => /^Type$/i.test(t.text) && benefitHeader && Math.abs(t.y - benefitHeader.y) < 8,
  );
  const benefitDiscountHeader = tableTokens.find(
    (t) => /^Discount/i.test(t.text) && benefitHeader && Math.abs(t.y - benefitHeader.y) < 8,
  );
  const priceLeft =
    benefitTypeHeader && benefitPriceHeader
      ? (benefitTypeHeader.x + benefitPriceHeader.x) / 2
      : tablePage.width * 0.2;
  const priceRight = benefitDiscountHeader?.x ?? tablePage.width * 0.28;
  const nameRight = benefitTypeHeader ? benefitTypeHeader.x - 6 : tablePage.width * 0.15;
  if (benefitHeader && !automaticBenefits) {
    const benefitTokens = tableTokens.map((token) => {
      // PDF text extraction can merge the Type and Price cells into one token.
      const merged = token.text.match(/^(?:Service|Product)[\s(|]*(\d[\d.]*(?:,00)?)[|)]*$/i);
      return merged && token.x > tablePage.width * 0.1 && token.x < priceRight
        ? { ...token, text: merged[1], x: benefitPriceHeader?.x ?? tablePage.width * 0.22 }
        : token;
    });
    const benefitPrices = benefitTokens
      .filter(
        (t) =>
          t.y < benefitHeader.y && t.x > priceLeft && t.x < priceRight && /^\d[\d.]*$/.test(t.text),
      )
      .sort((a, b) => b.y - a.y);
    const footer = tableTokens
      .filter(
        (t) =>
          t.x < nameRight &&
          t.y < (benefitPrices.at(-1)?.y ?? 0) &&
          (/^-{3,}$/.test(t.text) || /^Thank\b/i.test(t.text)),
      )
      .sort((a, b) => b.y - a.y)[0];
    for (let i = 0; i < benefitPrices.length; i++) {
      const p = benefitPrices[i];
      const upper = i === 0 ? benefitHeader.y : (benefitPrices[i - 1].y + p.y) / 2;
      const lower =
        i === benefitPrices.length - 1
          ? Math.max(35, footer ? footer.y + 2 : 35)
          : (p.y + benefitPrices[i + 1].y) / 2;
      const name = clean(
        tableTokens
          .filter((t) => t.x > header.x && t.x < nameRight && t.y < upper && t.y > lower)
          .sort((a, b) => b.y - a.y)
          .map((t) => t.text)
          .join(' '),
      );
      const percent = tableTokens.find(
        (t) =>
          Math.abs(t.y - p.y) < 3 &&
          t.x > priceRight - 8 &&
          t.x < priceRight + 60 &&
          /^\d+(?:[.,]\d+)?%$/.test(t.text),
      );
      const quantityToken = tableTokens.find(
        (t) =>
          Math.abs(t.y - p.y) < 3 && t.x > priceRight + 30 && t.x < split && /^\d+$/.test(t.text),
      );
      if (!name || !percent || !quantityToken) {
        c.warnings.push(
          'Rincian manfaat paket belum terbaca lengkap; periksa atau isi detail paket.',
        );
        continue;
      }
      const unitPrice = rupiah(p.text);
      const discountPercent = Number(percent.text.replace('%', '').replace(',', '.'));
      const quantity = Number(quantityToken.text);
      const netAmount = (unitPrice * quantity * (100 - discountPercent)) / 100;
      if (!Number.isSafeInteger(netAmount) && !isOcr && !benefitTypeHeader)
        c.errors.push(
          'Diskon manfaat menghasilkan pecahan rupiah. Rounding perlu dikonfirmasi Accounting.',
        );
      c.benefits.push({ name, unitPrice, discountPercent, quantity, netAmount });
    }
    if (
      !isOcr &&
      benefitTypeHeader &&
      benefitPriceHeader &&
      benefitDiscountHeader &&
      c.benefits.length === benefitPrices.length
    ) {
      automaticBenefits = splitBenefitTable(
        c,
        c.benefits.map((b) => ({
          name: b.name,
          price: b.unitPrice,
          quantity: b.quantity,
          discountPercent: b.discountPercent,
        })),
      );
    }
    if (!automaticBenefits) {
      const packageMatched = c.items.length === 1 && /package/i.test(c.items[0]?.name ?? '');
      if (!packageMatched)
        c.errors.push('Manfaat paket tidak dapat dipasangkan secara pasti ke item utama.');
      if (
        c.benefits.length &&
        c.benefits.reduce((n, b) => n + b.netAmount, 0) === c.subtotal &&
        packageMatched
      ) {
        c.packageName = c.items[0].name;
        const taxes = allocateTax(
          c.benefits.map((b) => b.netAmount),
          c.tax,
        );
        c.items = c.benefits.map((b, i) => ({
          id: `${c.sourceId}:benefit:${i + 1}`,
          name: b.name,
          kind: 'service',
          quantity: b.quantity,
          unitPrice: b.unitPrice,
          discount: b.unitPrice * b.quantity - b.netAmount,
          discountPercent: b.discountPercent,
          tax: taxes[i],
          mapped: true,
        }));
        c.discount = c.items.reduce((n, i) => n + i.discount, 0);
        c.warnings.push(
          'Paket dipecah menjadi layanan setelah diskon. Paket induk tidak ikut dijumlahkan. Pajak dialokasikan proporsional berdasarkan nilai net layanan.',
        );
      } else {
        const benefitTotal = c.benefits.reduce((n, b) => n + b.netAmount, 0);
        if (isOcr && packageMatched) {
          c.warnings.push(
            'Rincian paket OCR memerlukan input layanan oleh Accounting. Jumlah manfaat tidak dipakai sebagai kuantitas tagihan secara otomatis.',
          );
        } else
          c.errors.push(
            `Jumlah manfaat paket setelah diskon (Rp${benefitTotal.toLocaleString('id-ID')}) tidak sama dengan subtotal tagihan (Rp${c.subtotal.toLocaleString('id-ID')}). Periksa rincian paket pada dokumen sumber.`,
          );
        // Keep the billed parent and its tax visible while the inconsistent benefits are held.
        allocateInvoiceItemTax(c);
        if (isOcr && packageMatched) c.packageParents = c.items.map((item) => ({ ...item }));
      }
    }
  } else if (!automaticBenefits) {
    allocateInvoiceItemTax(c);
    if (isOcr && c.items.some((item) => /package/i.test(item.name))) {
      c.packageParents = c.items
        .filter((item) => /package/i.test(item.name))
        .map((item) => ({ ...item }));
      c.warnings.push(
        'Rincian layanan paket belum tersedia dari OCR. Lengkapi detail paket sebelum submit.',
      );
    }
    if (c.items.length > 1 && c.tax)
      c.warnings.push(
        'PDF tidak mencantumkan pajak tiap item; alokasi proporsional harus diperiksa Accounting.',
      );
  }
  const paymentBoundary = tokens.find((t) => /Tax Based on Collection/i.test(t.text));
  for (const row of rows(
    tokens.filter((t) => t.y < header.y - 5 && t.y > (paymentBoundary?.y ?? subtotalLabel.y)),
  )) {
    const paidOn = row.tokens.find(
      (t) => /^\d{2}\/\d{2}\/\d{4}(?:\s+\d[\d.]*(?:,00)?)?$/.test(t.text) && t.x > split,
    );
    const amount = row.tokens.find((t) => t.x > split + 50 && /^(?:IDR)?\d[\d.]*$/.test(t.text));
    const mergedPayment = paidOn?.text.match(/^(\d{2}\/\d{2}\/\d{4})\s+(\d[\d.]*(?:,00)?)$/);
    const amountText = amount?.text ?? mergedPayment?.[2];
    if (!paidOn || !amountText) continue;
    const method = clean(
      row.tokens
        .filter((t) => t.x >= split && t.x < paidOn.x)
        .map((t) => t.text)
        .join(' '),
    );
    c.payments.push({
      id: `${c.sourceId}:receipt:${c.number}:${c.payments.length + 1}`,
      method: /QRIS/i.test(method)
        ? 'qris'
        : /cash/i.test(method)
          ? 'cash'
          : /card|visa|master|debit|credit/i.test(method)
            ? 'card'
            : 'other',
      amount: rupiah(amountText),
      paidAt: `${sourceDate(mergedPayment?.[1] ?? paidOn.text)}T00:00:00+07:00`,
    });
  }
  c.warnings.push(
    'Status Open/Closed tidak tercantum tegas pada PDF. Accounting harus memilih status sebelum submit.',
  );
  if (c.items.some((item) => item.redeemed))
    c.warnings.push(
      chargeableItems(c.items).length === 0 && c.total === 0
        ? 'Invoice full redeem: simpan di intgrte tanpa pengiriman ke Accurate. Nilai layanan sumber tetap disimpan sebagai referensi.'
        : 'Item Redeemed merupakan pemakaian benefit; tidak dihitung sebagai tagihan baru atau dikirim ke Accurate. Diskon dan pajak hanya dialokasikan ke item non-redeem.',
    );
  if (c.payments.length)
    c.warnings.push(
      'ID transaksi pembayaran asli tidak tersedia pada PDF. Referensi receipt dipakai hanya untuk alokasi draft simulasi; penerimaan Accurate live memerlukan verifikasi identitas pembayaran.',
    );
  if (isOcr && c.payments.some((payment) => payment.method === 'other'))
    c.warnings.push(
      'Metode pembayaran OCR belum teridentifikasi pasti. Periksa metode pada dokumen sumber.',
    );
  if (/\bDUPLICATE\b/.test(all))
    c.warnings.push(
      'PDF bertanda DUPLICATE (salinan receipt). Pemeriksaan duplikasi tetap berdasarkan invoice ID, bukan tulisan pada file.',
    );
  if (chargeableItems(c.items).length)
    c.warnings.push(
      'Periksa pemetaan customer, kode item, dan satuan sebelum pengiriman faktur ke Accurate. Pembayaran sumber belum dikirim sebagai Penerimaan Penjualan.',
    );
  return c;
}
export function parsePdfPages(pages: PdfPage[]) {
  const groups: PdfPage[][] = [];
  for (const page of pages) {
    if (page.tokens.some((t) => /^Receipt No\.?$/i.test(t.text))) groups.push([page]);
    else if (groups.length) groups[groups.length - 1].push(page);
  }
  if (!groups.length)
    throw new Error(
      'Receipt Zenoti belum dapat dikenali setelah pembacaan PDF. Periksa kualitas scan atau gunakan template Excel.',
    );
  return groups.map(parseGroup);
}
export async function parsePdf(path: string): Promise<ImportCandidate[]> {
  const pages = await new Promise<PdfPage[]>((resolve, reject) => {
    const worker = new Worker(new URL('../../../scripts/pdf-extract.mjs', import.meta.url), {
      workerData: { path },
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    let settled = false;
    let timer = setTimeout(() => {
      settled = true;
      void worker.terminate().then(() => reject(new Error('Pembacaan PDF melebihi 20 detik.')));
    }, 20000);
    let ocrStarted = false;
    worker.on('message', (message) => {
      if (settled) return;
      if (message.type === 'ocr') {
        if (!ocrStarted) {
          ocrStarted = true;
          clearTimeout(timer);
          timer = setTimeout(() => {
            settled = true;
            void worker
              .terminate()
              .then(() =>
                reject(
                  new Error(
                    'Pembacaan OCR melebihi 120 detik. Pisahkan PDF menjadi file lebih kecil.',
                  ),
                ),
              );
          }, 120000);
        }
        return;
      }
      settled = true;
      clearTimeout(timer);
      void worker
        .terminate()
        .then(() => (message.error ? reject(new Error(message.error)) : resolve(message.pages)));
    });
    worker.once('error', (e) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(e);
      }
    });
    worker.once('exit', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`Parser PDF berhenti (${code}).`));
      }
    });
  });
  return parsePdfPages(pages);
}
