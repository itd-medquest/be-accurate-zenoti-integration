import { parentPort, workerData } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
let task, ocr, message;
try {
  task = getDocument({
    data: new Uint8Array(await readFile(workerData.path)),
    isEvalSupported: false,
    enableXfa: false,
    verbosity: 0,
    maxImageSize: 14000000,
  });
  const pdf = await task.promise;
  if (pdf.numPages > 20) throw new Error('Maksimal 20 halaman per PDF.');
  const pages = [];
  let characters = 0,
    ocrPages = 0;
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n),
      content = await page.getTextContent();
    let tokens = content.items
      .filter((i) => 'str' in i && i.str.trim())
      .map((i) => ({ text: i.str, x: i.transform[4], y: i.transform[5], width: i.width }));
    const text = tokens.map((t) => t.text).join(' '),
      bad = (text.match(/[\x00-\x08\x0e-\x1f]/g) ?? []).length;
    const broken =
      bad > 5 ||
      (tokens.length > 100 &&
        tokens.filter((t) => t.text.length < 3).length / tokens.length > 0.65 &&
        !/Receipt\s*No/i.test(text));
    const imageOnly =
      !tokens.length &&
      (await page.getOperatorList()).fnArray.some((op) =>
        [OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject].includes(
          op,
        ),
      );
    let benefitData = {},
      extraction = 'text',
      confidence;
    if (broken || imageOnly) {
      if (++ocrPages > 5)
        throw new Error('Maksimal 5 halaman OCR per PDF. Pisahkan dokumen menjadi beberapa file.');
      parentPort.postMessage({ type: 'ocr', page: n });
      if (!ocr) {
        const { createPdfOcr } = await import('./pdf-ocr.mjs');
        ocr = await createPdfOcr();
      }
      const recognized = await ocr.page(page);
      tokens = recognized.tokens;
      confidence = recognized.confidence;
      extraction = 'ocr';
      benefitData = {
        benefitRows: recognized.benefitRows,
        benefitTableDetected: recognized.benefitTableDetected,
        benefitTableComplete: recognized.benefitTableComplete,
      };
    }
    characters += tokens.reduce((sum, t) => sum + t.text.length, 0);
    if (characters > 250000) throw new Error('Teks PDF melebihi batas.');
    pages.push({
      width: page.getViewport({ scale: 1 }).width,
      tokens,
      extraction,
      confidence,
      ...benefitData,
    });
    page.cleanup();
  }
  message = { pages };
} catch (e) {
  message = { error: e instanceof Error ? e.message : 'PDF tidak dapat dibaca.' };
} finally {
  await ocr?.close();
  if (task) await task.destroy();
  parentPort.postMessage(message);
}
