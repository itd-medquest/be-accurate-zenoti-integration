import { sql } from 'drizzle-orm';
import { db, pool } from '../db/index.js';
import { assertMysqlServer } from '../db/mysql-server.js';
let verified = false;
export async function checkDatabase() {
  if (!verified) {
    await assertMysqlServer(pool);
    verified = true;
  }
  await db.execute(sql`select 1`);
}
