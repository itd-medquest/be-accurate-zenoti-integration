// Synthetic receipt: same layout and amounts as the reviewed sample; no patient data.
export function receiptPdf(options?: {
  invoiceNumber?: string;
  receiptNumber?: string;
  truncatedId?: boolean;
}) {
  const cells: [number, number, string][] = [
    [197, 655, 'Receipt No.'],
    [257, 655, 'TEST-RECEIPT-001'],
    [31, 597, 'Pelanggan Contoh'],
    [444, 597, '15/10/2026'],
    [404, 580, 'Patient ID'],
    [456, 580, 'TEST001'],
    [34, 555, 'ITEM(Qty)'],
    [140, 555, 'CONSULTANT(S)'],
    [261, 555, 'PRICE'],
    [402, 554, 'Paid On'],
    [456, 554, 'Amount'],
    [34, 535, 'Custom Package-'],
    [34, 521, 'Contoh-'],
    [260, 521, '180.180'],
    [34, 508, '20261015102748(1)'],
    [312, 532, 'Custom'],
    [352, 532, '( QRIS )'],
    [396, 532, '15/10/2026'],
    [459, 532, '200.000'],
    [311, 502, 'Tax Based on Collection'],
    [34, 493, 'Sub Total'],
    [238, 492, 'IDR180.180'],
    [34, 477, 'Tax'],
    [244, 477, 'IDR19.820'],
    [34, 461, 'Total'],
    [238, 461, 'IDR200.000'],
    [314, 439, 'Total Paid'],
    [433, 439, 'IDR200.000'],
    [314, 422, 'Paid'],
    [314, 409, '(Cash/Card/Check)'],
    [466, 415, 'IDR0'],
    [52, 164, 'Benefit'],
    [100, 164, 'Type'],
    [139, 164, 'Price'],
    [173, 164, 'Discount'],
    [228, 164, 'benefits'],
    [48, 142, 'Collagen'],
    [58, 128, 'Dew'],
    [55, 115, 'Facial'],
    [94, 128, 'Service'],
    [132, 128, '450.450'],
    [184, 128, '70%'],
    [235, 128, '1'],
    [48, 99, 'Relaxing'],
    [57, 85, 'Body'],
    [49, 72, 'Massage'],
    [64, 58, '30'],
    [50, 45, 'Minutes'],
    [94, 72, 'Service'],
    [132, 72, '180.180'],
    [184, 72, '75%'],
    [235, 72, '1'],
    [24, 16, 'https://example.test/Receipt.aspx?InvId=11111111-1111-4111-8111-111111111111'],
  ];
  if (options?.receiptNumber) cells[1][2] = options.receiptNumber;
  if (options?.invoiceNumber)
    cells.push([197, 638, 'Invoice No.'], [257, 638, options.invoiceNumber]);
  if (options?.truncatedId)
    cells[cells.findIndex((cell) => cell[2].includes('InvId='))][2] =
      'https://example.test/Receipt.aspx?InvId=11111111';
  const text = cells
    .map(([x, y, value]) => `BT /F1 9 Tf ${x} ${y} Td (${value.replace(/[\\()]/g, '\\$&')}) Tj ET`)
    .join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
  ];
  let data = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(data));
    data += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(data);
  data += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)
    .join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(data);
}
