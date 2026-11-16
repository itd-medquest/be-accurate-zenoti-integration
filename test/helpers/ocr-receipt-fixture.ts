import { createCanvas } from '@napi-rs/canvas';

// Raster-only synthetic receipt: no patient information, font mappings or text layer.
export function ocrReceiptPdf(withBenefits = false) {
  const canvas = createCanvas(1836, 2376),
    ctx = canvas.getContext('2d');
  ctx.scale(3, 3);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 612, 792);
  ctx.fillStyle = '#000';
  ctx.font = '9px Times New Roman';
  const cells: [number, number, string][] = [
    [165, 676, 'Receipt No.'],
    [215, 676, 'TEST-OCR-001'],
    [33, 630, 'Sample Customer'],
    [365, 630, '26/10/2026'],
    [335, 615, 'Patient ID'],
    [380, 615, 'TEST001'],
    [33, 596, 'ITEM(Qty)'],
    [118, 596, 'CONSULTANT(S)'],
    [222, 596, 'PRICE'],
    [263, 596, 'Payment'],
    [327, 596, 'Paid On'],
    [378, 596, 'Amount'],
    [33, 577, 'Glow Skin'],
    [33, 565, 'Booster(4)'],
    [210, 575, '7.207.207'],
    [33, 551, 'PicoWay Face'],
    [33, 539, 'Rejuvenation(1)'],
    [210, 549, '7.207.207'],
    [33, 520, 'Sub Total'],
    [190, 520, 'IDR14.414.414'],
    [33, 505, 'Discounts'],
    [195, 505, 'IDR3.603.603'],
    [33, 490, 'Tax'],
    [195, 490, 'IDR1.189.189'],
    [33, 475, 'Total'],
    [190, 475, 'IDR12.000.000'],
    [263, 575, 'Visa'],
    [322, 575, '26/10/2026'],
    [368, 575, '12.000.000'],
    [263, 532, 'Tax Based on Collection'],
    [263, 460, 'Total Paid'],
    [355, 460, 'IDR12.000.000'],
  ];
  for (const [x, y, text] of cells) ctx.fillText(text, x, 792 - y);
  if (withBenefits) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(25, 792 - 588, 450, 145);
    ctx.fillStyle = '#000';
    const replacement: [number, number, string][] = [
      [33, 577, 'Custom Package-'],
      [33, 565, 'Sample(1)'],
      [210, 575, '7.432.432'],
      [33, 520, 'Sub Total'],
      [195, 520, 'IDR7.432.432'],
      [33, 490, 'Tax'],
      [200, 490, 'IDR817.568'],
      [33, 475, 'Total'],
      [195, 475, 'IDR8.250.000'],
      [263, 575, 'Visa'],
      [322, 575, '26/10/2026'],
      [373, 575, '8.250.000'],
      [263, 532, 'Tax Based on Collection'],
      [263, 460, 'Total Paid'],
      [355, 460, 'IDR8.250.000'],
      [48, 315, 'Benefit'],
      [87, 315, 'Type'],
      [125, 315, 'Price'],
      [160, 315, 'Discount'],
      [198, 315, 'benefits'],
      [49, 284, 'Indiba'],
      [47, 272, 'Wrinkle'],
      [45, 260, 'Corrector'],
      [51, 250, 'Facial'],
      [85, 272, 'Service'],
      [115, 272, '13.513.515'],
      [167, 272, '45%'],
      [208, 272, '5'],
      [45, 210, 'Thank you'],
    ];
    ctx.lineWidth = 0.4;
    for (const x of [43, 82, 112, 157, 193, 228]) {
      ctx.beginPath();
      ctx.moveTo(x, 792 - 330);
      ctx.lineTo(x, 792 - 240);
      ctx.stroke();
    }
    for (const y of [330, 300, 240]) {
      ctx.beginPath();
      ctx.moveTo(43, 792 - y);
      ctx.lineTo(228, 792 - y);
      ctx.stroke();
    }
    for (const [x, y, text] of replacement) ctx.fillText(text, x, 792 - y);
  }
  const jpeg = canvas.toBuffer('image/jpeg');
  const content = Buffer.from('q 612 0 0 792 0 0 cm /Im1 Do Q');
  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>',
    ),
    Buffer.concat([
      Buffer.from(
        `<< /Type /XObject /Subtype /Image /Width 1836 /Height 2376 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
      ),
      jpeg,
      Buffer.from('\nendstream'),
    ]),
    Buffer.concat([
      Buffer.from(`<< /Length ${content.length} >>\nstream\n`),
      content,
      Buffer.from('\nendstream'),
    ]),
  ];
  const parts = [Buffer.from('%PDF-1.4\n')],
    offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(parts.reduce((n, b) => n + b.length, 0));
    parts.push(Buffer.from(`${i + 1} 0 obj\n`), objects[i], Buffer.from('\nendobj\n'));
  }
  const xref = parts.reduce((n, b) => n + b.length, 0);
  parts.push(
    Buffer.from(
      `xref\n0 6\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)
        .join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`,
    ),
  );
  return Buffer.concat(parts);
}
