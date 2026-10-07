import { useEffect, useState, useSyncExternalStore } from 'react';
import { KEYS, type CollectionName } from '@retailos/domain';
import { ApiError, apiRequest, hasAccessToken } from './api';

/**
 * The shop's data lives on the server. This module gives the pages the same calls they used with the
 * old browser database (`db.products.where('sku').equals(x).first()`, `useLiveQuery`, …) but every read
 * asks the server and every write goes to the server. Nothing is kept in browser storage: the only
 * copy in the browser is an in-memory cache that disappears when the page closes.
 */

interface Doc {
  id: string;
}

// ---------------------------------------------------------------- change notification

let epoch = 0;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};
const getEpoch = () => epoch;
export function notifyChange() {
  epoch += 1;
  for (const l of listeners) l();
}

// ---------------------------------------------------------------- cache (memory only)

interface ServerQuery {
  from?: string;
  to?: string;
  k2?: string;
  k2Prefix?: string;
  k3?: string;
  k4?: string;
  order?: 'asc' | 'desc';
  limit?: number;
}

const cache = new Map<CollectionName, Map<string, Promise<unknown>>>();

export function invalidate(names?: CollectionName[]) {
  if (!names) cache.clear();
  else for (const n of names) cache.delete(n);
}

function cached<T>(collection: CollectionName, key: string, load: () => Promise<T>): Promise<T> {
  let bucket = cache.get(collection);
  if (!bucket) cache.set(collection, (bucket = new Map()));
  let hit = bucket.get(key) as Promise<T> | undefined;
  if (!hit) {
    hit = load();
    bucket.set(key, hit);
    hit.catch(() => bucket!.delete(key));
  }
  return hit;
}

/** Collections that grow every day: asked for by date range / key instead of whole. */
const LARGE = new Set<CollectionName>(['sales', 'saleReturns', 'stockMoves', 'accountTxns', 'partyEntries', 'purchases', 'expenses', 'serviceTxns', 'closings', 'voiceLogs', 'gharOrders']);

// ---------------------------------------------------------------- what this person may ask for

/**
 * Mirrors the server's read rules so screens do not ask for data the person's role may not see. The server
 * still decides; this only avoids requests that would be refused. Empty until a person has signed in.
 */
let permissions: ReadonlySet<string> = new Set();
export function setPermissions(next: ReadonlySet<string>) {
  permissions = next;
}
export const holds = (...wanted: string[]) => wanted.some((p) => permissions.has(p));

const SALES_READ = ['sales.view_all', 'sales.view_own'];
const READ_RULES: Partial<Record<CollectionName, string[]>> = {
  products: ['pos.use', 'products.view', 'inventory.view'],
  customers: ['customers.view', 'pos.use'],
  suppliers: ['suppliers.view', 'purchasing.view'],
  accountTxns: ['accounts.view_balances'],
  stockMoves: ['inventory.view'],
  partyEntries: ['customers.view_balance', 'suppliers.view_balance'],
  sales: SALES_READ,
  saleReturns: SALES_READ,
  purchases: ['purchasing.view', 'suppliers.view_balance'],
  expenses: ['expenses.view'],
  serviceTxns: ['retailer.transact', 'retailer.view_all'],
  closings: ['cash.session.open_close', 'cash.session.review', 'cash.session.view_expected'],
  heldCarts: ['pos.use'],
  gharOrders: ['pos.use', 'customers.manage'],
  voiceLogs: ['pos.use'],
};
const mayRead = (collection: CollectionName) => {
  const wanted = READ_RULES[collection];
  return !wanted || permissions.size === 0 || holds(...wanted);
};

const forbiddenOrMissing = (error: unknown) => error instanceof ApiError && (error.status === 403 || error.status === 404);

async function fetchList<T extends Doc>(collection: CollectionName, q: ServerQuery): Promise<T[]> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined) params.set(k, String(v));
  const query = params.toString();
  if (!mayRead(collection)) return [];
  return cached(collection, `list?${query}`, async () => {
    try {
      return (await apiRequest<{ items: T[] }>(`/shop/c/${collection}${query ? `?${query}` : ''}`)).items;
    } catch (error) {
      // No right to see this data: the screen shows it as empty rather than failing.
      if (forbiddenOrMissing(error)) return [];
      throw error;
    }
  });
}

