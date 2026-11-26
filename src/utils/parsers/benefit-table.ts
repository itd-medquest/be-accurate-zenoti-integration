import type { PdfToken } from './pdf.js';

export type BenefitRow = {
  name: string;
  price: number;
  quantity: number;
  discountPercent?: number;
  discountAmount?: number;
};

function amount(text: string) {
  const value = text.replace(/\s|IDR|Rp\.?/gi, '');
  if (!/^(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,00)?$/.test(value)) return null;
  const result = Number(value.replaceAll('.', '').replace(',00', ''));
  return Number.isSafeInteger(result) && result <= 2147483647 ? result : null;
}

// This layout explicitly distinguishes row Price from the number of benefits.
// Legacy tables without Type/Discount headers keep their existing parser.
export function readBenefitTable(tokens: PdfToken[]) {
  const header = tokens.find((t) => /^Benefit$/i.test(t.text));
  if (!header) return null;
  const heading = (pattern: RegExp) =>
    tokens.find((t) => pattern.test(t.text) && Math.abs(t.y - header.y) < 18);
  const type = heading(/^Type$/i),
    price = heading(/^Price$/i),
    discount = heading(/^Discount/i);
  const quantity = heading(/benefits/i);
  if (
    !type ||
    !price ||
    !discount ||
    !quantity ||
    !(type.x < price.x && price.x < discount.x && discount.x < quantity.x)
  )
    return null;
  const priceLeft = (type.x + price.x) / 2;
  const priceRight = (price.x + discount.x) / 2;
  const discountRight = (discount.x + quantity.x) / 2;
  const normalized = tokens.map((token) => {
    const merged = token.text.match(/^(?:Service|Product)[\s(|]*(\d[\d.]*(?:,00)?)[|)]*$/i);
    return merged && token.x >= type.x - 5 && token.x < priceRight
      ? { ...token, text: merged[1], x: price.x }
      : token;
  });
  const prices = normalized
    .filter(
      (t) => t.y < header.y - 8 && t.x > priceLeft && t.x < priceRight && amount(t.text) !== null,
    )
    .sort((a, b) => b.y - a.y);
  const rows: BenefitRow[] = [];
  let complete = prices.length > 0 && prices.length <= 100;
  const footer = tokens
    .filter(
      (t) =>
        t.x < type.x &&
        t.y < (prices.at(-1)?.y ?? header.y) &&
        (/^-{3,}$/.test(t.text) || /^Thank\b/i.test(t.text)),
    )
    .sort((a, b) => b.y - a.y)[0];
  for (let index = 0; index < Math.min(prices.length, 100); index++) {
    const cell = prices[index];
    const upper = index === 0 ? header.y - 6 : (prices[index - 1].y + cell.y) / 2;
    const lower =
      index === prices.length - 1 ? (footer?.y ?? 25) : (cell.y + prices[index + 1].y) / 2;
    const name = tokens
      .filter(
        (t) => t.x >= Math.max(0, header.x - 25) && t.x < type.x - 8 && t.y < upper && t.y > lower,
      )
      .sort((a, b) => b.y - a.y || a.x - b.x)
      .map((t) => t.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    const discounts = normalized.filter(
      (t) =>
        Math.abs(t.y - cell.y) < 4 &&
        t.x >= priceRight &&
        t.x < discountRight &&
        (/^\d+(?:[.,]\d+)?%$/.test(t.text) || amount(t.text) !== null),
    );
    const quantities = normalized.filter(
      (t) =>
        Math.abs(t.y - cell.y) < 4 &&
        t.x >= discountRight &&
        t.x < quantity.x + 65 &&
        /^\d+$/.test(t.text),
    );
    if (!name || discounts.length !== 1 || quantities.length !== 1) {
      complete = false;
      continue;
    }
    const value = discounts[0].text;
    const row: BenefitRow = {
      name,
      price: amount(cell.text)!,
      quantity: Number(quantities[0].text),
      ...(/%$/.test(value)
        ? { discountPercent: Number(value.slice(0, -1).replace(',', '.')) }
        : { discountAmount: amount(value)! }),
    };
    if (
      row.quantity < 1 ||
      row.quantity > 10000 ||
      (row.discountPercent !== undefined &&
        (row.discountPercent < 0 || row.discountPercent > 100)) ||
      (row.discountAmount !== undefined && row.discountAmount > row.price)
    ) {
      complete = false;
      continue;
    }
    rows.push(row);
  }
  // A missing Price or unread row must never make a partial table look complete.
  const types = tokens.filter(
    (t) =>
      /^(Service|Product)(?:[\s(|]|\d|$)/i.test(t.text) &&
      Math.abs(t.x - type.x) < 20 &&
      t.y < header.y - 8 &&
      t.y > (footer?.y ?? 25),
  );
  if (types.length && types.length !== prices.length) complete = false;
  return { rows, complete: complete && rows.length === prices.length };
}
