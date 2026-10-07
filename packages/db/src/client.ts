import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema/index.js';

export type Schema = typeof schema;
export type Database = MySql2Database<Schema>;
/** A transaction handle (same query API as Database). */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
export type DbOrTx = Database | Tx;

export interface DbHandle {
  db: Database;
  pool: mysql.Pool;
  close(): Promise<void>;
}

/**
 * `collation` is the connection collation. The default works on MySQL 8 and on MariaDB (common on cPanel);
 * `utf8mb4_0900_ai_ci` only exists on MySQL 8, where it may be chosen with DB_COLLATION.
 */
export function createDb(url: string, options: { connectionLimit?: number; collation?: string } = {}): DbHandle {
  const pool = mysql.createPool({
    uri: url,
    connectionLimit: options.connectionLimit ?? 10,
    // All datetimes are UTC in the database and in the driver.
    timezone: 'Z',
    dateStrings: false,
    supportBigNumbers: true,
    bigNumberStrings: false,
    charset: options.collation ?? 'utf8mb4_unicode_ci',
  });
  pool.on('connection', (conn) => {
    conn.query("SET time_zone = '+00:00'");
  });
  const db = drizzle(pool, { schema, mode: 'default' });
  return { db, pool, close: () => pool.end() };
}
