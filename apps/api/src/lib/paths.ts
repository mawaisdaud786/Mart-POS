import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Where `.env`, `storage/keys` and `migrations/` live.
 *  - APP_ROOT, when set;
 *  - a bundled deployment (cPanel): the folder holding server.js, recognised by its `migrations` folder;
 *  - the repository root when running from apps/api/src or apps/api/dist.
 */
export function appRoot(metaUrl: string): string {
  if (process.env.APP_ROOT) return resolve(process.env.APP_ROOT);
  const here = dirname(fileURLToPath(metaUrl));
  if (existsSync(join(here, 'migrations'))) return here;
  return resolve(here, '../../../');
}

/** Migration SQL folder: next to a bundled deployment, or packages/db/migrations in the repository. */
export function migrationsDir(root: string): string {
  const bundled = join(root, 'migrations');
  return existsSync(join(bundled, 'meta', '_journal.json')) ? bundled : join(root, 'packages', 'db', 'migrations');
}
