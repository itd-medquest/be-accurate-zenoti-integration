import { createWorker, PSM } from 'tesseract.js';
import language from '@tesseract.js-data/eng';
import { createCanvas } from '@napi-rs/canvas';

const phrases = [
  'Receipt No.',
  'Receipt No',
  'Sub Total',
  'Total Paid',
  'Patient ID',
  'Paid On',
  'Tax Based on Collection',
  'Amount Received',
  'Credited to Ppn',
];
const compact = (s) => s.replace(/[^a-z]/gi, '').toLowerCase();
export function normalizeOcrTokens(input) {
  const tokens = input
    .map((t) => ({
      ...t,
      text: t.text.replace(/^[|_]+|[|_]+$/g, '').replace(/^[1l|]DR(?=\d)/i, 'IDR'),
    }))
    .filter((t) => /[a-z0-9&]/i.test(t.text));
  const grouped = [];
  for (const token of [...tokens].sort((a, b) => b.y - a.y || a.x - b.x)) {
    let row = grouped.find((r) => Math.abs(r.y - token.y) < 2.5);
    if (!row) {
      row = { y: token.y, tokens: [] };
      grouped.push(row);
    }
    row.tokens.push(token);
  }
  const output = [];
  for (const row of grouped) {
    const words = row.tokens.sort((a, b) => a.x - b.x);
    for (let i = 0; i < words.length; i++) {
      let merged;
      for (const phrase of phrases) {
        const n = phrase.split(' ').length,
          seq = words.slice(i, i + n);
        if (
          seq.length !== n ||
          seq.some((w, j) => j && w.x - (seq[j - 1].x + (seq[j - 1].width ?? 0)) > 18)
        )
          continue;
        if (compact(seq.map((w) => w.text).join(' ')) !== compact(phrase)) continue;
        merged = {
          ...words[i],
          text: phrase,
          width: seq.at(-1).x + (seq.at(-1).width ?? 0) - words[i].x,
        };
        i += n - 1;
        break;
      }
      output.push(merged ?? words[i]);
    }
  }
  return output;
}
export async function createPdfOcr() {
  const worker = await createWorker('eng', 1, {
    langPath: language.langPath,
    gzip: true,
    cacheMethod: 'none',
  });
  return {
    async page(page) {
      const scale = 4,
        viewport = page.getViewport({ scale });
      if (viewport.width * viewport.height > 14000000)
        throw new Error('Ukuran halaman melebihi batas OCR.');
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      async function recognize(rect, mode = PSM.AUTO, numeric = false) {
        let image = canvas,
          ox = 0,
          oy = 0;
        if (rect) {
          ox = Math.max(0, Math.floor(rect.left * scale));
          oy = Math.max(0, Math.floor((viewport.height / scale - rect.top) * scale));
          const w = Math.min(canvas.width - ox, Math.ceil((rect.right - rect.left) * scale)),
            h = Math.min(canvas.height - oy, Math.ceil((rect.top - rect.bottom) * scale));
          if (w <= 0 || h <= 0) throw new Error('Area OCR tidak valid.');
          image = createCanvas(w, h);
          image.getContext('2d').drawImage(canvas, ox, oy, w, h, 0, 0, w, h);
        }
        await worker.setParameters({
          tessedit_pageseg_mode: mode,
          user_defined_dpi: '288',
          tessedit_char_whitelist: numeric ? 'IDR0123456789.,' : '',
        });
        const { data } = await worker.recognize(image.toBuffer('image/png'), {}, { blocks: true });
        const tokens = (data.blocks ?? []).flatMap((b) =>
          b.paragraphs.flatMap((p) =>
            p.lines.flatMap((line) =>
              line.words
                .filter((w) => w.text.trim())
                .map((w) => ({
                  text: w.text,
                  x: (w.bbox.x0 + ox) / scale,
                  y: (viewport.height - (line.baseline?.y0 ?? w.bbox.y1) - oy) / scale,
                  width: (w.bbox.x1 - w.bbox.x0) / scale,
                  confidence: w.confidence,
                })),
            ),
          ),
        );
        return { tokens: normalizeOcrTokens(tokens), confidence: data.confidence, text: data.text };
      }
      const result = await recognize();
      const price = result.tokens.find((t) => /^PRICE$/i.test(t.text));
      const itemHeader = result.tokens.find((t) => /^ITEM\s*\(Qty\)/i.test(t.text));
      const consultant = result.tokens.find((t) => /^CONSULTANT/i.test(t.text));
      // Narrow columns keep dashed rules and neighbouring payment text out of item recognition.
      if (price && itemHeader && consultant) {
        const totals = result.tokens.filter(
          (t) => /^Total$/i.test(t.text) && t.x < itemHeader.x + 15 && t.y < itemHeader.y,
        );
        const bottom = totals.length ? Math.min(...totals.map((t) => t.y)) - 5 : itemHeader.y - 180;
        const rect = {
          left: itemHeader.x - 2,
          right: consultant.x - 3,
          top: itemHeader.y - 6,
          bottom,
        };
        const names = await recognize(rect, PSM.SINGLE_BLOCK);
        result.tokens = result.tokens.filter(
          (t) => !(t.y < rect.top && t.y > rect.bottom && t.x >= rect.left && t.x < consultant.x),
        );
        result.tokens.push(...names.tokens);
        const sub = result.tokens.find((t) => /^Sub\s*Total$/i.test(t.text));
        if (sub) {
          const moneyRect = {
            left: price.x - 65,
            right: price.x + (price.width ?? 30) + 2,
            top: itemHeader.y - 8,
            bottom: sub.y + 9,
          };
          const amounts = await recognize(moneyRect, PSM.SINGLE_BLOCK, true);
          result.tokens = result.tokens.filter(
            (t) =>
              !(
                t.y < moneyRect.top &&
                t.y > moneyRect.bottom &&
                t.x >= moneyRect.left &&
                t.x < moneyRect.right
              ),
          );
          result.tokens.push(...amounts.tokens);
        }
      }
      const subtotal = result.tokens.find((t) => /^Sub\s*Total$/i.test(t.text));
      const anchors = subtotal
        ? result.tokens.filter(
            (t) =>
              /^(Sub\s*Total|Tax|Total|Discounts?)$/i.test(t.text) &&
              t.x < subtotal.x + 10 &&
              t.y <= subtotal.y + 2,
          )
        : [];
      const paid = result.tokens.find((t) => /^Total Paid$/i.test(t.text));
      if (paid) anchors.push(paid);
      for (const anchor of anchors) {
        const right =
          anchor === paid
            ? Math.max(
                ...result.tokens
                  .filter((t) => Math.abs(t.y - paid.y) < 4 && t.x > paid.x + 35)
                  .map((t) => t.x + (t.width ?? 0)),
                paid.x + 150,
              ) + 3
            : (price?.x ?? 220) + (price?.width ?? 30) + 4;
        const rect = {
          left: Math.max(anchor.x + 45, right - 100),
          right,
          top: anchor.y + 11,
          bottom: anchor.y - 4,
        };
        const recognized = await recognize(rect, PSM.SINGLE_LINE, true);
        const text = recognized.text.replace(/\s/g, '').replace(/^[1l]DR/i, 'IDR');
        if (!/^IDR\d[\d.]*?(?:,00)?$/.test(text)) continue;
        result.tokens = result.tokens.filter(
          (t) => !(Math.abs(t.y - anchor.y) < 5 && t.x >= rect.left && t.x < right),
        );
        result.tokens.push({
          text,
          x: rect.left,
          y: anchor.y,
          width: right - rect.left,
          confidence: recognized.confidence,
        });
      }
      const usageTable = result.tokens
        .filter((token) => /\bBenefit\b/i.test(token.text))
        .some((header) => {
          const text = result.tokens
            .filter((token) => Math.abs(token.y - header.y) < 8)
            .map((token) => token.text)
            .join(' ');
          return /\bUsed\b/i.test(text) && /\bBalance\b/i.test(text);
        });
      const benefitHeader = usageTable
        ? undefined
        : result.tokens.find((t) => /^Benefit$/i.test(t.text));
      const typeHeader = result.tokens.find(
        (t) => /^Type$/i.test(t.text) && benefitHeader && Math.abs(t.y - benefitHeader.y) < 8,
      );
      const discountHeader = result.tokens.find(
        (t) => /^Discount/i.test(t.text) && benefitHeader && Math.abs(t.y - benefitHeader.y) < 18,
      );
      const benefitCountHeader = result.tokens.find(
        (t) => /benefits/i.test(t.text) && benefitHeader && Math.abs(t.y - benefitHeader.y) < 18,
      );
      const benefitRows = [];
      let benefitTableComplete = true;
      if (benefitHeader && typeHeader) {
        const percentages = result.tokens
          .filter(
            (t) =>
              (/^\d+(?:[.,]\d+)?%$/.test(t.text) ||
                (discountHeader && benefitCountHeader && /^\d[\d.]*$/.test(t.text))) &&
              t.y < benefitHeader.y - 8 &&
              t.x > (discountHeader ? discountHeader.x - 12 : typeHeader.x) &&
              t.x <
                (discountHeader && benefitCountHeader
                  ? (discountHeader.x + benefitCountHeader.x) / 2
                  : typeHeader.x + 130),
          )
          .sort((a, b) => b.y - a.y);
        // OCR may merge Price and a nominal Discount into one token. Type cells
        // still identify the rows; read the discount directly from its grid cell.
        if (discountHeader && benefitCountHeader) {
          for (const cell of result.tokens.filter(
            (token) =>
              /^(Service|Product)(?:\s|\d|$)/i.test(token.text) &&
              Math.abs(token.x - typeHeader.x) < 18 &&
              token.y < benefitHeader.y - 8,
          )) {
            if (!percentages.some((token) => Math.abs(token.y - cell.y) < 4))
              percentages.push({
                ...cell,
                text: '',
                x: discountHeader.x,
                width: discountHeader.width,
              });
          }
          percentages.sort((a, b) => b.y - a.y);
        }
        const thank = result.tokens.find(
          (t) =>
            /^Thank$/i.test(t.text) &&
            t.y < (percentages.at(-1)?.y ?? benefitHeader.y) &&
            t.x < typeHeader.x,
        );
        if (!percentages.length || percentages.length > 50) benefitTableComplete = false;
        const left = benefitHeader.x - 9,
          right = Math.max(
            ...percentages.map((p) => p.x + (p.width ?? 17) + 45),
            typeHeader.x + 130,
          );
        const imageData = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
        const dark = (x, y) => imageData.data[(y * canvas.width + x) * 4] < 120;
        const gridY = [];
        for (
          let py = Math.max(
            0,
            Math.floor((viewport.height / scale - benefitHeader.y - 20) * scale),
          );
          py <
          Math.min(
            canvas.height,
            Math.ceil((viewport.height / scale - ((thank?.y ?? 25) + 10)) * scale),
          );
          py++
        ) {
          let count = 0;
          const start = Math.max(0, Math.floor(left * scale)),
            end = Math.min(canvas.width, Math.ceil(right * scale));
          for (let px = start; px < end; px++) if (dark(px, py)) count++;
          if (count / (end - start) > 0.8) {
            const y = (canvas.height - py) / scale;
            if (!gridY.some((v) => Math.abs(v - y) < 2)) gridY.push(y);
          }
        }
        const gridX = [];
        if (gridY.length >= 2) {
          const top = Math.max(...gridY),
            bottom = Math.min(...gridY),
            start = Math.ceil((viewport.height / scale - top + 1) * scale),
            end = Math.floor((viewport.height / scale - bottom - 1) * scale);
          for (
            let px = Math.max(0, Math.floor(left * scale));
            px < Math.min(canvas.width, Math.ceil(right * scale));
            px++
          ) {
            let count = 0;
            for (let py = start; py < end; py++) if (dark(px, py)) count++;
            if (count / (end - start) > 0.8) {
              const x = px / scale;
              if (!gridX.some((v) => Math.abs(v - x) < 2)) gridX.push(x);
            }
          }
        }
        for (let i = 0; i < Math.min(percentages.length, 50); i++) {
          const pct = percentages[i];
          const top =
            (gridY.filter((y) => y > pct.y).sort((a, b) => a - b)[0] ??
              (i === 0 ? benefitHeader.y - 8 : (percentages[i - 1].y + pct.y) / 2)) + 0.5;
          const bottom =
            (gridY.filter((y) => y < pct.y).sort((a, b) => b - a)[0] ??
              (i === percentages.length - 1
                ? (thank?.y ?? 25) + 10
                : (percentages[i + 1].y + pct.y) / 2)) + 1;
          const names = await recognize(
            {
              left: (gridX[0] ?? benefitHeader.x - 6) + 1.5,
              right: (gridX[1] ?? typeHeader.x - 4) - 1,
              top: top - 2,
              bottom,
            },
            PSM.SINGLE_BLOCK,
          );
          const amount = await recognize(
            {
              left: (gridX[2] ?? typeHeader.x + (typeHeader.width ?? 18) + 5) + 1.5,
              right: (gridX[3] ?? pct.x - 4) - 1.5,
              top: pct.y + 10,
              bottom: pct.y - 4,
            },
            PSM.SINGLE_LINE,
            true,
          );
          const discountText =
            pct.text ||
            (
              await recognize(
                {
                  left: (gridX[3] ?? discountHeader.x - 4) + 1.5,
                  right: (gridX[4] ?? benefitCountHeader.x - 3) - 1.5,
                  top: pct.y + 10,
                  bottom: pct.y - 4,
                },
                PSM.SINGLE_LINE,
              )
            ).text
              .replace(/\s/g, '')
              .replace(/^[|()[\]{}]+|[|()[\]{}]+$/g, '');
          const quantity = await recognize(
            {
              left: (gridX[4] ?? pct.x + (pct.width ?? 17) + 12) + 1.5,
              right: (gridX[5] ?? pct.x + (pct.width ?? 17) + 40) - 1.5,
              top: pct.y + 10,
              bottom: pct.y - 4,
            },
            PSM.SINGLE_LINE,
            true,
          );
          const name = names.tokens
            .map((t) => t.text.replace(/^[|()[\]{}]+|[|()[\]{}]+$/g, ''))
            .filter(Boolean)
            .join(' ');
          const amountText = amount.text.replace(/\s|IDR|\./g, '');
          const qtyText = quantity.text.replace(/\s/g, '');
          if (
            !name ||
            !/^(?:\d+(?:[.,]\d+)?%|\d[\d.]*)$/.test(discountText) ||
            !/^\d+$/.test(amountText) ||
            !/^\d+$/.test(qtyText) ||
            Number(qtyText) < 1
          ) {
            benefitTableComplete = false;
            continue;
          }
          benefitRows.push({
            name,
            price: Number(amountText),
            quantity: Number(qtyText),
            ...(/%$/.test(discountText)
              ? { discountPercent: Number(discountText.replace('%', '').replace(',', '.')) }
              : { discountAmount: Number(discountText.replaceAll('.', '')) }),
          });
        }
      }
      return {
        tokens: result.tokens,
        confidence: result.confidence,
        ...(benefitHeader ? { benefitRows, benefitTableDetected: true, benefitTableComplete } : {}),
      };
    },
    close: () => worker.terminate(),
  };
}
