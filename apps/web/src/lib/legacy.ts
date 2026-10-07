/**
 * Older versions of the app kept the shop's data in this browser (IndexedDB database "retailos").
 * Everything now lives on the shop server, so this lets the owner copy that old data to the server once.
 * It only reads the old database (and deletes it when asked); nothing new is ever stored in the browser.
 */

const DB_NAME = 'retailos';

/** Tables copied to the server. People's PIN records are never copied. */
const SKIP = new Set(['users']);

async function openExisting(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return null;
  return new Promise((resolve) => {
    let created = false;
    const request = indexedDB.open(DB_NAME);
    // Opening a database that does not exist would create an empty one: stop that and report "none".
    request.onupgradeneeded = () => {
      created = true;
      request.transaction?.abort();
    };
    request.onsuccess = () => {
      if (created) {
        request.result.close();
        resolve(null);
      } else resolve(request.result);
    };
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function readAll(database: IDBDatabase, store: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const request = database.transaction(store, 'readonly').objectStore(store).getAll();
    request.onsuccess = () => resolve(request.result as unknown[]);
    request.onerror = () => reject(request.error);
  });
}

export interface LegacyBackup {
  app: 'retailos';
  version: 1;
  data: Record<string, unknown[]>;
}

/** Does this browser still hold an old local database with shop settings in it? */
export async function legacyDataSummary(): Promise<{ products: number; sales: number; customers: number } | null> {
  const database = await openExisting();
  if (!database) return null;
  try {
    const names = [...database.objectStoreNames];
    if (!names.includes('settings')) return null;
    const count = async (n: string) => (names.includes(n) ? (await readAll(database, n)).length : 0);
    const settings = await count('settings');
    if (settings === 0) return null;
    return { products: await count('products'), sales: await count('sales'), customers: await count('customers') };
  } catch {
    return null;
  } finally {
    database.close();
  }
}

export async function readLegacyBackup(): Promise<LegacyBackup | null> {
  const database = await openExisting();
  if (!database) return null;
  try {
    const data: Record<string, unknown[]> = {};
    for (const name of database.objectStoreNames) if (!SKIP.has(name)) data[name] = await readAll(database, name);
    return { app: 'retailos', version: 1, data };
  } finally {
    database.close();
  }
}

export function deleteLegacyDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}
