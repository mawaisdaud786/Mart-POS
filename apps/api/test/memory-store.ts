import { keysFor, type CollectionName } from '@retailos/domain';
import type { Doc, ShopStore, StoreQuery } from '../src/modules/shop/store';

/** In-memory ShopStore with the same filtering rules as the SQL one, for testing business rules. */
export class MemoryStore implements ShopStore {
  data = new Map<CollectionName, Map<string, unknown>>();

  private col(name: CollectionName) {
    let m = this.data.get(name);
    if (!m) this.data.set(name, (m = new Map()));
    return m;
  }

  async get<T extends Doc>(collection: CollectionName, id: string) {
    const v = this.col(collection).get(id);
    return v === undefined ? undefined : (structuredClone(v) as T);
  }
  getForUpdate = this.get.bind(this);

  async list<T extends Doc>(collection: CollectionName, q: StoreQuery = {}): Promise<T[]> {
    let rows = [...this.col(collection).values()].map((d) => ({ d: d as Record<string, unknown>, k: keysFor(collection, d as Record<string, unknown>) }));
    if (q.ids) rows = rows.filter((r) => q.ids!.includes(r.d.id as string));
    if (q.from) rows = rows.filter((r) => r.k.k1 !== null && r.k.k1 >= q.from!);
    if (q.to) rows = rows.filter((r) => r.k.k1 !== null && r.k.k1 <= q.to!);
    if (q.k2) rows = rows.filter((r) => r.k.k2 === q.k2);
    if (q.k2Prefix) rows = rows.filter((r) => r.k.k2?.startsWith(q.k2Prefix!));
    if (q.k3) rows = rows.filter((r) => r.k.k3 === q.k3);
    if (q.k4) rows = rows.filter((r) => r.k.k4 === q.k4);
    rows.sort((a, b) => (a.k.k1 ?? '').localeCompare(b.k.k1 ?? '') || String(a.d.id).localeCompare(String(b.d.id)));
    if (q.order === 'desc') rows.reverse();
    if (q.limit) rows = rows.slice(0, q.limit);
    return rows.map((r) => structuredClone(r.d) as T);
  }

  async sum(collection: CollectionName, field: string, q: StoreQuery = {}) {
    return (await this.list(collection, q)).reduce((s, d) => s + Number((d as unknown as Record<string, unknown>)[field] ?? 0), 0);
  }

  async sumByKey(collection: CollectionName, field: string, q: StoreQuery = {}) {
    const out = new Map<string, number>();
    for (const d of await this.list(collection, q)) {
      const k = keysFor(collection, d as unknown as Record<string, unknown>).k2;
      if (k) out.set(k, (out.get(k) ?? 0) + Number((d as unknown as Record<string, unknown>)[field] ?? 0));
    }
    return out;
  }

  async put<T extends Doc>(collection: CollectionName, doc: T) {
    this.col(collection).set(doc.id, structuredClone(doc));
  }
  async remove(collection: CollectionName, id: string) {
    this.col(collection).delete(id);
  }
  async nextNumber(kind: 'sale' | 'purchase' | 'ghar', prefix: string) {
    const c = ((await this.get<Doc & { value: number }>('counters', kind))?.value ?? 0) + 1;
    await this.put('counters', { id: kind, value: c });
    return `${prefix}-${String(c).padStart(6, '0')}`;
  }
}
