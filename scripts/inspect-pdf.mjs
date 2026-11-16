// Local inspection only. Documents are never sent to an external extraction service.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
const input = process.argv[2];
if (!input) throw new Error('Usage: node scripts/inspect-pdf.mjs <invoice.pdf>');
const task = getDocument({
  data: new Uint8Array(readFileSync(input)),
  isEvalSupported: false,
  verbosity: 0,
});
const pdf = await task.promise;
console.log(`Pages: ${pdf.numPages}`);
for (let number = 1; number <= pdf.numPages; number++) {
  const page = await pdf.getPage(number);
  const { items } = await page.getTextContent();
  const lines = new Map();
  for (const item of items) {
    if (!('str' in item) || !item.str.trim()) continue;
    const y = Math.round(item.transform[5] * 2) / 2;
    const line = lines.get(y) ?? [];
    line.push({ x: Math.round(item.transform[4]), text: item.str });
    lines.set(y, line);
  }
  console.log(`--- PAGE ${number} ---`);
  for (const [y, row] of [...lines].sort((a, b) => b[0] - a[0]))
    console.log(
      `${y}: ${row
        .sort((a, b) => a.x - b.x)
        .map((i) => `[${i.x}] ${i.text}`)
        .join(' | ')}`,
    );
  if (number === 1) {
    const { createCanvas } = await import('@napi-rs/canvas');
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = createCanvas(viewport.width, viewport.height);
    await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise;
    mkdirSync('data/reference', { recursive: true });
    writeFileSync('data/reference/invoice-page1.png', canvas.toBuffer('image/png'));
  }
}
await task.destroy();
