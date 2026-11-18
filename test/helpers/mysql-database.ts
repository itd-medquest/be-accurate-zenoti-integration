import 'dotenv/config';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';

config({ path: '.env.test.local', quiet: true });

/** Never reuse DATABASE_URL: each test process gets its own disposable schema. */
const cleanups: (() => Promise<void>)[] = [];
export async function createTestDatabase() {
  const source = process.env.TEST_DATABASE_URL;
  if (!source?.startsWith('mysql://'))
    throw new Error(
      'Set TEST_DATABASE_URL to an isolated MySQL test server; application DATABASE_URL is never used.',
    );
  const name = 'imp_test_' + randomUUID().replaceAll('-', '');
  const adminUrl = new URL(source);
  adminUrl.pathname = '/';
  const connection = await mysql.createConnection({ uri: adminUrl.toString(), timezone: 'Z' });
  try {
    await connection.query(
      `CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin`,
    );
  } finally {
    await connection.end();
  }
  const target = new URL(source);
  target.pathname = '/' + name;
  const cleanup = async () => {
    if (!/^imp_test_[a-f0-9]{32}$/.test(name)) throw new Error('Unsafe test database name.');
    const connection = await mysql.createConnection(adminUrl.toString());
    try {
      await connection.query(`DROP DATABASE \`${name}\``);
    } finally {
      await connection.end();
    }
  };
  cleanups.push(cleanup);
  return target.toString();
}

export async function closeTestDatabases() {
  for (const cleanup of cleanups.splice(0)) await cleanup();
}
