import { percentageDiscountAmount, validUnitPrice } from './discount.js';

export type CorrectableItem = {
  quantity: number;
  unitPrice: number;
  discount: number;
  discountPercent?: number;
  discountRoundingAdjustment?: number;
  tax: number;
  taxPercent?: number;
  taxRoundingAdjustment?: number;
};
export type ItemCorrectionInput = {
  quantity: number;
  unitPrice: number;
  discountPercent?: number;
  taxPercent?: number;
  tax?: number;
};

// Recalculate only explicitly edited rates; preserve exact allocated source amounts otherwise.
export function calculateItemCorrection(original: CorrectableItem, input: ItemCorrectionInput) {
  const base = input.quantity * input.unitPrice;
  if (
    !Number.isFinite(input.quantity) ||
    input.quantity <= 0 ||
    input.quantity > 10000 ||
    !validUnitPrice(input.unitPrice) ||
    !Number.isSafeInteger(base) ||
    base > 2147483647 ||
    (input.discountPercent === undefined &&
      (input.quantity !== original.quantity || input.unitPrice !== original.unitPrice)) ||
    (input.tax !== undefined && input.taxPercent !== undefined)
  )
    return null;
  const discount =
    input.discountPercent === undefined
      ? original.discount
      : roundedPercentageAmount(base, input.discountPercent);
  const net = base - discount;
  const originalNet = original.quantity * original.unitPrice - original.discount;
  if (net !== originalNet && input.tax === undefined && input.taxPercent === undefined) return null;
  const tax =
    input.taxPercent !== undefined
      ? roundedPercentageAmount(net, input.taxPercent)
      : (input.tax ?? original.tax);
  if (
    !Number.isSafeInteger(discount) ||
    discount < 0 ||
    discount > base ||
    !Number.isSafeInteger(tax) ||
    tax < 0 ||
    net + tax > 2147483647
  )
    return null;
  const preserveTax = input.taxPercent === undefined && tax === original.tax && net === originalNet;
  return {
    quantity: input.quantity,
    unitPrice: input.unitPrice,
    discount,
    discountPercent: input.discountPercent ?? original.discountPercent,
    discountRoundingAdjustment:
      input.discountPercent === undefined
        ? original.discountRoundingAdjustment
        : percentageDiscountAmount(base, input.discountPercent) === discount
          ? undefined
          : 0,
    tax,
    taxPercent: input.taxPercent ?? (preserveTax ? original.taxPercent : undefined),
    taxRoundingAdjustment:
      input.taxPercent !== undefined ? 0 : preserveTax ? original.taxRoundingAdjustment : undefined,
  };
}

export function lineTaxPercent(item: CorrectableItem) {
  if (item.taxPercent !== undefined) return item.taxPercent;
  const net = item.quantity * item.unitPrice - item.discount;
  if (net <= 0) return 0;
  const rate = (item.tax / net) * 100;
  const short = Number(rate.toFixed(2));
  return Math.abs(roundedPercentageAmount(net, short) - item.tax) <= 2
    ? short
    : Number(rate.toFixed(6));
}

