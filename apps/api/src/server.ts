import { config as loadDotEnv } from 'dotenv';
import { resolve } from 'node:path';
import { createDb } from '@retailos/db';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { appRoot } from './lib/paths.js';
import { Encryptor } from './lib/crypto.js';
import { schedulePurge } from './lib/maintenance.js';
import { loadKeys } from './lib/tokens.js';

// Repository root in development; the folder holding server.js in a bundled (cPanel) deployment.
const rootDir = appRoot(import.meta.url);
loadDotEnv({ path: resolve(rootDir, '.env'), quiet: true });

async function start() {
  const config = loadConfig({
    ...process.env,
    KEYS_DIR: resolve(rootDir, process.env.KEYS_DIR ?? 'storage/keys'),
  });
  const database = createDb(config.DATABASE_URL, process.env.DB_COLLATION ? { collation: process.env.DB_COLLATION } : {});
  const keys = await loadKeys(config);
  const encryptor = Encryptor.fromEnv(config.APP_ENCRYPTION_KEY, config.KEYS_DIR, config.NODE_ENV === 'production');
  const app = await buildApp({ config, db: database.db, keys, encryptor });

  const stopPurge = schedulePurge(database.db, (message) => app.log.info(message));
  app.addHook('onClose', async () => {
    stopPurge();
    await database.close();
  });
  process.once('SIGINT', () => void app.close());
  process.once('SIGTERM', () => void app.close());

  await app.listen({ host: config.HOST, port: config.PORT });
}

start().catch((error: unknown) => {
  console.error('API startup failed', error);
  process.exitCode = 1;
});