// ---------------------------------------------------------------- queries

type Field = string;
const read = (doc: object, field: Field): unknown => (doc as Record<string, unknown>)[field];

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === undefined || a === null) return -1;
  if (b === undefined || b === null) return 1;
  return a < b ? -1 : 1;
}

/** Which server lookup key (k1…k4) a document field feeds, if any. */
function keyOf(collection: CollectionName, field: Field): 'k1' | 'k2' | 'k3' | 'k4' | null {
  const d = KEYS[collection];
  if (d.k1 === field) return 'k1';
  if (typeof d.k2 === 'string' && d.k2 === field) return 'k2';
  if (d.k3 === field) return 'k3';
  if (d.k4 === field) return 'k4';
  return null;
}

interface Plan<T> {
  server: ServerQuery;
  /** Everything the server filter might let through is checked again here, so results are always exact. */
  predicates: ((doc: T) => boolean)[];
  orderBy?: Field;
  reverse: boolean;
  limit?: number;
  offset: number;
  /** Server could already apply the ordering and limit (no local filters in the way). */
  serverOrdered: boolean;
}

export class Collection<T extends Doc> {
  constructor(
    private readonly table: Table<T>,
    private readonly plan: Plan<T>,
  ) {}

  private next(patch: Partial<Plan<T>>) {
    return new Collection<T>(this.table, { ...this.plan, ...patch });
  }

  filter(fn: (doc: T) => boolean) {
    // A local filter can drop rows, so a server-side limit would cut the wrong rows.
    const { limit: _l, ...server } = this.plan.server;
    return this.next({ predicates: [...this.plan.predicates, fn], server, serverOrdered: false });
  }
  reverse() {
    return this.next({ reverse: !this.plan.reverse });
  }
  limit(n: number) {
    return this.next({ limit: n });
  }
  offset(n: number) {
    return this.next({ offset: n });
  }

  async toArray(): Promise<T[]> {
    const p = this.plan;
    const server: ServerQuery = { ...p.server };
    // "Latest N" with nothing else in the way: let the index do it.
    if (this.table.large && p.orderBy && keyOf(this.table.name, p.orderBy) === 'k1' && p.predicates.length === 0 && p.limit !== undefined && p.offset === 0) {
      server.order = p.reverse ? 'desc' : 'asc';
      server.limit = p.limit;
    }
    let rows = await this.table.fetch(server);
    for (const fn of p.predicates) rows = rows.filter(fn);
    if (p.orderBy) rows = [...rows].sort((a, b) => compare(read(a, p.orderBy!), read(b, p.orderBy!)));
    else rows = [...rows].sort((a, b) => compare(a.id, b.id));
    if (p.reverse) rows.reverse();
    if (p.offset) rows = rows.slice(p.offset);
    if (p.limit !== undefined) rows = rows.slice(0, p.limit);
    return rows;
  }

  async sortBy(field: Field): Promise<T[]> {
    const rows = await this.next({ orderBy: field, limit: undefined as never }).toArray();
    return this.plan.limit !== undefined ? rows.slice(0, this.plan.limit) : rows;
  }
  async first(): Promise<T | undefined> {
    return (await this.limit(1).toArray())[0];
  }
  async last(): Promise<T | undefined> {
    return (await this.reverse().limit(1).toArray())[0];
  }
  async count(): Promise<number> {
    return (await this.toArray()).length;
  }
  async primaryKeys(): Promise<string[]> {
    return (await this.toArray()).map((d) => d.id);
  }
  async keys(): Promise<unknown[]> {
    const f = this.plan.orderBy;
    return (await this.toArray()).map((d) => (f ? read(d, f) : d.id));
  }
  async each(fn: (doc: T) => void) {
    for (const d of await this.toArray()) fn(d);
  }
}

export class WhereClause<T extends Doc> {
  constructor(
    private readonly table: Table<T>,
    private readonly field: Field,
  ) {}

