import type { PdfPage } from '../../src/utils/parsers/pdf.js';

// Synthetic versions of the reviewed layouts; no patient data.
export function redemptionPages(
  full: boolean,
  number = full ? 'REDEEM-FULL' : 'REDEEM-MIXED',
  options: { mergedUsageHeader?: boolean; mergedPatientId?: boolean } = {},
): PdfPage[] {
  const cells: [number, number, string][] = [
    [55, 684, 'Invoice No.'],
    [95, 684, number],
    [285, 684, 'Receipt No.'],
    [325, 684, `RECEIPT-${number}`],
    [30, 630, 'Customer Test'],
    [350, 630, '22/06/2026'],
    [318, 617, 'Patient ID'],
    [359, 617, 'TEST001'],
    [33, 597, 'ITEM(Qty)'],
    [131, 597, 'CONSULTANT(S)'],
    [235, 597, 'PRICE'],
    ...(full
      ? ([
          [33, 580, 'Skin Brightening Facial(1)'],
          [233, 580, '450.450'],
          [45, 565, 'Custom Package-Test- Redeemed'],
          [33, 545, 'Diamond Micro Dermabrassion(1)'],
          [233, 545, '360.360'],
          [45, 530, 'Custom Package-Test- Redeemed'],
          [33, 510, 'Relaxing Body Massage(1)'],
          [233, 510, '180.180'],
          [45, 495, 'Custom Package-Test- Redeemed'],
        ] as [number, number, string][])
      : ([
          [33, 580, 'Consultation(1)'],
          [233, 580, '0'],
          [33, 555, 'Fractional IPL Shoot(1)'],
          [233, 555, '900.901'],
          [33, 530, 'Cauter Large Area(1)'],
          [233, 530, '2.252.252'],
          [45, 510, 'Custom Package-Test- Redeemed'],
        ] as [number, number, string][])),
    [33, 475, 'Sub Total'],
    [213, 475, full ? 'IDR990.990' : 'IDR3.153.153'],
    ...(!full
      ? ([
          [33, 460, 'Discounts'],
          [213, 460, 'IDR765.766'],
        ] as [number, number, string][])
      : []),
    [33, 445, 'Tax'],
    [213, 445, full ? 'IDR0' : 'IDR14.865'],
    [33, 430, 'Total'],
    [213, 430, full ? 'IDR0' : 'IDR150.000'],
    [320, 410, 'Total Paid'],
    [440, 410, full ? 'IDR0' : 'IDR150.000'],
    [33, 300, 'Benefit'],
    [95, 300, 'Type'],
    [125, 300, 'Quantity'],
    [165, 300, 'Used'],
    [195, 300, 'Refunded'],
    [240, 300, 'Balance'],
    [33, 280, 'Cauter Large Area'],
    [95, 280, 'Service'],
    [125, 280, '1'],
    [165, 280, '1'],
    [195, 280, '0'],
    [240, 280, '0'],
    [24, 16, 'https://example.test/Receipt.aspx?InvId=1234...'],
    ...(!full
      ? ([
          [305, 595, 'Payment'],
          [350, 595, 'Paid On'],
          [415, 595, 'Amount'],
          [305, 575, 'Custom (QRIS)'],
          [350, 575, '22/06/2026'],
          [415, 575, '150.000'],
          [305, 550, 'Tax Based on Collection'],
        ] as [number, number, string][])
      : []),
  ];
  let tokens = cells.map(([x, y, text]) => ({ x, y, text }));
  if (options.mergedUsageHeader) {
    tokens = tokens.filter((token) => !['Used', 'Refunded', 'Balance'].includes(token.text));
    tokens.find((token) => token.text === 'Quantity')!.text = 'Quantity Used Refunded Balance';
  }
  if (options.mergedPatientId) {
    tokens = tokens.filter((token) => token.text !== 'TEST001');
    tokens.find((token) => token.text === 'Patient ID')!.text = 'Patient ID TEST001';
  }
  return [{ width: 612, tokens }];
}

export function redemptionPdf(
  full: boolean,
  number?: string,
  options: { mergedUsageHeader?: boolean; mergedPatientId?: boolean } = {},
) {
  const content = redemptionPages(full, number, options)[0]
    .tokens.map(
      ({ x, y, text }) => `BT /F1 8 Tf ${x} ${y} Td (${text.replace(/[\\()]/g, '\\$&')}) Tj ET`,
    )
    .join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let data = '%PDF-1.4\n';
  const offsets = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(data));
    data += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(data);
  data += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)
    .join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(data);
}
