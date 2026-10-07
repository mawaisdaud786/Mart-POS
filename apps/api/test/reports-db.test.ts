/**
 * Server-side reports against a real MySQL: every figure must equal what the browser used to calculate
 * from the same records (test/reference-reports.ts). Needs REPORTS_TEST_URL (a throwaway database the
 * test may create tables in); without it the suite is skipped. Run via `pnpm test:db`.
 */
import { computeReorder, dayNumberOf, type CollectionName } from '@retailos/domain';
import { createDb, type DbHandle } from '@retailos/db';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ShopReports } from '../src/modules/shop/reports.js';
import { SqlShopStore } from '../src/modules/shop/store.js';
import {
  refCashBreakdown,
  refDaily,
  refExpenseTotals,
  refProductSales,
  refProfit,
  refPurchases,
  refReorder,
  refSalesSummary,
  refServiceSummary,
  refTopProducts,
  refVelocity,
  type Books,
} from './reference-reports.js';

const URL_ = process.env.REPORTS_TEST_URL;
const suite = URL_ ? describe : describe.skip;

// Small deterministic random generator so a failure is reproducible.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY = 86_400_000;
const BASE = Date.UTC(2026, 6, 1); // 2026-07-01
const iso = (ms: number) => new Date(ms).toISOString();

function makeBooks(seed: number, scale: number): Books & { products: any[]; suppliers: any[] } {
  const r = rng(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)]!;
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const qty = () => Math.round(r() * 12000) / 1000 + 0.001; // up to 3 decimals
  const when = () => iso(BASE + Math.floor(r() * 90 * DAY));
  const users = ['u-a', 'u-b', 'u-c'];
  const products = Array.from({ length: 8 }, (_, i) => {
    const price = int(10, 5000);
    return {
      id: `p${i}`, name: `Product ${i}`, price, salePrice: price, cost: int(5, 4000), stock: Math.round((r() * 60 - 5) * 1000) / 1000,
      minStock: pick([0, 0, 3, 10]), active: r() > 0.15, supplierId: pick(['s1', 's2', undefined]), packSize: pick([undefined, 1, 6, 12]),
    };
  });
  const suppliers = [
    { id: 's1', name: 'One', leadDays: 2, orderDay: 3 },
    { id: 's2', name: 'Two', leadDays: 5 },
  ];
  const sales: any[] = [];
  const saleReturns: any[] = [];
  const stockMoves: any[] = [];
  for (let n = 0; n < 60 * scale; n++) {
    const items = Array.from({ length: int(1, 4) }, () => {
      const p = pick(products);
      return { productId: p.id, name: r() > 0.7 ? `${p.name} v${int(1, 3)}` : p.name, qty: qty(), price: int(10, 6000), cost: int(5, 4500), discount: int(0, 40), returnedQty: r() > 0.8 ? qty() / 4 : 0 };
    });
    const subtotal = items.reduce((s, i) => s + Math.round(i.price * i.qty) - i.discount, 0);
    const total = Math.max(0, subtotal - int(0, 50));
    const cash = r() > 0.5;
    const change = cash ? int(0, 100) : 0;
    const credit = r() > 0.8 ? int(0, total) : 0;
    const date = when();
    sales.push({
      id: `sale-${seed}-${n}`, number: `INV-${n}`, date, userId: pick(users), status: r() > 0.85 ? 'void' : 'completed', items, subtotal, total, change, credit,
      payments: [{ accountId: cash ? 'acc-cash' : pick(['acc-bank', 'acc-ep', 'acc-jc']), amount: total - credit + change }, ...(r() > 0.8 ? [{ accountId: 'acc-ep', amount: int(1, 500) }] : [])],
    });
  }
  for (let n = 0; n < 12 * scale; n++) {
    const items = Array.from({ length: int(1, 3) }, () => ({ productId: pick(products).id, name: 'x', qty: qty() / 3, price: int(10, 500), cost: int(5, 400) }));
    saleReturns.push({ id: `ret-${seed}-${n}`, date: when(), userId: pick(users), saleId: sales[0].id, items, amount: items.reduce((s, i) => s + Math.round(i.price * i.qty), 0) });
  }
  for (let n = 0; n < 90 * scale; n++) {
    const type = pick(['sale', 'return', 'purchase', 'damage', 'expiry', 'adjust', 'adjust']);
    const sign = type === 'sale' || type === 'damage' || type === 'expiry' ? -1 : type === 'adjust' ? pick([-1, 1]) : 1;
    stockMoves.push({ id: `mv-${seed}-${n}`, date: when(), productId: pick(products).id, type, qty: sign * qty(), cost: int(0, 3000) });
  }
  const expenses = Array.from({ length: 30 * scale }, (_, n) => ({
    id: `ex-${seed}-${n}`, date: when(), kind: pick(['expense', 'expense', 'drawing']), category: pick(['Rent', 'rent', 'Tea & Snacks', 'Electricity', "O'Brien \"q\""]), amount: int(1, 90000),
  }));
  const serviceTxns = Array.from({ length: 30 * scale }, (_, n) => ({
    id: `sv-${seed}-${n}`, date: when(), userId: pick(users), provider: pick(['easypaisa', 'jazzcash']), type: pick(['cash_in', 'cash_out', 'send_money', 'bill', 'load']), amount: int(100, 50000), commission: int(0, 300), fee: int(0, 50),
  }));
  const purchases = Array.from({ length: 15 * scale }, (_, n) => ({ id: `pu-${seed}-${n}`, date: when(), total: int(1000, 900000), paid: int(0, 900000) }));
  const accountTxns = Array.from({ length: 40 * scale }, (_, n) => ({
    id: `at-${seed}-${n}`, date: when(), accountId: pick(['acc-cash', 'acc-bank']), type: pick(['sale', 'expense', 'transfer_in', 'transfer_out', 'purchase']), amount: int(-50000, 50000),
  }));
  return { sales, saleReturns, stockMoves, expenses, serviceTxns, purchases, accountTxns, products, suppliers } as never;
}

