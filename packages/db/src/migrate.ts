import './env.js';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { fileURLToPath } from 'node:url';
import { createDb } from './client.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

const { db, close } = createDb(url, { connectionLimit: 1 });
const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));
await migrate(db, { migrationsFolder });
console.log('Migrations applied');
await close();
