import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startupFailure } from '../src/utils/startup-error.js';

test('an empty MySQL AggregateError reports a useful connection code and message', () => {
  const cause = new AggregateError(
    [Object.assign(new Error('private-driver-message'), { code: 'ECONNREFUSED' })],
    '',
  );
  const result = startupFailure(cause, 4000);
  assert.equal(result.code, 'ECONNREFUSED');
  assert.match(result.message, /MySQL aktif/);
  assert.ok(!JSON.stringify(result).includes('private-driver-message'));
});

test('wrapped database failures remain actionable without exposing SQL, passwords or tokens', () => {
  const error = new Error('SQL with private-password and private-token', {
    cause: Object.assign(new Error('private-password'), { code: 'ER_ACCESS_DENIED_ERROR' }),
  });
  const result = startupFailure(error, 4000);
  assert.equal(result.code, 'ER_ACCESS_DENIED_ERROR');
  assert.match(result.message, /Autentikasi MySQL ditolak/);
  assert.ok(!JSON.stringify(result).includes('private-password'));
  assert.ok(!JSON.stringify(result).includes('private-token'));
});

test('unknown, empty and cyclic failures always produce a nonempty controlled message', () => {
  const cycle: { cause?: unknown } = {};
  cycle.cause = cycle;
  for (const value of [undefined, null, '', new Error(''), new Error('private-token'), cycle]) {
    const result = startupFailure(value, 4000);
    assert.equal(result.code, 'STARTUP_FAILED');
    assert.ok(result.message.trim());
    assert.ok(!result.message.includes('private-token'));
  }
});

test('occupied ports and unsupported database engines preserve actionable guidance', () => {
  assert.match(startupFailure({ code: 'EADDRINUSE' }, 4567).message, /Port 4567 sudah digunakan/);
  const message =
    'Database aplikasi memerlukan MySQL 8.4 LTS dengan InnoDB. MariaDB bukan target migrasi ini.';
  assert.equal(startupFailure(new Error(message), 4000).message, message);
});
