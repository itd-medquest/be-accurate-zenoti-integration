export function percentageDiscountAmount(base: number, percent: number): number {
  if (
    !Number.isSafeInteger(base) ||
    base < 0 ||
    !Number.isFinite(percent) ||
    percent < 0 ||
    percent > 100
  )
    return NaN;
  const text = percent.toFixed(6);
  if (Number(text) !== percent) return NaN;
  const numerator = BigInt(text.replace('.', '')) * BigInt(base);
  const divisor = 100000000n;
  if (numerator % divisor !== 0n) return NaN;
  const result = Number(numerator / divisor);
  return Number.isSafeInteger(result) ? result : NaN;
}

export function validUnitPrice(value: number): boolean {
  return (
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 2147483647 &&
    Number(value.toFixed(6)) === value
  );
}
