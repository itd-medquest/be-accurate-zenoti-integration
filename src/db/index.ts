import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { config } from '../config/env.js';
import * as schema from './schema/index.js';

export const pool = mysql.createPool({
  uri: config.DATABASE_URL,
  timezone: 'Z',
  // The handshake collation is one byte; select the newer binary collation after connecting.
  charset: 'utf8mb4',
  connectionLimit: 10,
  flags: ['-FOUND_ROWS'],
  ...(config.DATABASE_SSL === 'true' ? { ssl: { rejectUnauthorized: true } } : {}),
});
pool.on('connection', (connection) => {
  connection.query("SET time_zone = '+00:00', collation_connection = 'utf8mb4_0900_bin'");
});
export const db = drizzle(pool, { schema, mode: 'default' });
let closing: Promise<void> | undefined;
export function closeDb() {
  return (closing ??= pool.end());
}
