/**
 * Report speed check on a large synthetic shop (not part of the test suite).
 *   REPORTS_TEST_URL=mysql://... npx tsx scripts/reports-perf.ts [sales]
 */
import { createDb } from '@retailos/db';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { uuidToBytes } from '@retailos/domain';
import { ShopReports } from '../src/modules/shop/reports.js';

const url = process.env.REPORTS_TEST_URL!;
const N = Number(process.argv[2] ?? 150_000);
const { db, pool, close } = createDb(url, { connectionLimit: 4 });
const DAY = 86_400_000;
const BASE = Date.UTC(2025, 9, 1);
await pool.query('DROP TABLE IF EXISTS shop_records');
for (const stmt of readFileSync(new URL('../../../packages/db/migrations/0009_shop_records.sql', import.meta.url), 'utf8').split('--> statement-breakpoint')) if (stmt.trim()) await pool.query(stmt);
const tenant = randomUUID();
const tid = Buffer.from(uuidToBytes(tenant));
let seed = 12345;
const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const rows: unknown[][] = [];
const flush = async () => {
  if (!rows.length) return;
  await pool.query('INSERT INTO shop_records (tenant_id, collection, id, k1, k2, k3, k4, data) VALUES ?', [rows.splice(0)]);
};
const add = async (c: string, id: string, k1: string, k2: string | null, k3: string | null, data: object) => {
  rows.push([tid, c, id, k1, k2, k3, null, JSON.stringify(data)]);
  if (rows.length >= 2000) await flush();
};
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const date = new Date(BASE + Math.floor(r() * 365 * DAY)).toISOString();
  const items = Array.from({ length: 1 + Math.floor(r() * 5) }, () => ({ productId: `p${Math.floor(r() * 3000)}`, name: 'Item', qty: 1 + Math.floor(r() * 4), price: 100 + Math.floor(r() * 900), cost: 80 + Math.floor(r() * 700), discount: 0, returnedQty: 0 }));
  const subtotal = items.reduce((s, x) => s + x.price * x.qty, 0);
  await add('sales', `s${i}`, date, null, r() > 0.03 ? 'completed' : 'void', { id: `s${i}`, date, status: 'completed', items, subtotal, total: subtotal, change: 0, credit: 0, userId: 'u1', payments: [{ accountId: 'acc-cash', amount: subtotal }] });
  if (i % 3 === 0) await add('stockMoves', `m${i}`, date, items[0]!.productId, 'sale', { id: `m${i}`, date, productId: items[0]!.productId, type: 'sale', qty: -items[0]!.qty, cost: 100 });
  if (i % 10 === 0) await add('expenses', `e${i}`, date, 'Rent', 'expense', { id: `e${i}`, date, kind: 'expense', category: 'Rent', amount: 5000 });
}
await flush();
console.log(`loaded ${N} sales (+ moves/expenses) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
await pool.query('ANALYZE TABLE shop_records');
const reports = new ShopReports(db, tenant);
const iso = (ms: number) => new Date(ms).toISOString();
const month: [string, string] = [iso(BASE + 100 * DAY), iso(BASE + 130 * DAY - 1)];
const year: [string, string] = [iso(BASE), iso(BASE + 366 * DAY)];
const time = async (label: string, fn: () => Promise<unknown>) => {
  const s = performance.now();
  const out = await fn();
  console.log(`${label.padEnd(34)} ${(performance.now() - s).toFixed(0).padStart(6)} ms  ${JSON.stringify(out).length} bytes`);
};
await time('profit (1 day)', () => reports.profit(iso(BASE + 100 * DAY), iso(BASE + 101 * DAY - 1)));
await time('profit (30 days)', () => reports.profit(...month));
await time('profit (1 year)', () => reports.profit(...year));
await time('product sales (30 days)', () => reports.productSales(...month));
await time('product sales (1 year)', () => reports.productSales(...year));
await time('top products (7 days)', () => reports.topProducts(iso(BASE + 100 * DAY), iso(BASE + 107 * DAY), 5));
await time('daily bars (7 days)', () => reports.dailySales(Array.from({ length: 7 }, (_, i) => [iso(BASE + (100 + i) * DAY), iso(BASE + (101 + i) * DAY - 1)] as [string, string])));
await time('sales summary (1 year)', () => reports.salesSummary(...year));
await time('sales velocity (30 days)', () => reports.salesVelocity(iso(BASE + 335 * DAY)));
await time('reorder (3000 products none)', () => reports.reorder({ today: 20000, nowMs: BASE + 365 * DAY, defaultLeadDays: 2, coverDays: 7, includeRows: false, showCost: true }));
// What the browser used to download for the same reports: every raw record behind them (JSON bytes), versus the finished figures now.
const rawBytes = async (collections: string[], range: [string, string]) => {
  const [rows] = (await pool.query(
    `SELECT COALESCE(SUM(LENGTH(CAST(data AS CHAR))), 0) AS b, COUNT(*) AS c FROM shop_records WHERE tenant_id = ? AND collection IN (?) AND k1 BETWEEN ? AND ?`,
    [tid, collections, range[0], range[1]],
  )) as any;
  return { bytes: Number(rows[0].b), records: Number(rows[0].c) };
};
const profitCollections = ['sales', 'saleReturns', 'expenses', 'stockMoves', 'serviceTxns'];
const day: [string, string] = [iso(BASE + 100 * DAY), iso(BASE + 101 * DAY - 1)];
const week: [string, string] = [iso(BASE + 94 * DAY), iso(BASE + 101 * DAY - 1)];
const sizeOf = async (fn: () => Promise<unknown>) => JSON.stringify(await fn()).length;
console.log('\nreport'.padEnd(34), 'before (raw records)'.padEnd(28), 'after (figures)');
for (const [label, range] of [['profit, 1 day', day], ['profit, 7 days', week], ['profit, 30 days', month], ['profit, 1 year', year]] as const) {
  const before = await rawBytes(profitCollections, range);
  const after = await sizeOf(() => reports.profit(...range));
  console.log(label.padEnd(33), `${(before.bytes / 1024).toFixed(0)} KB / ${before.records} records`.padEnd(28), `${after} B`);
}
const velBefore = await rawBytes(['sales'], [iso(BASE + 335 * DAY), iso(BASE + 366 * DAY)]);
console.log('POS ranking (30 days)'.padEnd(33), `${(velBefore.bytes / 1024).toFixed(0)} KB / ${velBefore.records} records`.padEnd(28), `${await sizeOf(() => reports.salesVelocity(iso(BASE + 335 * DAY)))} B`);
const sm = await rawBytes(['sales'], year);
console.log('Sales stat cards (1 year)'.padEnd(33), `${(sm.bytes / 1024).toFixed(0)} KB / ${sm.records} records`.padEnd(28), `${await sizeOf(() => reports.salesSummary(...year))} B`);

// How the database finds the rows (key = index used, rows = estimate): every report is an index range scan.
const hex = tid.toString('hex');
const explain: [string, string][] = [
  ['completed bills in a range', `s.collection = 'sales' AND s.k3 = 'completed' AND s.k1 BETWEEN '${month[0]}' AND '${month[1]}'`],
  ['expenses / stock moves in a range', `s.collection = 'expenses' AND s.k1 BETWEEN '${month[0]}' AND '${month[1]}'`],
  ['one product movements', `s.collection = 'stockMoves' AND s.k2 = 'p1' AND s.k1 >= '${month[0]}'`],
  ['khata of one party', `s.collection = 'partyEntries' AND s.k2 = 'customer:c1'`],
];
for (const [name, where] of explain) {
  const [plan] = (await pool.query(`EXPLAIN SELECT SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(s.data, '$.total')) AS SIGNED)) FROM shop_records s WHERE s.tenant_id = 0x${hex} AND ${where}`)) as any;
  console.log(name.padEnd(36), JSON.stringify(plan.map((p: any) => ({ type: p.type, key: p.key, rows: p.rows }))));
}
await pool.query('DROP TABLE IF EXISTS shop_records');
await close();