export type PackageInput = {
  name: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  taxPercent?: number;
  tax?: number;
};
const SCALE = 100000000n;
export function calculateNewItem(input: PackageInput) {
  const base = input.quantity * input.unitPrice;
  const discount = roundedPercentageAmount(base, input.discountPercent);
  const net = base - discount;
  const tax =
    input.taxPercent === undefined ? input.tax! : roundedPercentageAmount(net, input.taxPercent);
  const result = calculatePackage([input], net, tax);
  return result?.matches && net + tax <= 2147483647 ? result : null;
}
function percentUnits(percent: number) {
  if (
    !Number.isFinite(percent) ||
    percent < 0 ||
    percent > 100 ||
    Number(percent.toFixed(6)) !== percent
  )
    return null;
  return BigInt(percent.toFixed(6).replace('.', ''));
}
export function roundedPercentageAmount(base: number, percent: number): number {
  const rate = percentUnits(percent);
  if (rate === null || !Number.isSafeInteger(base) || base < 0) return NaN;
  return Number((BigInt(base) * rate + SCALE / 2n) / SCALE);
}
function rounded(value: bigint) {
  return Number((value + SCALE / 2n) / SCALE);
}
function reconcile(values: bigint[], target: number) {
  const initial = values.map(rounded),
    sum = values.reduce((n, v) => n + v, 0n);
  if (!Number.isSafeInteger(target) || target < 0 || sum === 0n) return initial;
  if (
    (sum - BigInt(target) * SCALE > 0n
      ? sum - BigInt(target) * SCALE
      : BigInt(target) * SCALE - sum) >
    BigInt(values.length * 2) * SCALE
  )
    return initial;
  const shares = values.map((v, index) => ({
    index,
    value: Number((v * BigInt(target)) / sum),
    remainder: (v * BigInt(target)) % sum,
  }));
  let rest = target - shares.reduce((n, s) => n + s.value, 0);
  for (const share of [...shares].sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
  ))
    if (rest-- > 0) share.value++;
  return shares.some((s, i) => Math.abs(s.value - initial[i]) > 2)
    ? initial
    : shares.map((s) => s.value);
}
// Only small rounding differences (at most Rp2 per line) may reconcile to immutable source totals.
export function calculatePackage(lines: PackageInput[], targetNet: number, targetTax: number) {
  if (
    !lines.length ||
    lines.length > 100 ||
    lines.some(
      (i) =>
        !Number.isSafeInteger(i.quantity) ||
        i.quantity < 1 ||
        i.quantity > 10000 ||
        !validUnitPrice(i.unitPrice) ||
        !Number.isSafeInteger(i.quantity * i.unitPrice) ||
        i.quantity * i.unitPrice > 2147483647 ||
        percentUnits(i.discountPercent) === null ||
        (i.taxPercent !== undefined
          ? percentUnits(i.taxPercent) === null
          : !Number.isSafeInteger(i.tax) || i.tax! < 0),
    )
  )
    return null;
  const exactNets = lines.map(
    (i) => BigInt(i.quantity * i.unitPrice) * (SCALE - percentUnits(i.discountPercent)!),
  );
  const nets = reconcile(exactNets, targetNet);
  const taxes = lines.every((i) => i.taxPercent !== undefined)
    ? reconcile(
        lines.map((i, k) => BigInt(nets[k]) * percentUnits(i.taxPercent!)!),
        targetTax,
      )
    : lines.map((i, k) =>
        i.taxPercent === undefined ? i.tax! : roundedPercentageAmount(nets[k], i.taxPercent),
      );
  const items = lines.map((i, k) => {
    const base = i.quantity * i.unitPrice,
      discount = base - nets[k];
    return {
      ...i,
      discount,
      tax: taxes[k],
      ...((BigInt(base) * percentUnits(i.discountPercent)!) % SCALE !== 0n ||
      discount !== roundedPercentageAmount(base, i.discountPercent)
        ? {
            discountRoundingAdjustment: discount - roundedPercentageAmount(base, i.discountPercent),
          }
        : {}),
      ...(i.taxPercent !== undefined
        ? { taxRoundingAdjustment: taxes[k] - roundedPercentageAmount(nets[k], i.taxPercent) }
        : {}),
    };
  });
  const net = nets.reduce((n, v) => n + v, 0),
    tax = taxes.reduce((n, v) => n + v, 0);
  return {
    items,
    net,
    tax,
    matches:
      net === targetNet &&
      tax === targetTax &&
      items.every(
        (i) =>
          i.discount >= 0 &&
          i.discount <= i.quantity * i.unitPrice &&
          i.tax >= 0 &&
          Math.abs(i.discountRoundingAdjustment ?? 0) <= 2 &&
          Math.abs(i.taxRoundingAdjustment ?? 0) <= 2,
      ),
    adjusted: items.some(
      (i, k) =>
        exactNets[k] % SCALE !== 0n ||
        (i.discountRoundingAdjustment ?? 0) !== 0 ||
        (i.taxPercent !== undefined &&
          (BigInt(nets[k]) * percentUnits(i.taxPercent)!) % SCALE !== 0n) ||
        (i.taxRoundingAdjustment ?? 0) !== 0,
    ),
  };
}
