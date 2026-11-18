import type { Connection, Pool, RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';

/** Reject accidental MariaDB/older engine targets before applying application DDL. */
export async function assertMysqlServer(connection: Connection | Pool) {
  const [rows] = await connection.query<RowDataPacket[]>(
    'SELECT VERSION() AS version, @@default_storage_engine AS engine',
  );
  const server = z.object({ version: z.string(), engine: z.string() }).parse(rows[0]);
  if (
    !/^8\.4\./.test(server.version) ||
    /mariadb/i.test(server.version) ||
    server.engine.toLowerCase() !== 'innodb'
  )
    throw new Error(
      'Database aplikasi memerlukan MySQL 8.4 LTS dengan InnoDB. MariaDB bukan target migrasi ini.',
    );
}
