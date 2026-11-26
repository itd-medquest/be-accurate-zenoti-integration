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

test('distinct card and wrapped bank-transfer payments retain their own method and amount', () => {
  const pages = receipt(1800901, 198099, false);
  pages[0].tokens = pages[0].tokens.filter(
    (token) =>
      !['Custom (QRIS)', '24/10/2026', '1.999.000', 'Tax Based on Collection'].includes(
        token.text,
      ) || token.x < 300,
  );
  pages[0].tokens.push(
    { x: 312, y: 542, text: 'Mastercard' },
    { x: 312, y: 532, text: 'Mastercard(BCA)' },
    { x: 402, y: 532, text: '24/10/2026' },
    { x: 459, y: 532, text: '1.990.000' },
    { x: 312, y: 511, text: 'Custom' },
    { x: 350, y: 511, text: '( Bank' },
    { x: 312, y: 501, text: 'Transfer )' },
    { x: 402, y: 506, text: '24/10/2026' },
    { x: 459, y: 506, text: '9.000' },
    { x: 311, y: 485, text: 'Tax Based on Collection' },
  );
  const [candidate] = parsePdfPages(pages);
  assert.deepEqual(
    candidate.payments.map(({ method, amount }) => ({ method, amount })),
    [
      { method: 'card', amount: 1990000 },
      { method: 'bank', amount: 9000 },
    ],
  );
  assert.equal(new Set(candidate.payments.map((row) => row.id)).size, 2);
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

function detailedBenefits(
  subtotal: number,
  tax: number,
  discounts: string[],
  parent = 'Custom Package-TEST',
) {
  const page = receipt(subtotal, tax)[0];
  page.tokens = page.tokens.filter((token) => token.y > 350 || token.text.includes('InvId='));
  page.tokens = page.tokens.map((token) =>
    token.text === 'Glow Package-Test(1)' ? { ...token, text: parent + '(1)' } : token,
  );
  const cells: [number, number, string][] = [
    [51, 312, 'Benefit'],
    [92, 312, 'Type'],
    [125, 312, 'Price'],
    [156, 312, 'Discount'],
    [192, 307, 'benefits'],
  ];
  const names = ['Fractional IPL Shoot', 'Indiba Face Lifting Facial', 'Skin Brightening Facial'];
  const prices = ['4.504.505', '1.801.802', '2.252.250'];
  for (let index = 0; index < discounts.length; index++) {
    const y = 290 - index * 32;
    cells.push(
      [43, y + 9, names[index]],
      [88, y, 'Service'],
      [116, y, prices[index]],
      [154, y, discounts[index]],
      [204, y, index === 1 ? '1' : '5'],
    );
  }
  cells.push([45, 160, '-----']);
  page.tokens.push(...cells.map(([x, y, text]) => ({ x, y, text })));
  return page;
}

test('mixed nominal and percentage Benefit rows split all treatments, preserve nominal discount and reconcile Rp1', () => {
  const [c] = parsePdfPages([detailedBenefits(1981081, 217919, ['80%', '1.622.523', '60%'])]);
  assert.deepEqual(
    c.items.map((item) => item.name),
    ['Fractional IPL Shoot', 'Indiba Face Lifting Facial', 'Skin Brightening Facial'],
  );
  assert.deepEqual(
    c.items.map((item) => item.quantity),
    [5, 1, 5],
  );
  assert.deepEqual(
    c.items.map((item) => item.unitPrice),
    [900901, 1801802, 450450],
  );
  assert.equal(c.items[1].discount, 1622523);
  assert.equal(c.items[1].discountPercent, undefined);
  assert.equal(
    c.items.reduce((sum, item) => sum + item.unitPrice * item.quantity - item.discount, 0),
    1981081,
  );
  assert.equal(
    c.items.reduce((sum, item) => sum + item.tax, 0),
    217919,
  );
  assert.equal(c.packageParents?.length, 1);
  assert.ok(!c.items.some((item) => item.id === c.packageParents?.[0].id));
  assert.deepEqual(candidateErrors(c), []);
});

test('a Trial parent is recognized from a complete nominal Benefit table without a package keyword', () => {
  const page = detailedBenefits(179279, 19721, ['80%', '1.622.523'], 'Trial Special-TEST');
  page.tokens = page.tokens.filter((token) => !(token.y >= 280 && token.y < 300));
  const [c] = parsePdfPages([page]);
  assert.equal(c.items.length, 1);
  assert.equal(c.items[0].name, 'Indiba Face Lifting Facial');
  assert.equal(c.items[0].discount, 1622523);
  assert.equal(c.total, 199000);
  assert.deepEqual(candidateErrors(c), []);
});

test('an unreadable nominal row retains the parent and blocks partial treatment extraction', () => {
  const [c] = parsePdfPages([detailedBenefits(1981081, 217919, ['80%', 'unreadable', '60%'])]);
  assert.equal(c.items.length, 1);
  assert.match(c.items[0].name, /Custom Package/);
  assert.equal(c.packageParents?.length, 1);
  assert.ok(candidateErrors(c).some((error) => error.includes('Rincian tabel Benefit')));
});

test('nominal Benefit discounts outside their row price remain blocked', () => {
  const [c] = parsePdfPages([detailedBenefits(1981081, 217919, ['80%', '9.999.999', '60%'])]);
  assert.match(c.items[0].name, /Custom Package/);
  assert.ok(candidateErrors(c).length > 0);
});

for (const count of [2, 4, 8])
  test(`a complete nominal Benefit table extracts all ${count} rows without a fixed item count`, () => {
    const page = receipt(count * 900, count * 99)[0];
    page.tokens = page.tokens.filter((token) => token.y > 350 || token.text.includes('InvId='));
    const cells: [number, number, string][] = [
      [51, 312, 'Benefit'],
      [92, 312, 'Type'],
      [125, 312, 'Price'],
      [156, 312, 'Discount'],
      [192, 307, 'benefits'],
    ];
    for (let index = 0; index < count; index++) {
      const y = 290 - index * 24;
      cells.push(
        [43, y, 'Treatment ' + (index + 1)],
        [88, y, 'Service'],
        [116, y, '1.000'],
        [154, y, '100'],
        [204, y, index % 2 ? '2' : '1'],
      );
    }
    cells.push([45, 70, '-----']);
    page.tokens.push(...cells.map(([x, y, text]) => ({ x, y, text })));
    const [candidate] = parsePdfPages([page]);
    assert.equal(candidate.items.length, count);
    assert.equal(
      candidate.items.reduce(
        (sum, item) => sum + item.quantity * item.unitPrice - item.discount,
        0,
      ),
      count * 900,
    );
    assert.deepEqual(candidateErrors(candidate), []);
  });