suite('server-side reports match the old browser calculations', () => {
  let handle: DbHandle;
  const tenant = randomUUID();
  const other = randomUUID();
  let reports: ShopReports;
  let books: ReturnType<typeof makeBooks>;
  let canCleanUp = false;

  async function load(tenantId: string, b: ReturnType<typeof makeBooks>) {
    const store = new SqlShopStore(handle.db, tenantId, null);
    for (const name of ['sales', 'saleReturns', 'stockMoves', 'expenses', 'serviceTxns', 'purchases', 'accountTxns', 'products', 'suppliers'] as const) {
      for (const doc of (b as never as Record<string, any[]>)[name]!) await store.put(name as CollectionName, doc);
    }
  }

  beforeAll(async () => {
    handle = createDb(URL_!, { connectionLimit: 4 });
    const ddl = readFileSync(new URL('../../../packages/db/migrations/0009_shop_records.sql', import.meta.url), 'utf8');
    await handle.pool.query('DROP TABLE IF EXISTS shop_records');
    canCleanUp = true;
    for (const stmt of ddl.split('--> statement-breakpoint')) if (stmt.trim()) await handle.pool.query(stmt);
    books = makeBooks(7, 3);
    await load(tenant, books);
    // A second shop with different, larger numbers: nothing of it may leak into the first shop's reports.
    await load(other, makeBooks(99, 2));
    reports = new ShopReports(handle.db, tenant);
  }, 120_000);
  afterAll(async () => {
    if (!handle) return;
    try {
      if (canCleanUp) await handle.pool.query('DROP TABLE IF EXISTS shop_records');
    } finally {
      await handle.close();
    }
  });

  // Daily, weekly, monthly, whole-period, custom, a day with nothing, and exact-boundary instants.
  const ranges: [string, string][] = [
    [iso(BASE), iso(BASE + DAY - 1)],
    [iso(BASE + 3 * DAY), iso(BASE + 10 * DAY - 1)],
    [iso(BASE + 31 * DAY), iso(BASE + 61 * DAY - 1)],
    [iso(BASE), iso(BASE + 91 * DAY)],
    [iso(BASE + 17 * DAY + 5000), iso(BASE + 23 * DAY + 77777)],
    [iso(BASE + 400 * DAY), iso(BASE + 401 * DAY)], // nothing here
  ];

  it.each(ranges)('profit and loss %s .. %s', async (a, b) => {
    expect(await reports.profit(a, b)).toEqual(refProfit(books, a, b));
  });

  it('keeps first-seen order of categories and payment accounts', async () => {
    const got = await reports.profit(ranges[3]![0], ranges[3]![1]);
    const want = refProfit(books, ranges[3]![0], ranges[3]![1]);
    expect(Object.keys(got.expensesByCategory)).toEqual(Object.keys(want.expensesByCategory));
    expect(Object.keys(got.byPayment)).toEqual(Object.keys(want.byPayment));
  });

  it.each(ranges)('per-product sales %s .. %s', async (a, b) => {
    const got = await reports.productSales(a, b);
    const want = refProductSales(books, a, b);
    expect(got.map((x) => [x.productId, x.name, x.revenue, x.cost, x.profit])).toEqual(want.map((x) => [x.productId, x.name, x.revenue, x.cost, x.profit]));
    got.forEach((x, i) => expect(x.qty).toBeCloseTo(want[i]!.qty, 6));
  });

  it('aggregates frequently co-sold product quantities from completed invoices', async () => {
    const start = iso(BASE);
    const end = iso(BASE + 91 * DAY);
    const expected = new Map<string, Set<string>>();
    for (const sale of books.sales.filter((row) => row.status === 'completed' && row.date >= start && row.date <= end)) {
      for (const a of sale.items) for (const b of sale.items) {
        if (a.productId >= b.productId) continue;
        const key = JSON.stringify([a.productId, a.qty, b.productId, b.qty]);
        const bills = expected.get(key) ?? new Set<string>();
        bills.add(sale.id);
        expected.set(key, bills);
      }
    }
    const actual = await reports.productPairs(start, end, 200);
    const actualCounts = actual.map((row) => [row.productAId, row.productAQty, row.productBId, row.productBQty, row.bills])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const expectedCounts = [...expected.entries()]
      .filter(([, bills]) => bills.size >= 2)
      .map(([key, bills]) => [...JSON.parse(key) as [string, number, string, number], bills.size])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    expect(actualCounts).toEqual(expectedCounts);
  });

  it('calculates current unit margins and recent realized profit from stored product and sales data', async () => {
    const [start, end] = ranges[3]!;
    const performance = await reports.productPerformance(start, end, 5);
    const sales = await reports.productSales(start, end);
    const catalog = new Map(books.products.map((product) => [product.id, product]));
    const active = books.products.filter((product) => product.active);
    expect(performance).toHaveLength(active.length);
    for (const row of performance) {
      const product = catalog.get(row.productId)!;
      const sold = sales.find((sale) => sale.productId === row.productId);
      const margin = product.price > 0 ? ((product.price - product.cost) / product.price) * 100 : 0;
      expect(row.salePrice).toBe(product.price);
      expect(row.currentCost).toBe(product.cost);
      expect(row.currentProfitPerUnit).toBe(product.price - product.cost);
      expect(row.currentMarginPercent).toBeCloseTo(margin);
      expect(row.belowCost).toBe(product.price < product.cost);
      expect(row.lowMargin).toBe(margin >= 0 && margin < 5);
      expect(row.revenue).toBe(sold?.revenue ?? 0);
      expect(row.cost).toBe(sold?.cost ?? 0);
      expect(row.profit).toBe((sold?.revenue ?? 0) - (sold?.cost ?? 0));
    }
  });

  it.each(ranges)('top products %s .. %s', async (a, b) => {
    const got = await reports.topProducts(a, b, 5);
    const want = refTopProducts(books, a, b, 5);
    expect(got.map((x) => [x.name, x.revenue])).toEqual(want.map((x) => [x.name, x.revenue]));
    got.forEach((x, i) => expect(x.qty).toBeCloseTo(want[i]!.qty, 6));
  });

  it('daily bars', async () => {
    const days: [string, string][] = Array.from({ length: 7 }, (_, i) => [iso(BASE + (10 + i) * DAY), iso(BASE + (11 + i) * DAY - 1)]);
    expect(await reports.dailySales(days)).toEqual(refDaily(books, days));
  });

  it.each(ranges)('sales summary (all staff, then one cashier) %s .. %s', async (a, b) => {
    expect(await reports.salesSummary(a, b)).toEqual(refSalesSummary(books, a, b));
    expect(await reports.salesSummary(a, b, 'u-b')).toEqual(refSalesSummary(books, a, b, 'u-b'));
  });

  it('sales velocity', async () => {
    const since = iso(BASE + 40 * DAY);
    const got = await reports.salesVelocity(since);
    const want = refVelocity(books, since);
    expect(Object.keys(got).sort()).toEqual([...want.keys()].sort());
    for (const [k, v] of want) expect(got[k]).toBeCloseTo(v, 6);
  });

  it.each(ranges)('expenses and drawings %s .. %s', async (a, b) => {
    expect(await reports.expenses(a, b)).toEqual(refExpenseTotals(books, a, b));
  });

  it.each(ranges)('purchases %s .. %s', async (a, b) => {
    expect(await reports.purchases(a, b)).toEqual(refPurchases(books, a, b));
  });

  it.each(ranges)('cash breakdown %s .. %s', async (a, b) => {
    for (const acc of ['acc-cash', 'acc-bank', 'acc-none']) expect(await reports.cashBreakdown(acc, a, b)).toEqual(refCashBreakdown(books, acc, a, b));
  });

  it.each(ranges)('Easypaisa / JazzCash %s .. %s', async (a, b) => {
    for (const provider of ['easypaisa', 'jazzcash']) {
      expect(await reports.services(provider, a, b)).toEqual(refServiceSummary(books, provider, a, b));
      expect(await reports.services(provider, a, b, 'u-c')).toEqual(refServiceSummary(books, provider, a, b, 'u-c'));
    }
  });

  it('an empty range gives zeros, not errors', async () => {
    const [a, b] = ranges[5]!;
    const p = await reports.profit(a, b);
    expect(p).toMatchObject({ salesCount: 0, grossSales: 0, cogs: 0, netProfit: 0, expensesByCategory: {}, byPayment: {} });
    expect(await reports.productSales(a, b)).toEqual([]);
    expect(await reports.topProducts(a, b, 5)).toEqual([]);
  });

  it('cancelled sales are not counted as sales, returns reduce revenue once', async () => {
    const [a, b] = ranges[3]!;
    const p = await reports.profit(a, b);
    const completed = books.sales.filter((s) => s.status === 'completed');
    expect(p.salesCount).toBe(completed.length);
    expect(p.grossSales).toBe(completed.reduce((s, x) => s + x.total, 0));
    expect(p.revenue).toBe(p.grossSales - books.saleReturns.reduce((s, x) => s + x.amount, 0));
    expect((await reports.salesSummary(a, b)).cancelled).toBe(books.sales.length - completed.length);
  });

  it('khata totals equal the sum of positive balances', async () => {
    const store = new SqlShopStore(handle.db, tenant, null);
    const customers = [
      { id: 'c1', name: 'A', creditLimit: 1000 },
      { id: 'c2', name: 'B', creditLimit: 0 },
      { id: 'c3', name: 'C', creditLimit: 500 },
    ];
    for (const c of customers) await store.put('customers', c as never);
    const entries = [
      ['customer', 'c1', 800], ['customer', 'c1', 500], ['customer', 'c2', 300], ['customer', 'c3', 100], ['customer', 'c3', -300],
      ['supplier', 's1', 7000], ['supplier', 's1', -2000], ['supplier', 's2', -50],
    ] as const;
    for (const [i, [type, id, amount]] of entries.entries()) {
      await store.put('partyEntries', { id: `pe-${i}`, date: iso(BASE + i * DAY), partyType: type, partyId: id, amount, type: 'sale' } as never);
    }
    const k = await reports.khata();
    expect(k).toEqual({ customerDue: 1300 + 300, customersWithDue: 2, supplierDue: 5000, supplierAccounts: 2, overLimit: 1 });
  });

  it('another shop never leaks in', async () => {
    const [a, b] = ranges[3]!;
    const mine = await reports.profit(a, b);
    const theirs = await new ShopReports(handle.db, other).profit(a, b);
    expect(mine).not.toEqual(theirs);
    expect(await new ShopReports(handle.db, randomUUID()).profit(a, b)).toMatchObject({ salesCount: 0, grossSales: 0 });
    expect((await new ShopReports(handle.db, randomUUID()).khata()).customerDue).toBe(0);
  });

  it('reorder report equals the old browser calculation', async () => {
    const now = new Date(BASE + 95 * DAY + 13 * 3_600_000);
    const got = await reports.reorder({
      today: dayNumberOf(now.getTime(), now.getTimezoneOffset()),
      nowMs: now.getTime(),
      defaultLeadDays: 3,
      coverDays: 7,
      salesVelocityDays: 30,
      safetyStockDays: 2,
      lowStockDaysThreshold: 3,
      includeRows: true,
      showCost: true,
    });
    const want = refReorder(books.products, books.suppliers, books.stockMoves, 3, now, 7);
    // The database adds quantities exactly (DECIMAL); the old JavaScript added binary floats, so they can differ by ~1e-17.
    const norm = (v: unknown) => JSON.parse(JSON.stringify(v), (_k, x) => (typeof x === 'number' ? Math.round(x * 1e9) / 1e9 : x));
    expect(norm(got.rows)).toEqual(norm(want));
    expect(got.summary.outOfStock).toBe(books.products.filter((p) => p.active && p.stock <= 0).length);
  });

  it('reorder without cost permission hides cost prices', async () => {
    const now = Date.now();
    const got = await reports.reorder({
      today: dayNumberOf(now, 0),
      nowMs: now,
      defaultLeadDays: 3,
      coverDays: 7,
      salesVelocityDays: 30,
      safetyStockDays: 2,
      lowStockDaysThreshold: 3,
      includeRows: true,
      showCost: false,
    });
    expect(got.rows.every((x) => x.product.cost === 0)).toBe(true);
    expect(got.summary.stockValue).toBeNull();
  });

  it('computeReorder is independent of the server clock zone', () => {
    const products = [{ id: 'p', name: 'p', stock: 5, minStock: 2, active: true, supplierId: 's', cost: 1, price: 2 } as never];
    const suppliers = [{ id: 's', name: 's', leadDays: 2, orderDay: 5 } as never];
    const a = computeReorder({ products, suppliers, sold: new Map([['p', 30]]), today: dayNumberOf(Date.UTC(2026, 8, 30, 20), -300), defaultLeadDays: 3 });
    const b = computeReorder({ products, suppliers, sold: new Map([['p', 30]]), today: dayNumberOf(Date.UTC(2026, 9, 1, 0, 30), -300), defaultLeadDays: 3 });
    expect(a).toEqual(b); // 01:00 and 05:30 Karachi are the same shop day
  });
});
