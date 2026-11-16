// Read-only probe of the official, publicly documented example. No credential is logged or saved.
const source = 'https://accurate.id/api-integration/api-example/';
const html = await (await fetch(source, { signal: AbortSignal.timeout(20000) })).text();
const plain = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
const token = plain.match(/Akses Token\s*\|?\s*([a-f0-9]{8}-[a-f0-9-]{27,})/i)?.[1];
if (!token) {
  console.log(
    JSON.stringify({ source, result: 'Example token could not be extracted; no request sent.' }),
  );
  process.exit(0);
}
const response = await fetch('https://account.accurate.id/api/db-list.do', {
  headers: { Authorization: `Bearer ${token}` },
  signal: AbortSignal.timeout(20000),
  redirect: 'error',
});
const body = await response.json().catch(() => null);
console.log(
  JSON.stringify({
    source,
    endpoint: '/api/db-list.do',
    method: 'GET',
    httpStatus: response.status,
    success: body?.s ?? false,
    databaseCount: Array.isArray(body?.d) && body.s ? body.d.length : undefined,
    error: body?.error ?? (body?.s === false ? body.d : undefined),
    writesSent: 0,
  }),
);
