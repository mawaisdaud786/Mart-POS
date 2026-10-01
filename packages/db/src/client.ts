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

export function createDb(url: string, options: { connectionLimit?: number } = {}): DbHandle {
  const pool = mysql.createPool({
    uri: url,
    connectionLimit: options.connectionLimit ?? 10,
    // All datetimes are UTC in the database and in the driver.
    timezone: 'Z',
    dateStrings: false,
    supportBigNumbers: true,
    bigNumberStrings: false,
    charset: 'utf8mb4_0900_ai_ci',
  });
  pool.on('connection', (conn) => {
    conn.query("SET time_zone = '+00:00'");
  });
  const db = drizzle(pool, { schema, mode: 'default' });
  return { db, pool, close: () => pool.end() };
}
