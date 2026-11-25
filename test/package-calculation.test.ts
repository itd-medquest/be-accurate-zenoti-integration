import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculatePackage,
  calculateItemCorrection,
  lineTaxPercent,
} from '../src/utils/package-calculation.js';
import {
  calculatePackage as browserCalculate,
  calculateItemCorrection as browserCorrect,
} from '../../frontend/src/features/easyrecap/invoices/utils/package-calculation.js';

test('manual percentage calculations stay finite for arbitrary integer prices and keep FE/BE equal', () => {
  for (const price of [2382321, 13513515, 1, 0, 2702703]) {
    const lines = [
      { name: 'Sample', quantity: 5, unitPrice: price, discountPercent: 45, taxPercent: 11 },
    ];
    const result = calculatePackage(lines, 7432432, 817568)!;
    assert.ok(result);
    assert.ok(Number.isFinite(result.net));
    assert.ok(Number.isFinite(result.tax));
    assert.deepEqual(result, browserCalculate(lines, 7432432, 817568));
  }
});
test('package percentages reconcile only small rounding differences to exact source totals', () => {
  const lines = [
    { name: 'Sample', quantity: 5, unitPrice: 2702703, discountPercent: 45, taxPercent: 11 },
  ];
  const result = calculatePackage(lines, 7432432, 817568)!;
  assert.equal(result.matches, true);
  assert.equal(result.net + result.tax, 8250000);
  assert.equal(result.items[0].discountPercent, 45);
  assert.equal(result.items[0].discount, 6081083);
  assert.equal(result.items[0].discountRoundingAdjustment, 1);
  assert.equal(result.items[0].tax, 817568);
  assert.equal(result.adjusted, true);
  assert.equal(calculatePackage(lines, 7430000, 817568)!.matches, false);
  assert.equal(
    calculatePackage([{ ...lines[0], discountPercent: 45.1234567 }], 7432432, 817568),
    null,
  );
  assert.equal(calculatePackage([{ ...lines[0], unitPrice: NaN }], 7432432, 817568), null);
});
test('free benefits retain zero net and zero tax and legacy nominal tax is never adjusted', () => {
  const result = calculatePackage(
    [
      { name: 'Paid', quantity: 6, unitPrice: 2702703, discountPercent: 50, taxPercent: 11 },
      { name: 'Free', quantity: 1, unitPrice: 360360, discountPercent: 100, taxPercent: 11 },
    ],
    8108108,
    891892,
  )!;
  assert.equal(result.matches, true);
  assert.equal(result.items[1].discount, 360360);
  assert.equal(result.items[1].tax, 0);
  assert.equal(
    calculatePackage(
      [{ name: 'Sample', quantity: 1, unitPrice: 100, discountPercent: 0, tax: 12 }],
      100,
      11,
    )!.matches,
    false,
  );
});

test('item edits round fractional percentage discounts and tax consistently in FE and BE', () => {
  const original = { quantity: 1, unitPrice: 8392321, discount: 0, tax: 646209 };
  assert.equal(lineTaxPercent(original), 7.7);
  for (const discountPercent of [0, 5, 12.5, 100]) {
    const input = { quantity: 1, unitPrice: 8392321, discountPercent, taxPercent: 11 };
    const result = calculateItemCorrection(original, input)!;
    assert.ok(result);
    assert.deepEqual(result, browserCorrect(original, input));
    assert.equal(result.discount, Math.round((8392321 * discountPercent) / 100));
    assert.equal(result.tax, Math.round(((8392321 - result.discount) * 11) / 100));
  }
  const example = calculateItemCorrection(original, {
    quantity: 1,
    unitPrice: 8392321,
    discountPercent: 5,
    taxPercent: 11,
  })!;
  assert.equal(example.discount, 419616);
  assert.equal(example.discountRoundingAdjustment, 0);
  assert.equal(example.tax, 876998);
  assert.equal(example.unitPrice - example.discount + example.tax, 8849703);
  for (const invalid of [NaN, -1, 101, 5.1234567]) {
    assert.equal(
      calculateItemCorrection(original, {
        quantity: 1,
        unitPrice: 8392321,
        discountPercent: invalid,
        taxPercent: 11,
      }),
      null,
    );
    assert.equal(
      calculateItemCorrection(original, { quantity: 1, unitPrice: 8392321, taxPercent: invalid }),
      null,
    );
  }
});

test('untouched edit rates preserve source allocations and rounded package metadata exactly', () => {
  const allocated = { quantity: 1, unitPrice: 450450, discount: 300450, tax: 14865 };
  const preserved = calculateItemCorrection(allocated, { quantity: 1, unitPrice: 450450 })!;
  assert.equal(preserved.discount, 300450);
  assert.equal(preserved.discountPercent, undefined);
  assert.equal(preserved.tax, 14865);
  assert.equal(preserved.taxPercent, undefined);
  const packageItem = {
    quantity: 5,
    unitPrice: 2702703,
    discount: 6081083,
    discountPercent: 45,
    discountRoundingAdjustment: 1,
    tax: 817568,
    taxPercent: 11,
    taxRoundingAdjustment: 0,
  };
  assert.deepEqual(
    calculateItemCorrection(packageItem, { quantity: 5, unitPrice: 2702703 }),
    packageItem,
  );
  assert.equal(calculateItemCorrection(allocated, { quantity: 1, unitPrice: 500450 }), null);
  assert.equal(
    calculateItemCorrection(allocated, { quantity: 1, unitPrice: 450450, discountPercent: 5 }),
    null,
  );
  assert.equal(
    calculateItemCorrection(allocated, { quantity: 1, unitPrice: 450450, tax: 11, taxPercent: 11 }),
    null,
  );
});

test('nominal item corrections are exact and FE/BE agree without persisting an approximate percentage', () => {
  const original = { quantity: 1, unitPrice: 1801802, discount: 0, tax: 19721 };
  const input = { quantity: 1, unitPrice: 1801802, discountAmount: 1622523, taxPercent: 11 };
  const result = calculateItemCorrection(original, input)!;
  assert.equal(result.discount, 1622523);
  assert.equal(result.discountPercent, undefined);
  assert.equal(result.tax, 19721);
  assert.deepEqual(result, browserCorrect(original, input));
  assert.equal(calculateItemCorrection(original, { ...input, discountPercent: 90 }), null);
  assert.equal(calculateItemCorrection(original, { ...input, discountAmount: 1801803 }), null);
});

test('nominal source discounts are locked while percentage rows absorb bounded rounding', () => {
  const lines = [
    { name: 'A', quantity: 5, unitPrice: 900901, discountPercent: 80, taxPercent: 11 },
    { name: 'B', quantity: 1, unitPrice: 1801802, discountAmount: 1622523, taxPercent: 11 },
    { name: 'C', quantity: 5, unitPrice: 450450, discountPercent: 60, taxPercent: 11 },
  ];
  const result = calculatePackage(lines, 1981081, 217919)!;
  assert.equal(result.matches, true);
  assert.equal(result.items[1].discount, 1622523);
  assert.deepEqual(result, browserCalculate(lines, 1981081, 217919));
  const onlyNominal = [{ name: 'A', quantity: 1, unitPrice: 1000, discountAmount: 100, tax: 0 }];
  assert.equal(calculatePackage(onlyNominal, 901, 0)?.matches, false);
  assert.equal(calculatePackage(onlyNominal, 900, 0)?.matches, true);
});
