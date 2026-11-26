import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ocrReceiptPdf } from './helpers/ocr-receipt-fixture.js';
import { parsePdf, parsePdfPages } from '../src/utils/parsers/pdf.js';
import { candidateErrors, emptyCandidate } from '../src/utils/import-validation.js';

test(
  'image-only receipt uses local OCR, retains quantities, fractional units and exact source totals',
  { timeout: 120000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'imp-ocr-test-'));
    try {
      const path = join(dir, 'receipt.pdf');
      await writeFile(path, ocrReceiptPdf());
      const [c] = await parsePdf(path);
      assert.equal(c.extractionMethod, 'ocr');
      assert.equal(c.number, 'TEST-OCR-001');
      assert.equal(c.sourceIdentityKind, 'receipt_reference');
      assert.equal(c.total, 12000000);
      assert.equal(c.tax, 1189189);
      assert.equal(c.discount, 3603603);
      assert.equal(c.subtotal, 10810811);
      assert.equal(c.totalPaid, 12000000);
      assert.equal(c.items.length, 2);
      assert.equal(c.items[0].quantity, 4);
      assert.equal(c.items[0].unitPrice, 1801801.75);
      assert.equal(
        c.items.reduce((n, i) => n + i.discount, 0),
        3603603,
      );
      assert.equal(
        c.items.reduce((n, i) => n + i.tax, 0),
        1189189,
      );
      assert.equal(
        c.items.reduce((n, i) => n + i.quantity * i.unitPrice - i.discount + i.tax, 0),
        12000000,
      );
      assert.deepEqual(candidateErrors(c), []);
      assert.ok(c.warnings.some((w) => w.includes('OCR')));
      assert.ok(c.warnings.some((w) => w.includes('Diskon invoice')));
      const [again] = await parsePdf(path);
      assert.equal(again.sourceId, c.sourceId);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test('fractional unit price is accepted only when extended amounts remain whole rupiah', () => {
  const c = emptyCandidate('PDF');
  Object.assign(c, {
    sourceId: 'test',
    number: 'TEST-1',
    customer: 'Sample',
    customerId: 'sample',
    date: '2026-10-26',
    subtotal: 7207207,
    total: 7207207,
    outstanding: 7207207,
  });
  c.items = [
    {
      id: 'line',
      name: 'Sample',
      kind: 'service',
      quantity: 4,
      unitPrice: 1801801.75,
      discount: 0,
      tax: 0,
      mapped: true,
    },
  ];
  assert.deepEqual(candidateErrors(c), []);
  c.items[0].quantity = 3;
  assert.ok(candidateErrors(c).length > 0);
  c.items[0].quantity = 4;
  c.items[0].unitPrice = 1801801.7500001;
  assert.ok(candidateErrors(c).length > 0);
});

test(
  'raster benefit table extracts name, total price, percent and qty from grid cells',
  { timeout: 120000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'imp-ocr-benefits-'));
    try {
      const path = join(dir, 'benefits.pdf');
      await writeFile(path, ocrReceiptPdf(true));
      const [c] = await parsePdf(path);
      assert.equal(c.items.length, 1);
      assert.match(c.items[0].name, /Indiba.*Wrinkle.*Corrector.*Facial/);
      assert.equal(c.items[0].quantity, 5);
      assert.equal(c.items[0].unitPrice, 2702703);
      assert.equal(c.items[0].discountPercent, 45);
      assert.equal(c.tax, 817568);
      assert.equal(c.total, 8250000);
      assert.deepEqual(candidateErrors(c), []);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test(
  'raster Benefit tables accept an exact nominal discount without a percent token',
  { timeout: 120000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'imp-ocr-nominal-'));
    try {
      const path = join(dir, 'nominal.pdf');
      await writeFile(path, ocrReceiptPdf(true, true));
      const [candidate] = await parsePdf(path);
      assert.equal(candidate.items.length, 1);
      assert.equal(candidate.items[0].quantity, 5);
      assert.equal(candidate.items[0].discount, 6081083);
      assert.equal(candidate.items[0].discountPercent, undefined);
      assert.equal(candidate.total, 8250000);
      assert.deepEqual(candidateErrors(candidate), []);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
