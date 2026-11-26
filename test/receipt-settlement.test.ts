import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  receiptStageNumber,
  receiptStageKey,
  settlementAmounts,
} from '../src/utils/receipt-settlement.js';
import { settlementAmounts as browserAmounts } from '../../frontend/src/features/easyrecap/receipts/lib/settlement.js';
import { parseReceiptRate } from '../../frontend/src/features/easyrecap/receipts/lib/rates.js';

test('percentage entry accepts Indonesian decimals and produces bounded integer basis points', () => {
  for (const [value, expected] of [
    ['1,8', 180],
    ['1.85', 185],
    ['0', 0],
    ['99,99', 9999],
    ['2', 200],
  ] as const)
    assert.equal(parseReceiptRate(value), expected);
  for (const value of ['', '-1', '100', '1,005', '1.005', '1e2', 'Rp 2', 'NaN', '2%'])
    assert.equal(parseReceiptRate(value), null);
});

test('receipt numbering preserves the base and extends past Z without reusing a stage identity', () => {
  for (const [sequence, expected] of [
    [0, 'R0088'],
    [1, 'R0088-A'],
    [3, 'R0088-C'],
    [26, 'R0088-Z'],
    [27, 'R0088-AA'],
    [52, 'R0088-AZ'],
    [53, 'R0088-BA'],
  ] as const)
    assert.equal(receiptStageNumber('R0088', sequence), expected);
  assert.notEqual(receiptStageKey('payment-1', 1), receiptStageKey('payment-1', 2));
  assert.notEqual(receiptStageKey('payment-1', 1), receiptStageKey('payment-2', 1));
  assert.throws(() => receiptStageNumber('x'.repeat(255), 1));
  assert.throws(() => receiptStageNumber('R', -1));
});

test('net input reconstructs gross once and gross input deducts the configured fee once', () => {
  const net = settlementAmounts({ remaining: 1000000, rateBps: 200, mode: 'NET', amount: 490000 });
  assert.deepEqual(net, { gross: 500000, rateBps: 200, fee: 10000, net: 490000 });
  assert.deepEqual(
    settlementAmounts({ remaining: 1000000, rateBps: 200, mode: 'GROSS', amount: 500000 }),
    net,
  );
  assert.deepEqual(settlementAmounts({ remaining: 9000, rateBps: 0, mode: 'NET', amount: 9000 }), {
    gross: 9000,
    rateBps: 0,
    fee: 0,
    net: 9000,
  });
});

test('partial receipts reconcile cumulative rupiah rounding and consume the final remainder', () => {
  const first = settlementAmounts({ remaining: 101, rateBps: 200, mode: 'NET', amount: 49 });
  assert.deepEqual(first, { gross: 50, rateBps: 200, fee: 1, net: 49 });
  const second = settlementAmounts({
    remaining: 51,
    priorGross: 50,
    priorFee: 1,
    rateBps: 200,
    mode: 'NET',
    amount: 49,
  });
  assert.deepEqual(second, { gross: 51, rateBps: 200, fee: 2, net: 49 });
  assert.equal(first.gross + second.gross, 101);
  assert.equal(first.fee + second.fee, 3);
});

test('all supported rates keep browser/server previews identical and totals conserved across stages', () => {
  for (const rateBps of [0, 70, 123, 180, 185, 200, 217]) {
    for (const total of [101, 999, 200001, 1990000, 2147483647]) {
      let priorGross = 0,
        priorFee = 0;
      for (const amount of [Math.floor(total / 3), Math.floor(total / 4)]) {
        const input = {
          remaining: total - priorGross,
          priorGross,
          priorFee,
          rateBps,
          mode: 'GROSS' as const,
          amount,
        };
        const result = settlementAmounts(input);
        assert.deepEqual(browserAmounts(input), result);
        const inverse = { ...input, mode: 'NET' as const, amount: result.net };
        assert.deepEqual(browserAmounts(inverse), settlementAmounts(inverse));
        assert.equal(settlementAmounts(inverse).net, amount - result.fee);
        priorGross += result.gross;
        priorFee += result.fee;
      }
      const last = settlementAmounts({
        remaining: total - priorGross,
        priorGross,
        priorFee,
        rateBps,
        mode: 'FULL',
      });
      assert.equal(priorGross + last.gross, total);
      assert.equal(priorFee + last.fee, Math.ceil((total * rateBps) / 10000));
    }
  }
});

test('invalid amounts and over-allocation fail rather than silently changing bank money', () => {
  for (const amount of [0, -1, 0.1, NaN, Infinity, 2147483648])
    assert.throws(() => settlementAmounts({ remaining: 100, rateBps: 200, mode: 'NET', amount }));
  assert.throws(() => settlementAmounts({ remaining: 100, rateBps: 200, mode: 'NET', amount: 99 }));
  assert.throws(() =>
    settlementAmounts({ remaining: 100, rateBps: 200, mode: 'GROSS', amount: 101 }),
  );
  assert.throws(() => settlementAmounts({ remaining: 0, rateBps: 0, mode: 'FULL' }));
});
