import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePdfPages, type PdfToken } from '../src/utils/parsers/pdf.js';
import { candidateErrors } from '../src/utils/import-validation.js';
import { redemptionPages } from './helpers/redemption-fixture.js';

test('merged usage-table headers and Patient ID retain the full tax on the paid service', () => {
  for (const extraction of ['text', 'ocr'] as const) {
    const pages = redemptionPages(false, 'MERGED-HEADER-TEST', {
      mergedUsageHeader: true,
      mergedPatientId: true,
    });
    pages[0].extraction = extraction;
    const [candidate] = parsePdfPages(pages);
    assert.equal(candidate.customerId, 'TEST001');
    assert.deepEqual(
      candidate.items.map((item) => item.tax),
      [0, 14865, 0],
    );
    assert.equal(
      candidate.items[1].quantity * candidate.items[1].unitPrice -
        candidate.items[1].discount +
        candidate.items[1].tax,
      150000,
    );
    assert.deepEqual(candidate.benefits, []);
    assert.equal(candidate.packageParents, undefined);
    assert.deepEqual(candidateErrors(candidate), []);
    assert.equal(
      candidate.warnings.some((warning) => warning.includes('manfaat paket belum terbaca')),
      false,
    );
  }
});

test('unrecognized benefit headers may block review but never allocate sale tax to redeemed items', () => {
  const pages = redemptionPages(false);
  pages[0].tokens = pages[0].tokens.filter(
    (token) => !['Used', 'Refunded', 'Balance'].includes(token.text),
  );
  const [candidate] = parsePdfPages(pages);
  assert.deepEqual(
    candidate.items.map((item) => item.tax),
    [0, 14865, 0],
  );
  assert.ok(candidateErrors(candidate).some((error) => error.includes('manfaat paket')));
});

function receipt(subtotal = 245000, tax = 26950, merged = true) {
  const total = subtotal + tax;
  const rp = (value: number) => new Intl.NumberFormat('id-ID').format(value);
  const cells: [number, number, string][] = [
    [197, 655, 'Receipt No.'],
    [257, 655, 'TEST-GLOW'],
    [31, 597, 'Test Customer'],
    [444, 597, '24/10/2026'],
    [404, 580, 'Patient ID'],
    [456, 580, 'TEST001'],
    [34, 555, 'ITEM(Qty)'],
    [140, 555, 'CONSULTANT(S)'],
    [261, 555, 'PRICE'],
    [34, 535, 'Glow Package-Test(1)'],
    [260, 535, rp(subtotal)],
    [34, 493, 'Sub Total'],
    [238, 492, `IDR${rp(subtotal)}`],
    [34, 477, 'Tax'],
    [244, 477, `IDR${rp(tax)}`],
    [34, 461, 'Total'],
    [238, 461, `IDR${rp(total)}`],
    [314, 439, 'Total Paid'],
    [433, 439, `IDR${rp(total)}`],
    [312, 532, 'Custom (QRIS)'],
    [311, 502, 'Tax Based on Collection'],
    [52, 164, 'Benefit'],
    [139, 164, 'Price'],
    [48, 142, 'Oxygen Glow'],
    [55, 115, 'Facial'],
    [184, 128, '65%'],
    [235, 128, '1'],
    [48, 99, 'Deep Tissue'],
    [49, 72, 'Massage'],
    [50, 45, '45 Minutes'],
    [184, 72, '60%'],
    [235, 72, '2'],
    [24, 16, 'https://example.test/?InvId=11111111-1111-4111-8111-111111111111'],
    ...(merged
      ? ([
          [94, 128, 'Service 520.000'],
          [94, 72, 'Service 210.000'],
          [402, 532, `24/10/2026 ${rp(total)}`],
        ] as [number, number, string][])
      : ([
          [132, 128, '520.000'],
          [132, 72, '210.000'],
          [402, 532, '24/10/2026'],
          [459, 532, rp(total)],
        ] as [number, number, string][])),
  ];
  return [{ width: 612, tokens: cells.map(([x, y, text]): PdfToken => ({ x, y, text })) }];
}

test('merged benefit and payment cells retain billed tax and flag inconsistent package totals', () => {
  const [c] = parsePdfPages(receipt());
  assert.equal(c.subtotal, 245000);
  assert.equal(c.tax, 26950);
  assert.equal(c.total, 271950);
  assert.equal(c.items[0].tax, 26950);
  assert.equal(
    c.items.reduce((n, i) => n + i.quantity * i.unitPrice - i.discount + i.tax, 0),
    271950,
  );
  assert.equal(
    c.benefits.reduce((n, b) => n + b.netAmount, 0),
    350000,
  );
  assert.ok(candidateErrors(c).some((e) => e.includes('manfaat paket')));
  assert.equal(c.payments[0].amount, 271950);
  assert.equal(c.payments[0].method, 'qris');
  assert.equal(c.outstanding, 0);
});