  private make(predicate: (doc: T) => boolean, server: ServerQuery = {}) {
    return new Collection<T>(this.table, { server, predicates: [predicate], orderBy: this.field, reverse: false, offset: 0, serverOrdered: false });
  }
  private get key() {
    return this.table.large ? keyOf(this.table.name, this.field) : null;
  }

  equals(value: unknown) {
    if (Array.isArray(value)) {
      // Compound index such as [partyType+partyId]
      const fields = this.field.replace(/^\[|\]$/g, '').split('+');
      const server: ServerQuery = this.table.large && this.table.name === 'partyEntries' && fields.join('+') === 'partyType+partyId' ? { k2: `${value[0]}:${value[1]}` } : {};
      return this.make((d) => fields.every((f, i) => read(d, f) === value[i]), server);
    }
    const key = this.key;
    const server: ServerQuery = key && typeof value === 'string' ? { [key]: value } : {};
    // partyType alone: every khata entry of one type
    if (this.table.large && this.table.name === 'partyEntries' && this.field === 'partyType' && typeof value === 'string') server.k2Prefix = `${value}:`;
    return this.make((d) => read(d, this.field) === value, server);
  }
  between(lower: unknown, upper: unknown, includeLower = true, includeUpper = false) {
    const server: ServerQuery = this.key === 'k1' && typeof lower === 'string' && typeof upper === 'string' ? { from: lower, to: upper } : {};
    return this.make((d) => {
      const v = read(d, this.field);
      if (v === undefined || v === null) return false;
      const lo = compare(v, lower);
      const hi = compare(v, upper);
      return (includeLower ? lo >= 0 : lo > 0) && (includeUpper ? hi <= 0 : hi < 0);
    }, server);
  }
  aboveOrEqual(value: unknown) {
    return this.make((d) => compare(read(d, this.field), value) >= 0, this.key === 'k1' && typeof value === 'string' ? { from: value } : {});
  }
  above(value: unknown) {
    return this.make((d) => compare(read(d, this.field), value) > 0, this.key === 'k1' && typeof value === 'string' ? { from: value } : {});
  }
  belowOrEqual(value: unknown) {
    return this.make((d) => compare(read(d, this.field), value) <= 0, this.key === 'k1' && typeof value === 'string' ? { to: value } : {});
  }
  below(value: unknown) {
    return this.make((d) => compare(read(d, this.field), value) < 0, this.key === 'k1' && typeof value === 'string' ? { to: value } : {});
  }
  startsWith(prefix: string) {
    return this.make((d) => String(read(d, this.field) ?? '').startsWith(prefix));
  }
  anyOf(values: unknown[]) {
    return this.make((d) => values.includes(read(d, this.field)));
  }
}

export class Table<T extends Doc> {
  readonly large: boolean;
  constructor(readonly name: CollectionName) {
    this.large = LARGE.has(name);
  }

  /** Records matching the server-side part of a query (the whole collection when it is small). */
  fetch(server: ServerQuery): Promise<T[]> {
    return fetchList<T>(this.name, this.large ? server : {});
  }

  private base() {
    return new Collection<T>(this, { server: {}, predicates: [], reverse: false, offset: 0, serverOrdered: false });
  }

  where(field: Field) {
    return new WhereClause<T>(this, field);
  }
  orderBy(field: Field) {
    return new Collection<T>(this, { server: {}, predicates: [], orderBy: field, reverse: false, offset: 0, serverOrdered: false });
  }
  filter(fn: (doc: T) => boolean) {
    return this.base().filter(fn);
  }
  toCollection() {
    return this.base();
  }
  reverse() {
    return this.base().reverse();
  }
  toArray() {
    return this.base().toArray();
  }
  count() {
    return this.base().count();
  }
  limit(n: number) {
    return this.base().limit(n);
  }

  async get(id: string): Promise<T | undefined> {
    if (!this.large) return (await this.fetch({})).find((d) => d.id === id);
    return cached(this.name, `get:${id}`, async () => {
      try {
        return await apiRequest<T>(`/shop/c/${this.name}/${encodeURIComponent(id)}`);
      } catch (error) {
        if (forbiddenOrMissing(error)) return undefined;
        throw error;
      }
    });
  }
  async bulkGet(ids: string[]): Promise<(T | undefined)[]> {
    return Promise.all(ids.map((id) => this.get(id)));
  }

