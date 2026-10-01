import { config } from 'dotenv';
config({ path: '../../.env', quiet: true });
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'mysql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'mysql://root@127.0.0.1:3307/retailos' },
  strict: true,
  verbose: true,
});