test('consistent named package splits services and preserves exact tax across merged or separate cells', () => {
  for (const merged of [true, false]) {
    const [c] = parsePdfPages(receipt(350000, 38500, merged));
    assert.deepEqual(candidateErrors(c), []);
    assert.equal(c.items.length, 2);
    assert.deepEqual(
      c.items.map((i) => i.discountPercent),
      [65, 60],
    );
    assert.equal(
      c.items.reduce((n, i) => n + i.tax, 0),
      38500,
    );
    assert.equal(
      c.items.reduce((n, i) => n + i.quantity * i.unitPrice - i.discount + i.tax, 0),
      388500,
    );
    assert.equal(c.payments[0].amount, 388500);
  }
});

test('unreadable benefit prices keep source tax visible and block submission', () => {
  const pages = receipt();
  pages[0].tokens = pages[0].tokens.filter((t) => !t.text.startsWith('Service '));
  const [c] = parsePdfPages(pages);
  assert.equal(c.items[0].tax, 26950);
  assert.ok(candidateErrors(c).length > 0);
});

test('OCR package manual breakdown retains the billed parent tax as its editable target', () => {
  const [c] = parsePdfPages(
    receipt().map((p) => ({ ...p, extraction: 'ocr' as const, confidence: 85 })),
  );
  assert.equal(c.packageParents?.length, 1);
  assert.equal(c.packageParents![0].tax, 26950);
  assert.equal(c.items[0].tax, c.packageParents![0].tax);
  assert.equal(
    c.packageParents![0].quantity * c.packageParents![0].unitPrice -
      c.packageParents![0].discount +
      c.packageParents![0].tax,
    271950,
  );
});

test('native benefit table uses total Price divided by benefit qty, including a second-page table', () => {
  for (const secondPage of [false, true]) {
    const first = receipt(7432432, 817568)[0];
    const table: PdfToken[] = [
      [48, 164, 'Benefit'],
      [87, 164, 'Type'],
      [125, 164, 'Price'],
      [158, 164, 'Discount'],
      [204, 164, 'benefits'],
      [48, 140, 'Indiba Wrinkle'],
      [48, 128, 'Corrector Facial'],
      [87, 128, 'Service'],
      [114, 128, '13.513.515'],
      [167, 128, '45%'],
      [208, 128, '5'],
      [48, 90, '-----'],
      [48, 70, 'Thank you'],
    ].map(([x, y, text]) => ({ x: Number(x), y: Number(y), text: String(text) }));
    first.tokens = first.tokens.filter((t) => t.y > 200 || t.text.includes('InvId='));
    const pages = secondPage
      ? [first, { width: 612, tokens: table }]
      : [{ ...first, tokens: [...first.tokens, ...table] }];
    const [c] = parsePdfPages(pages);
    assert.equal(c.items[0].name, 'Indiba Wrinkle Corrector Facial');
    assert.equal(c.items.length, 1);
    assert.equal(c.items[0].quantity, 5);
    assert.equal(c.items[0].unitPrice, 2702703);
    assert.equal(c.items[0].discountPercent, 45);
    assert.equal(c.items[0].discountRoundingAdjustment, 1);
    assert.equal(c.total, 8250000);
    assert.deepEqual(candidateErrors(c), []);
  }
});

test('OCR benefit cells become service lines automatically and large source mismatches remain blocked', () => {
  const page = receipt(7432432, 817568)[0];
  const rows = [{ name: 'Sample facial', price: 13513515, quantity: 5, discountPercent: 45 }];
  const [c] = parsePdfPages([
    {
      ...page,
      extraction: 'ocr',
      benefitRows: rows,
      benefitTableDetected: true,
      benefitTableComplete: true,
    },
  ]);
  assert.equal(c.items[0].quantity, 5);
  assert.equal(c.items[0].unitPrice, 2702703);
  assert.equal(c.items[0].tax, 817568);
  assert.deepEqual(candidateErrors(c), []);
  const mismatch = receipt(7400000, 814000)[0];
  const [held] = parsePdfPages([
    {
      ...mismatch,
      extraction: 'ocr',
      benefitRows: rows,
      benefitTableDetected: true,
      benefitTableComplete: true,
    },
  ]);
  assert.equal(held.items[0].name, 'Sample facial');
  assert.ok(candidateErrors(held).some((e) => e.includes('Jumlah item')));
  const [incomplete] = parsePdfPages([
    {
      ...page,
      extraction: 'ocr',
      benefitRows: rows,
      benefitTableDetected: true,
      benefitTableComplete: false,
    },
  ]);
  assert.equal(incomplete.items[0].quantity, 1);
  assert.equal(incomplete.packageParents?.length, 1);
});
