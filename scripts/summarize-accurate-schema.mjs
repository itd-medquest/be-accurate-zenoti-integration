import fs from 'node:fs';
const schema = JSON.parse(fs.readFileSync('data/reference/accurate-openapi.json', 'utf8'));
for (const path of [
  '/api/sales-invoice/save.do',
  '/api/sales-invoice/list.do',
  '/api/sales-receipt/save.do',
]) {
  const operation = schema.paths?.[path]?.post ?? schema.paths?.[path]?.get;
  const body = operation?.requestBody?.content?.['application/json']?.schema;
  console.log(
    JSON.stringify(
      {
        path,
        required: body?.required,
        properties: Object.keys(body?.properties ?? {}),
        reviewFields: Object.entries(body?.properties ?? {})
          .filter(([key]) => /draft|approv|suspend|tax|branch|number|customer/i.test(key))
          .map(([key, value]) => ({ key, ...value })),
        security: operation?.security,
      },
      null,
      2,
    ),
  );
}
