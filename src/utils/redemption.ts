type Line = {
  name: string;
  redeemed?: boolean;
  quantity: number;
  unitPrice: number;
  discount: number;
  tax: number;
};

export function isConsultation(item: { name: string }) {
  return item.name.trim().toLowerCase() === 'consultation';
}

export function isFreeConsultation(item: Line) {
  return isConsultation(item) && item.unitPrice === 0 && item.discount === 0 && item.tax === 0;
}

export function chargeableItems<T extends Line>(items: T[]): T[] {
  return items.filter((item) => item.redeemed !== true && !isFreeConsultation(item));
}

export function redemptionAmount(items: Line[]) {
  return items.reduce(
    (sum, item) => sum + (item.redeemed ? item.quantity * item.unitPrice - item.discount : 0),
    0,
  );
}

export function isFullRedemption(candidate: { items: Line[]; total: number }) {
  return (
    candidate.total === 0 &&
    candidate.items.length > 0 &&
    candidate.items.some((item) => item.redeemed === true) &&
    candidate.items.every((item) => item.redeemed === true || isFreeConsultation(item))
  );
}

export function isLocalOnlyInvoice(candidate: { items: Line[]; total: number }) {
  return (
    candidate.total === 0 &&
    candidate.items.length > 0 &&
    chargeableItems(candidate.items).length === 0
  );
}
