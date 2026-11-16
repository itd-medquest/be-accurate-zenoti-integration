import { mkdir, writeFile } from 'node:fs/promises';
import { salesTemplateBuffer as templateBuffer } from '../src/utils/parsers/sales-accrual.js';
import { parsePdf } from '../src/utils/parsers/pdf.js';
import { candidateErrors } from '../src/utils/import-validation.js';
await mkdir('../../docs/templates', { recursive: true });
await writeFile('../../docs/templates/template-sales-accrual.xlsx', await templateBuffer());
await writeFile('../../docs/templates/contoh-sales-accrual.xlsx', await templateBuffer(true));
console.log('Template kosong dan contoh anonim disimpan di docs/templates.');
if (process.argv[2])
  for (const c of await parsePdf(process.argv[2]))
    console.log(
      JSON.stringify({
        items: c.items.map((i) => ({
          name: i.name,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          discount: i.discount,
          tax: i.tax,
          final: i.quantity * i.unitPrice - i.discount + i.tax,
        })),
        subtotal: c.subtotal,
        tax: c.tax,
        total: c.total,
        paid: c.totalPaid,
        outstanding: c.outstanding,
        errors: candidateErrors(c),
        businessStatus: c.businessStatus,
        hasSourceId: !!c.sourceId,
      }),
    );
