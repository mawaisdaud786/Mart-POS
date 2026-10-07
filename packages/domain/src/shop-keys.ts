/**
 * The shop's records (products, sales, ledgers …) are stored on the server, one row per record in
 * `shop_records`. Each record is a JSON document plus three short lookup keys (k1, k2, k3) so that
 * the common questions "this date range", "this product", "this customer" are answered by an index.
 * Server and web app share this table so they always agree on which field is which key.
 */

export const COLLECTIONS = [
  'settings',
  'categories',
  'products',
  'customers',
  'suppliers',
  'accounts',
  'accountTxns',
  'stockMoves',
  'partyEntries',
  'sales',
  'saleReturns',
  'purchases',
  'expenses',
  'serviceTxns',
  'closings',
  'heldCarts',
  'gharOrders',
  'voiceLogs',
  'counters',
  'prefs',
] as const;
export type CollectionName = (typeof COLLECTIONS)[number];

export const isCollection = (value: string): value is CollectionName => (COLLECTIONS as readonly string[]).includes(value);

export interface KeyDef {
  /** Field stored in k1: an ISO date-time, so ranges and "latest first" use the index. */
  k1?: string;
  /** Field stored in k2 (a product, account, customer …). A function may combine fields. */
  k2?: string | ((doc: Record<string, unknown>) => string | undefined);
  /** Field stored in k3 (a type or status). */
  k3?: string;
  /** Field stored in k4: the document this record belongs to (a sale, expense …). */
  k4?: string;
}

const partyKey = (d: Record<string, unknown>) => (typeof d.partyType === 'string' && typeof d.partyId === 'string' ? `${d.partyType}:${d.partyId}` : undefined);

/** Which document field feeds which lookup key. */
export const KEYS: Record<CollectionName, KeyDef> = {
  settings: {},
  categories: { k2: 'name' },
  products: { k2: 'name', k3: 'categoryId' },
  customers: { k2: 'name' },
  suppliers: { k2: 'name' },
  accounts: { k3: 'type' },
  accountTxns: { k1: 'date', k2: 'accountId', k3: 'type', k4: 'refId' },
  stockMoves: { k1: 'date', k2: 'productId', k3: 'type', k4: 'refId' },
  partyEntries: { k1: 'date', k2: partyKey, k3: 'type', k4: 'refId' },
  sales: { k1: 'date', k2: 'customerId', k3: 'status' },
  saleReturns: { k1: 'date', k2: 'saleId' },
  purchases: { k1: 'date', k2: 'supplierId' },
  expenses: { k1: 'date', k2: 'category', k3: 'kind' },
  serviceTxns: { k1: 'date', k2: 'provider', k3: 'type' },
  closings: { k1: 'date', k2: 'accountId' },
  heldCarts: { k1: 'date' },
  gharOrders: { k1: 'date', k2: 'customerId', k3: 'status' },
  voiceLogs: { k1: 'date', k3: 'status' },
  counters: {},
  prefs: {},
};

export function keysFor(collection: CollectionName, doc: Record<string, unknown>): { k1: string | null; k2: string | null; k3: string | null; k4: string | null } {
  const def = KEYS[collection];
  const pick = (source: string | ((d: Record<string, unknown>) => string | undefined) | undefined) => {
    if (!source) return null;
    const value = typeof source === 'function' ? source(doc) : doc[source];
    return typeof value === 'string' && value !== '' ? value.slice(0, 80) : null;
  };
  return { k1: pick(def.k1), k2: pick(def.k2), k3: pick(def.k3), k4: pick(def.k4) };
}
