import type { ListQuery } from '@retailos/contracts';
import { keysFor, type CollectionName } from '@retailos/domain';
import { schema, type Database, type DbOrTx } from '@retailos/db';
import { and, asc, desc, eq, gte, inArray, like, lte, sql, type SQL } from 'drizzle-orm';

/** A shop record: always has a string `id`; the rest is the record's own JSON. */
export interface Doc {
  id: string;
}

export type StoreQuery = Partial<Omit<ListQuery, 'order'>> & { order?: 'asc' | 'desc'; ids?: string[] };

/**
 * Access to the shop's records inside one operation. The SQL version runs inside a database
 * transaction, so an operation (a sale, a purchase …) writes all of its effects or none of them.
 */
export interface ShopStore {
  get<T extends Doc = Doc>(collection: CollectionName, id: string): Promise<T | undefined>;
  /** Like get, but locks the row until the operation ends: use before changing stock or balances. */
  getForUpdate<T extends Doc = Doc>(collection: CollectionName, id: string): Promise<T | undefined>;
  list<T extends Doc = Doc>(collection: CollectionName, query?: StoreQuery): Promise<T[]>;
  /** Total of a numeric field (e.g. `amount`) over the matching records. */
  sum(collection: CollectionName, field: string, query?: StoreQuery): Promise<number>;
  /** Totals of a numeric field per k2 value (e.g. balance per account or per customer). */
  sumByKey(collection: CollectionName, field: string, query?: StoreQuery): Promise<Map<string, number>>;
  /** Insert or replace. */
  put<T extends Doc>(collection: CollectionName, doc: T): Promise<void>;
  remove(collection: CollectionName, id: string): Promise<void>;
  /** Next document number, appending a locked per-kind sequence for uniqueness. */
  nextNumber(kind: 'sale' | 'purchase' | 'ghar', prefix: string): Promise<string>;
}

export const likeEscape = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

const isDoc = (value: unknown): value is Doc => !!value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string';

export class SqlShopStore implements ShopStore {
  constructor(
    private readonly db: DbOrTx,
    private readonly tenantId: string,
    private readonly userId: string | null = null,
  ) {}

  private where(collection: CollectionName, ...more: (SQL | undefined)[]): SQL {
    const t = schema.shopRecords;
    return and(eq(t.tenantId, this.tenantId), eq(t.collection, collection), ...more) as SQL;
  }

  private async read<T extends Doc>(collection: CollectionName, id: string, lock: boolean): Promise<T | undefined> {
    const t = schema.shopRecords;
    const query = this.db.select({ data: t.data }).from(t).where(this.where(collection, eq(t.id, id)));
    const rows = await (lock ? query.for('update') : query);
    const data = rows[0]?.data;
    return isDoc(data) ? (data as T) : undefined;
  }

  get<T extends Doc = Doc>(collection: CollectionName, id: string) {
    return this.read<T>(collection, id, false);
  }

  getForUpdate<T extends Doc = Doc>(collection: CollectionName, id: string) {
    return this.read<T>(collection, id, true);
  }

  private conditions(q: StoreQuery): (SQL | undefined)[] {
    const t = schema.shopRecords;
    return [
      q.ids ? (q.ids.length ? inArray(t.id, q.ids) : sql`1 = 0`) : undefined,
      q.from ? gte(t.k1, q.from) : undefined,
      q.to ? lte(t.k1, q.to) : undefined,
      q.k2 ? eq(t.k2, q.k2) : undefined,
      q.k2Prefix ? like(t.k2, `${likeEscape(q.k2Prefix)}%`) : undefined,
      q.k3 ? eq(t.k3, q.k3) : undefined,
      q.k4 ? eq(t.k4, q.k4) : undefined,
    ];
  }

  async list<T extends Doc = Doc>(collection: CollectionName, q: StoreQuery = {}): Promise<T[]> {
    const t = schema.shopRecords;
    const order = q.order === 'desc' ? [desc(t.k1), desc(t.id)] : [asc(t.k1), asc(t.id)];
    const base = this.db.select({ data: t.data }).from(t).where(this.where(collection, ...this.conditions(q))).orderBy(...order);
    const rows = await (q.limit ? base.limit(q.limit) : base);
    return rows.map((r) => r.data).filter(isDoc) as T[];
  }

  /** `field` is a plain property name chosen by our own code, never user input. */
  private amountExpr(field: string) {
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(field)) throw new Error('Invalid field name');
    return sql<string>`coalesce(sum(cast(json_unquote(json_extract(${schema.shopRecords.data}, ${`$.${field}`})) as signed)), 0)`;
  }

  async sum(collection: CollectionName, field: string, q: StoreQuery = {}): Promise<number> {
    const t = schema.shopRecords;
    const rows = await this.db.select({ total: this.amountExpr(field) }).from(t).where(this.where(collection, ...this.conditions(q)));
    return Number(rows[0]?.total ?? 0);
  }

  async sumByKey(collection: CollectionName, field: string, q: StoreQuery = {}): Promise<Map<string, number>> {
    const t = schema.shopRecords;
    const rows = await this.db
      .select({ key: t.k2, total: this.amountExpr(field) })
      .from(t)
      .where(this.where(collection, ...this.conditions(q)))
      .groupBy(t.k2);
    return new Map(rows.filter((r) => r.key !== null).map((r) => [r.key as string, Number(r.total)]));
  }

  async put<T extends Doc>(collection: CollectionName, doc: T): Promise<void> {
    const t = schema.shopRecords;
    const keys = keysFor(collection, doc as unknown as Record<string, unknown>);
    const now = new Date();
    await this.db
      .insert(t)
      .values({ tenantId: this.tenantId, collection, id: doc.id, ...keys, data: doc, createdAt: now, updatedAt: now, createdBy: this.userId })
      .onDuplicateKeyUpdate({ set: { ...keys, data: doc, updatedAt: now } });
  }

  async remove(collection: CollectionName, id: string): Promise<void> {
    const t = schema.shopRecords;
    await this.db.delete(t).where(this.where(collection, eq(t.id, id)));
  }

  async nextNumber(kind: 'sale' | 'purchase' | 'ghar', prefix: string): Promise<string> {
    const counter = (await this.getForUpdate<Doc & { value: number }>('counters', kind)) ?? { id: kind, value: 0 };
    const value = counter.value + 1;
    await this.put('counters', { id: kind, value });
    return `${prefix}-${String(value).padStart(6, '0')}`;
  }
}

/** Run `work` in one transaction: if it throws, nothing it wrote is kept. */
export function inShopTransaction<T>(db: Database, tenantId: string, userId: string | null, work: (store: ShopStore) => Promise<T>): Promise<T> {
  return db.transaction((tx) => work(new SqlShopStore(tx, tenantId, userId)));
}