  private changed() {
    invalidate([this.name]);
    notifyChange();
  }

  async put(doc: T): Promise<string> {
    await apiRequest(`/shop/c/${this.name}/${encodeURIComponent(doc.id)}`, { method: 'PUT', json: doc });
    this.changed();
    return doc.id;
  }
  add(doc: T) {
    return this.put(doc);
  }
  async update(id: string, changes: Partial<T>): Promise<number> {
    const current = await this.fetchFresh(id);
    if (!current) return 0;
    await this.put({ ...current, ...changes });
    return 1;
  }
  /** The latest copy, not a cached one, so an update never writes back stale values. */
  private async fetchFresh(id: string): Promise<T | undefined> {
    try {
      return await apiRequest<T>(`/shop/c/${this.name}/${encodeURIComponent(id)}`);
    } catch (error) {
      if (forbiddenOrMissing(error)) return undefined;
      throw error;
    }
  }
  async delete(id: string): Promise<void> {
    await apiRequest(`/shop/c/${this.name}/${encodeURIComponent(id)}`, { method: 'DELETE' });
    this.changed();
  }
  async bulkPut(docs: T[]): Promise<void> {
    for (let i = 0; i < docs.length; i += 8) await Promise.all(docs.slice(i, i + 8).map((d) => apiRequest(`/shop/c/${this.name}/${encodeURIComponent(d.id)}`, { method: 'PUT', json: d })));
    this.changed();
  }
  bulkAdd(docs: T[]) {
    return this.bulkPut(docs);
  }
  async bulkDelete(ids: string[]): Promise<void> {
    for (let i = 0; i < ids.length; i += 8) await Promise.all(ids.slice(i, i + 8).map((id) => apiRequest(`/shop/c/${this.name}/${encodeURIComponent(id)}`, { method: 'DELETE' })));
    this.changed();
  }
}

// ---------------------------------------------------------------- live queries

/**
 * Run `querier` and run it again whenever shop data changes (after a save here, or after another
 * terminal changed something). Returns `initial` until the first answer.
 */
export function useLiveQuery<T, D = undefined>(querier: () => Promise<T> | T, deps: readonly unknown[] = [], initial?: D): T | D {
  const [state, setState] = useState<{ has: boolean; value?: T }>({ has: false });
  const version = useSyncExternalStore(subscribe, getEpoch);
  useEffect(() => {
    let alive = true;
    Promise.resolve()
      .then(querier)
      .then((value) => {
        if (alive) setState({ has: true, value });
      })
      .catch(() => {
        /* not signed in yet or a passing network problem: keep what is shown */
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);
  return (state.has ? state.value : initial) as T | D;
}

// ---------------------------------------------------------------- keeping up with other terminals

let timer: ReturnType<typeof setInterval> | undefined;
let known: Record<string, string> | null = null;
const POLL_MS = 10_000;

async function checkVersions() {
  if (document.hidden || !hasAccessToken()) return;
  try {
    const now = await apiRequest<Record<string, string>>('/shop/versions');
    if (known) {
      const changed = [...new Set([...Object.keys(known), ...Object.keys(now)])].filter((k) => known![k] !== now[k]) as CollectionName[];
      if (changed.length) {
        invalidate(changed);
        notifyChange();
      }
    }
    known = now;
  } catch {
    /* try again next time */
  }
}
const onVisible = () => {
  if (!document.hidden) void checkVersions();
};

export function startSync() {
  stopSync();
  known = null;
  void checkVersions();
  timer = setInterval(() => void checkVersions(), POLL_MS);
  document.addEventListener('visibilitychange', onVisible);
}
export function stopSync() {
  if (timer) clearInterval(timer);
  timer = undefined;
  document.removeEventListener('visibilitychange', onVisible);
}

/** Forget everything held in memory (sign-in, sign-out, a different shop) and let screens ask again. */
export function resetStore() {
  invalidate();
  known = null;
  notifyChange();
}
