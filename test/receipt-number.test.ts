import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sourceReceiptNumber } from '../src/utils/receipt-number.js';
import { emptyCandidate } from '../src/utils/import-validation.js';

const payment = {
  id: 'source:receipt:MPA-R-R3902:1',
  method: 'qris' as const,
  amount: 150000,
  paidAt: '2026-11-10T00:00:00+07:00',
};

test('PDF receipt is read from existing payment identity and checked against source metadata', () => {
  assert.equal(sourceReceiptNumber([payment], []), 'MPA-R-R3902');
  const candidate = {
    ...emptyCandidate('PDF'),
    number: 'MPA-R-R3902',
    receiptNumber: 'MPA-R-R3902',
    sourceInvoiceNumber: 'MPA-R-4758',
    payments: [payment],
  };
  assert.equal(sourceReceiptNumber([payment], [candidate]), 'MPA-R-R3902');
  assert.throws(
    () => sourceReceiptNumber([payment], [{ ...candidate, receiptNumber: 'OTHER' }]),
    /tidak konsisten/,
  );
});

test('Sales Accrual allocations resolve the receipt from source entries', () => {
  const allocation = { ...payment, id: 'source:item:collection' };
  const entry = {
    row: 5,
    invoiceNumber: 'MPA-R-4758',
    receiptNumber: 'MPA-R-R3902',
    itemName: 'Service',
    quantity: 1,
    net: 150000,
    tax: 0,
    total: 150000,
  };
  const candidate = {
    ...emptyCandidate('XLSX'),
    number: 'MPA-R-4758',
    sourceEntries: [entry, { ...entry, row: 6 }],
    payments: [allocation],
  };
  assert.equal(sourceReceiptNumber([allocation], [candidate]), 'MPA-R-R3902');
  for (const receiptNumber of ['', 'OTHER'])
    assert.throws(
      () =>
        sourceReceiptNumber(
          [allocation],
          [{ ...candidate, sourceEntries: [entry, { ...entry, receiptNumber }] }],
        ),
      /tidak konsisten/,
    );
  assert.equal(sourceReceiptNumber([allocation], [{ ...candidate, payments: [] }]), null);
});

test('missing receipt never falls back to invoice number, payment ID, or an empty group', () => {
  const plain = { ...payment, id: 'PAY-1' };
  const candidate = { ...emptyCandidate('XLSX'), number: 'MPA-R-4758', payments: [plain] };
  assert.equal(sourceReceiptNumber([plain], [candidate]), null);
  assert.throws(() => sourceReceiptNumber([], []), /tidak konsisten/);
  assert.throws(
    () =>
      sourceReceiptNumber(
        [payment],
        [{ ...emptyCandidate('PDF'), receiptNumber: '', payments: [payment] }],
      ),
    /tidak konsisten/,
  );
});

test('empty and zero-only source receipt values are absent, while numbered receipts containing zero stay valid', () => {
  for (const value of ['', ' ', '0', ' 0 ', '000']) {
    const pdfPayment = { ...payment, id: `source:receipt:${value}:1` };
    assert.equal(
      sourceReceiptNumber(
        [pdfPayment],
        [{ ...emptyCandidate('PDF'), receiptNumber: value, payments: [pdfPayment] }],
      ),
      null,
    );
    assert.equal(sourceReceiptNumber([payment], []), 'MPA-R-R3902');
    const allocation = { ...payment, id: 'source:allocation:collection' };
    assert.equal(
      sourceReceiptNumber(
        [allocation],
        [{ ...emptyCandidate('XLSX'), receiptNumber: value, payments: [allocation] }],
      ),
      null,
    );
  }
  assert.equal(sourceReceiptNumber([{ ...payment, id: 'source:receipt:MPA-0:1' }], []), 'MPA-0');
});
