import { computeReorder, stockValueOf, uuidToBytes, type Product, type ReorderRow, type Supplier } from '@retailos/domain';
import type { DbOrTx } from '@retailos/db';
import { sql, type SQL } from 'drizzle-orm';

/**
 * Report calculations, done by the database.
 *
 * Every figure is a SQL aggregate (SUM / COUNT / GROUP BY / JOIN over JSON_TABLE for bill lines) over the
 * indexed columns of `shop_records`: `tenant_id` + `collection` pick the shop's records, `k1` is the date
 * and `k3` the status/type, so a date range is an index range scan and nothing is sent to the browser except
 * the finished numbers.
 *
 * These reproduce, number for number, what the browser used to calculate from raw records:
 *  - Money per line is `Math.round(price * qty)`. In SQL that is `FLOOR(price * qty + 0.5)` on DOUBLEs: the
 *    same IEEE arithmetic and the same round-half-up (MySQL's own ROUND() rounds halves to even, which would differ).
 *  - String keys are grouped with `utf8mb4_bin` so 'Rent' and 'rent' stay different, as they were in JavaScript.
 *  - "First seen" ordering (ties in rankings, key order of objects) is kept by taking MIN() of a (date, id, line) sort key,
 *    which needs no sort of the rows (window functions were an order of magnitude slower on a year of bills).
 * Role rules (who may see cost, which bills a person may see) are applied by the callers in routes.ts.
 */

const BIN = sql.raw('COLLATE utf8mb4_bin');
/** An integer field of the record's JSON, as a number the database can add up. */
const int = (path: string, alias = 's') => {
  if (!/^[A-Za-z0-9]+$/.test(path)) throw new Error('Invalid field name');
  return sql.raw(`CAST(JSON_UNQUOTE(JSON_EXTRACT(${alias}.data, '$.${path}')) AS SIGNED)`);
};

export interface ProfitSummary {
  salesCount: number;
  grossSales: number;
  returns: number;
  revenue: number;
  cogs: number;
  grossProfit: number;
  expenses: number;
  stockLoss: number;
  serviceIncome: number;
  netProfit: number;
  drawings: number;
  expensesByCategory: Record<string, number>;
  byPayment: Record<string, number>;
  creditSales: number;
}

export interface ProductSalesRow {
  productId: string;
  name: string;
  qty: number;
  revenue: number;
  cost: number;
  profit: number;
}

export interface ProductPerformanceRow extends ProductSalesRow {
  currentCost: number;
  salePrice: number;
  currentProfitPerUnit: number;
  currentProfitPercent: number;
  currentMarginPercent: number;
  historicalProfitPercent: number;
  historicalMarginPercent: number;
  belowCost: boolean;
  lowMargin: boolean;
}

export interface ProductPairRow {
  productAId: string;
  productAName: string;
  productAQty: number;
  productBId: string;
  productBName: string;
  productBQty: number;
  bills: number;
}

export interface ReorderResult {
  rows: ReorderRow[];
  summary: {
    activeProducts: number;
    stockValue: number | null;
    orderNow: number;
    reorderSoon: number;
    outOfStock: number;
  };
}

/** A name carried through a MIN/MAX over `sortkey CHAR(2) name`: everything after the first separator. */
const nameOf = (named: string) => named.slice(named.indexOf('') + 1);
const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

export class ShopReports {
  private readonly tid: Buffer;
  constructor(
    private readonly db: DbOrTx,
    tenantId: string,
  ) {
    this.tid = Buffer.from(uuidToBytes(tenantId));
  }

  private async rows<T>(query: SQL): Promise<T[]> {
    const [result] = (await this.db.execute(query)) as unknown as [T[]];
    return result;
  }

  /** `FROM shop_records s` restricted to one shop and one collection (the shop is never optional). */
  private from(collection: string): SQL {
    return sql`shop_records s WHERE s.tenant_id = ${this.tid} AND s.collection = ${collection}`;
  }

  // ------------------------------------------------------------------ profit and loss

  async profit(start: string, end: string): Promise<ProfitSummary> {
    const range = sql`s.k1 BETWEEN ${start} AND ${end}`;
    const completed = sql`s.k3 = 'completed' AND ${range}`;
    // Lines of bills: one row per bill line, with the bill's own fields beside it.
    const lines = (collection: string, where: SQL, cols: string) =>
      sql`FROM shop_records s, JSON_TABLE(s.data, '$' COLUMNS (NESTED PATH '$.items[*]' COLUMNS (${sql.raw(cols)}))) jt WHERE s.tenant_id = ${this.tid} AND s.collection = ${collection} AND ${where}`;

    const [sales, saleCogs, byPayment, returns, returnCogs, expenses, loss, services] = await Promise.all([
      this.rows<{ n: number; gross: string; credit: string }>(
        sql`SELECT COUNT(*) AS n, COALESCE(SUM(${int('total')}), 0) AS gross, COALESCE(SUM(${int('credit')}), 0) AS credit FROM ${this.from('sales')} AND ${completed}`,
      ),
      this.rows<{ v: string }>(sql`SELECT COALESCE(SUM(FLOOR(jt.cost * jt.qty + 0.5)), 0) AS v ${lines('sales', completed, 'cost DOUBLE PATH "$.cost", qty DOUBLE PATH "$.qty"')}`),
      // Each payment, with the change handed back taken off the cash one. First-seen order is kept for display.
      this.rows<{ acc: string; v: string; first: number }>(sql`
        SELECT x.acc AS acc, CAST(SUM(x.amt) AS SIGNED) AS v, MIN(x.seq) AS first FROM (
          SELECT jt.acc AS acc,
                 IF(jt.acc = 'acc-cash', jt.amount - ${int('change')}, jt.amount) AS amt,
                 CAST(CONCAT(s.k1, CHAR(1), s.id, CHAR(1), LPAD(jt.ord, 6, '0')) AS BINARY) AS seq
          FROM shop_records s, JSON_TABLE(s.data, '$.payments[*]' COLUMNS (ord FOR ORDINALITY, acc VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin PATH '$.accountId', amount DOUBLE PATH '$.amount')) jt
          WHERE s.tenant_id = ${this.tid} AND s.collection = 'sales' AND ${completed}
        ) x GROUP BY x.acc ORDER BY first`),
      this.rows<{ v: string }>(sql`SELECT COALESCE(SUM(${int('amount')}), 0) AS v FROM ${this.from('saleReturns')} AND ${range}`),
      this.rows<{ v: string }>(sql`SELECT COALESCE(SUM(FLOOR(jt.cost * jt.qty + 0.5)), 0) AS v ${lines('saleReturns', range, 'cost DOUBLE PATH "$.cost", qty DOUBLE PATH "$.qty"')}`),
      this.rows<{ kind: string; category: string; v: string; first: number }>(sql`
        SELECT x.kind AS kind, x.category AS category, CAST(SUM(x.amount) AS SIGNED) AS v, MIN(x.seq) AS first FROM (
          SELECT s.k3 COLLATE utf8mb4_bin AS kind, s.k2 COLLATE utf8mb4_bin AS category, ${int('amount')} AS amount, CAST(CONCAT(s.k1, CHAR(1), s.id) AS BINARY) AS seq
          FROM ${this.from('expenses')} AND ${range}
        ) x GROUP BY x.kind, x.category ORDER BY first`),
      // Damaged, expired and written-down stock, at the cost recorded when it moved.
      this.rows<{ v: string }>(sql`
        SELECT COALESCE(SUM(FLOOR(jt.cost * (-jt.qty) + 0.5)), 0) AS v
        FROM shop_records s, JSON_TABLE(s.data, '$' COLUMNS (cost DOUBLE PATH '$.cost', qty DOUBLE PATH '$.qty')) jt
        WHERE s.tenant_id = ${this.tid} AND s.collection = 'stockMoves' AND ${range}
          AND (s.k3 IN ('damage', 'expiry') OR (s.k3 = 'adjust' AND jt.qty < 0))`),
      this.rows<{ v: string }>(sql`SELECT COALESCE(SUM(${int('commission')} + ${int('fee')}), 0) AS v FROM ${this.from('serviceTxns')} AND ${range}`),
    ]);

    const grossSales = n(sales[0]?.gross);
    const returnsTotal = n(returns[0]?.v);
    const cogs = n(saleCogs[0]?.v) - n(returnCogs[0]?.v);
    const revenue = grossSales - returnsTotal;
    const expensesByCategory: Record<string, number> = {};
    let expenseTotal = 0;
    let drawings = 0;
    for (const e of expenses) {
      if (e.kind === 'expense') {
        expensesByCategory[e.category] = (expensesByCategory[e.category] ?? 0) + n(e.v);
        expenseTotal += n(e.v);
      } else if (e.kind === 'drawing') drawings += n(e.v);
    }
    const payment: Record<string, number> = {};
    for (const p of byPayment) payment[p.acc] = n(p.v);
    const stockLoss = n(loss[0]?.v);
    const serviceIncome = n(services[0]?.v);
    const grossProfit = revenue - cogs;
    return {
      salesCount: n(sales[0]?.n),
      grossSales,
      returns: returnsTotal,
      revenue,
      cogs,
      grossProfit,
      expenses: expenseTotal,
      stockLoss,
      serviceIncome,
      netProfit: grossProfit + serviceIncome - expenseTotal - stockLoss,
      drawings,
      expensesByCategory,
      byPayment: payment,
      creditSales: n(sales[0]?.credit),
    };
  }

  /** Units, revenue (after the bill-level discount) and cost per product, biggest revenue first. */
  async productSales(start: string, end: string): Promise<ProductSalesRow[]> {
    const rows = await this.rows<{ pid: string; named: string; qty: string; revenue: string; cost: string }>(sql`
      SELECT x.pid AS pid, CONVERT(MIN(x.named) USING utf8mb4) AS named, SUM(x.qty) AS qty, CAST(SUM(x.rev) AS SIGNED) AS revenue, CAST(SUM(x.cost) AS SIGNED) AS cost
      FROM (
        SELECT jt.pid AS pid,
               CAST(CONCAT(s.k1, CHAR(1), s.id, CHAR(1), LPAD(jt.ord, 6, '0'), CHAR(2), jt.name) AS BINARY) AS named,
               jt.qty AS qty,
               FLOOR((FLOOR(jt.price * jt.qty + 0.5) - jt.discount) * IF(jt.subtotal > 0, jt.total / jt.subtotal, 1) + 0.5) AS rev,
               FLOOR(jt.cost * jt.qty + 0.5) AS cost,
               CAST(CONCAT(s.k1, CHAR(1), s.id, CHAR(1), LPAD(jt.ord, 6, '0')) AS BINARY) AS seq
        FROM shop_records s,
          JSON_TABLE(s.data, '$' COLUMNS (total DOUBLE PATH '$.total', subtotal DOUBLE PATH '$.subtotal',
            NESTED PATH '$.items[*]' COLUMNS (ord FOR ORDINALITY, pid VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin PATH '$.productId', name VARCHAR(200) PATH '$.name',
              qty DOUBLE PATH '$.qty', price DOUBLE PATH '$.price', discount DOUBLE PATH '$.discount', cost DOUBLE PATH '$.cost'))) jt
        WHERE s.tenant_id = ${this.tid} AND s.collection = 'sales' AND s.k3 = 'completed' AND s.k1 BETWEEN ${start} AND ${end}
      ) x GROUP BY x.pid ORDER BY SUM(x.rev) DESC, MIN(x.seq)`);
    return rows.map((r) => ({ productId: r.pid, name: nameOf(r.named), qty: n(r.qty), revenue: n(r.revenue), cost: n(r.cost), profit: n(r.revenue) - n(r.cost) }));
  }

  /** Recent product sales plus current unit economics, aggregated before data leaves the database. */
  async productPerformance(start: string, end: string, minimumMarginPct: number): Promise<ProductPerformanceRow[]> {
    const [sales, productRows] = await Promise.all([
      this.productSales(start, end),
      this.rows<{ data: Product | string }>(sql`SELECT s.data AS data FROM ${this.from('products')}`),
    ]);
    const parse = (value: Product | string): Product => typeof value === 'string' ? JSON.parse(value) as Product : value;
    const salesByProduct = new Map(sales.map((row) => [row.productId, row]));
    return productRows
      .map(({ data }) => parse(data))
      .filter((product) => product.active && !product.isService)
      .map((product) => {
        const sold = salesByProduct.get(product.id);
        const revenue = sold?.revenue ?? 0;
        const cost = sold?.cost ?? 0;
        const profit = revenue - cost;
        const currentProfitPerUnit = product.salePrice - product.cost;
        const currentMarginPercent = product.salePrice > 0 ? (currentProfitPerUnit / product.salePrice) * 100 : 0;
        return {
          productId: product.id,
          name: product.name,
          qty: sold?.qty ?? 0,
          revenue,
          cost,
          profit,
          currentCost: product.cost,
          salePrice: product.salePrice,
          currentProfitPerUnit,
          currentProfitPercent: product.cost > 0 ? (currentProfitPerUnit / product.cost) * 100 : 0,
          currentMarginPercent,
          historicalProfitPercent: cost > 0 ? (profit / cost) * 100 : 0,
          historicalMarginPercent: revenue > 0 ? (profit / revenue) * 100 : 0,
          belowCost: product.salePrice < product.cost,
          lowMargin: currentMarginPercent >= 0 && currentMarginPercent < minimumMarginPct,
        };
      })
      .sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name));
  }

  /** Product and quantity combinations that occurred together on completed invoices. */
  async productPairs(start: string, end: string, limit: number): Promise<ProductPairRow[]> {
    const rows = await this.rows<{
      aid: string; aname: string; aqty: string; bid: string; bname: string; bqty: string; bills: number;
    }>(sql`
      SELECT a.pid AS aid, CONVERT(MIN(a.name) USING utf8mb4) AS aname, a.qty AS aqty,
             b.pid AS bid, CONVERT(MIN(b.name) USING utf8mb4) AS bname, b.qty AS bqty,
             COUNT(DISTINCT s.id) AS bills
      FROM shop_records s,
        JSON_TABLE(s.data, '$.items[*]' COLUMNS (
          pid VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin PATH '$.productId',
          name VARCHAR(200) CHARACTER SET utf8mb4 PATH '$.name',
          qty DOUBLE PATH '$.qty'
        )) a,
        JSON_TABLE(s.data, '$.items[*]' COLUMNS (
          pid VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin PATH '$.productId',
          name VARCHAR(200) CHARACTER SET utf8mb4 PATH '$.name',
          qty DOUBLE PATH '$.qty'
        )) b
      WHERE s.tenant_id = ${this.tid} AND s.collection = 'sales' AND s.k3 = 'completed'
        AND s.k1 BETWEEN ${start} AND ${end} AND a.pid < b.pid
      GROUP BY a.pid, a.qty, b.pid, b.qty
      HAVING COUNT(DISTINCT s.id) >= 2
      ORDER BY bills DESC, a.pid, b.pid, a.qty, b.qty
      LIMIT ${limit}`);
    return rows.map((row) => ({
      productAId: row.aid,
      productAName: row.aname,
      productAQty: n(row.aqty),
      productBId: row.bid,
      productBName: row.bname,
      productBQty: n(row.bqty),
      bills: n(row.bills),
    }));
  }

  /** Best sellers for the dashboard: ranked by quantity, no cost involved. Newest bill wins the name and ties. */
  async topProducts(start: string, end: string, limit: number): Promise<{ productId: string; name: string; qty: number; revenue: number }[]> {
    const rows = await this.rows<{ pid: string; named: string; qty: string; revenue: string }>(sql`
      SELECT x.pid AS pid, CONVERT(MAX(x.named) USING utf8mb4) AS named, SUM(x.qty) AS qty, CAST(SUM(x.rev) AS SIGNED) AS revenue
      FROM (
        SELECT jt.pid AS pid,
               CAST(CONCAT(s.k1, CHAR(1), s.id, CHAR(1), LPAD(999999 - jt.ord, 6, '0'), CHAR(2), jt.name) AS BINARY) AS named,
               jt.qty AS qty, FLOOR(jt.price * jt.qty + 0.5) - jt.discount AS rev,
               CAST(CONCAT(s.k1, CHAR(1), s.id, CHAR(1), LPAD(999999 - jt.ord, 6, '0')) AS BINARY) AS seq
        FROM shop_records s,
          JSON_TABLE(s.data, '$' COLUMNS (NESTED PATH '$.items[*]' COLUMNS (ord FOR ORDINALITY, pid VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin PATH '$.productId', name VARCHAR(200) PATH '$.name',
            qty DOUBLE PATH '$.qty', price DOUBLE PATH '$.price', discount DOUBLE PATH '$.discount'))) jt
        WHERE s.tenant_id = ${this.tid} AND s.collection = 'sales' AND s.k3 = 'completed' AND s.k1 BETWEEN ${start} AND ${end}
      ) x GROUP BY x.pid ORDER BY SUM(x.qty) DESC, MAX(x.seq) DESC LIMIT ${limit}`);
    return rows.map((r) => ({ productId: r.pid, name: nameOf(r.named), qty: n(r.qty), revenue: n(r.revenue) }));
  }

  /** Bills and sales total for several date ranges in one pass (the dashboard's seven bars). */
  async dailySales(ranges: [string, string][]): Promise<{ count: number; total: number }[]> {
    if (ranges.length === 0) return [];
    const lo = ranges.reduce((a, r) => (r[0] < a ? r[0] : a), ranges[0]![0]);
    const hi = ranges.reduce((a, r) => (r[1] > a ? r[1] : a), ranges[0]![1]);
    const cols = ranges.flatMap(([a, b], i) => [
      sql`COUNT(CASE WHEN s.k1 BETWEEN ${a} AND ${b} THEN 1 END) AS ${sql.raw(`c${i}`)}`,
      sql`COALESCE(SUM(CASE WHEN s.k1 BETWEEN ${a} AND ${b} THEN ${int('total')} END), 0) AS ${sql.raw(`t${i}`)}`,
    ]);
    const [row] = await this.rows<Record<string, unknown>>(
      sql`SELECT ${sql.join(cols, sql`, `)} FROM ${this.from('sales')} AND s.k3 = 'completed' AND s.k1 BETWEEN ${lo} AND ${hi}`,
    );
    return ranges.map((_, i) => ({ count: n(row?.[`c${i}`]), total: n(row?.[`t${i}`]) }));
  }

  /** Stat cards of the Sales screen. `onlyUserId` limits it to one person's own bills. */
  async salesSummary(start: string, end: string, onlyUserId?: string) {
    const own = onlyUserId ? sql` AND JSON_UNQUOTE(JSON_EXTRACT(s.data, '$.userId')) = ${onlyUserId}` : sql``;
    const [bills, returns] = await Promise.all([
      this.rows<{ status: string; c: number; total: string }>(
        sql`SELECT s.k3 AS status, COUNT(*) AS c, COALESCE(SUM(${int('total')}), 0) AS total FROM ${this.from('sales')} AND s.k1 BETWEEN ${start} AND ${end}${own} GROUP BY s.k3`,
      ),
      this.rows<{ v: string }>(sql`SELECT COALESCE(SUM(${int('amount')}), 0) AS v FROM ${this.from('saleReturns')} AND s.k1 BETWEEN ${start} AND ${end}${own}`),
    ]);
    const completed = bills.find((b) => b.status === 'completed');
    return { bills: n(completed?.c), total: n(completed?.total), returns: n(returns[0]?.v), cancelled: n(bills.find((b) => b.status === 'void')?.c) };
  }

  /** Units sold per product since a date (completed bills, minus returned units): ranks the POS grid. */
  async salesVelocity(since: string): Promise<Record<string, number>> {
    const rows = await this.rows<{ pid: string; q: string }>(sql`
      SELECT jt.pid AS pid, SUM(GREATEST(0, jt.qty - COALESCE(jt.returned, 0))) AS q
      FROM shop_records s, JSON_TABLE(s.data, '$' COLUMNS (NESTED PATH '$.items[*]' COLUMNS (pid VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin PATH '$.productId', qty DOUBLE PATH '$.qty', returned DOUBLE PATH '$.returnedQty'))) jt
      WHERE s.tenant_id = ${this.tid} AND s.collection = 'sales' AND s.k3 = 'completed' AND s.k1 >= ${since}
      GROUP BY jt.pid`);
    return Object.fromEntries(rows.map((r) => [r.pid, n(r.q)]));
  }

  // ------------------------------------------------------------------ money and stock

  async expenses(start: string, end: string) {
    const rows = await this.rows<{ kind: string; category: string; v: string; first: number }>(sql`
      SELECT x.kind AS kind, x.category AS category, CAST(SUM(x.amount) AS SIGNED) AS v, MIN(x.seq) AS first FROM (
        SELECT s.k3 COLLATE utf8mb4_bin AS kind, s.k2 COLLATE utf8mb4_bin AS category, ${int('amount')} AS amount, CAST(CONCAT(s.k1, CHAR(1), s.id) AS BINARY) AS seq
        FROM ${this.from('expenses')} AND s.k1 BETWEEN ${start} AND ${end}
      ) x GROUP BY x.kind, x.category ORDER BY first`);
    const byCategory: [string, number][] = [];
    const seen = new Map<string, number>();
    let expenseTotal = 0;
    let drawingTotal = 0;
    for (const r of rows) {
      if (r.kind === 'expense') {
        expenseTotal += n(r.v);
        const at = seen.get(r.category);
        if (at === undefined) {
          seen.set(r.category, byCategory.length);
          byCategory.push([r.category, n(r.v)]);
        } else byCategory[at]![1] += n(r.v);
      } else if (r.kind === 'drawing') drawingTotal += n(r.v);
    }
    return { expenseTotal, drawingTotal, byCategory };
  }

  async purchases(start: string, end: string) {
    const [row] = await this.rows<{ c: number; total: string; paid: string }>(
      sql`SELECT COUNT(*) AS c, COALESCE(SUM(${int('total')}), 0) AS total, COALESCE(SUM(${int('paid')}), 0) AS paid FROM ${this.from('purchases')} AND s.k1 BETWEEN ${start} AND ${end}`,
    );
    return { count: n(row?.c), total: n(row?.total), paid: n(row?.paid) };
  }

  /** One account's money movements by type for a date range (the Cash screen's breakdown). */
  async cashBreakdown(accountId: string, start: string, end: string): Promise<[string, number][]> {
    const rows = await this.rows<{ type: string; v: string; first: number }>(sql`
      SELECT x.type AS type, CAST(SUM(x.amount) AS SIGNED) AS v, MIN(x.seq) AS first FROM (
        SELECT s.k3 COLLATE utf8mb4_bin AS type, ${int('amount')} AS amount, CAST(CONCAT(s.k1, CHAR(1), s.id) AS BINARY) AS seq
        FROM ${this.from('accountTxns')} AND s.k2 = ${accountId} ${BIN} AND s.k1 BETWEEN ${start} AND ${end}
      ) x GROUP BY x.type ORDER BY first`);
    return rows.map((r) => [r.type, n(r.v)]);
  }

  /** Easypaisa / JazzCash summary. `onlyUserId` limits it to one person's own transactions. */
  async services(provider: string, start: string, end: string, onlyUserId?: string) {
    const own = onlyUserId ? sql` AND JSON_UNQUOTE(JSON_EXTRACT(s.data, '$.userId')) = ${onlyUserId}` : sql``;
    const [row] = await this.rows<Record<string, unknown>>(sql`
      SELECT COUNT(*) AS c,
             COALESCE(SUM(CASE WHEN s.k3 IN ('cash_in', 'send_money', 'bill', 'load') THEN ${int('amount')} END), 0) AS cash_in,
             COALESCE(SUM(CASE WHEN s.k3 = 'cash_out' THEN ${int('amount')} END), 0) AS cash_out,
             COALESCE(SUM(${int('amount')}), 0) AS volume,
             COALESCE(SUM(${int('commission')}), 0) AS commission,
             COALESCE(SUM(${int('fee')}), 0) AS fees
      FROM ${this.from('serviceTxns')} AND s.k2 = ${provider} ${BIN} AND s.k1 BETWEEN ${start} AND ${end}${own}`);
    return { count: n(row?.c), cashIn: n(row?.cash_in), cashOut: n(row?.cash_out), volume: n(row?.volume), commission: n(row?.commission), fees: n(row?.fees) };
  }

  // ------------------------------------------------------------------ khata

  /** Customer credit and supplier dues, summed in the database (no per-person data leaves it). */
  async khata() {
    const [customers, suppliers, over] = await Promise.all([
      this.rows<{ due: string; people: number }>(sql`
        SELECT COALESCE(SUM(GREATEST(b.bal, 0)), 0) AS due, COALESCE(SUM(b.bal > 0), 0) AS people
        FROM (SELECT SUM(${int('amount')}) AS bal FROM ${this.from('partyEntries')} AND s.k2 LIKE 'customer:%' GROUP BY s.k2) b`),
      this.rows<{ due: string; accounts: number }>(sql`
        SELECT COALESCE(SUM(GREATEST(b.bal, 0)), 0) AS due, COUNT(*) AS accounts
        FROM (SELECT SUM(${int('amount')}) AS bal FROM ${this.from('partyEntries')} AND s.k2 LIKE 'supplier:%' GROUP BY s.k2) b`),
      this.rows<{ c: number }>(sql`
        SELECT COUNT(*) AS c FROM (
          SELECT SUBSTRING(s.k2, 10) AS cid, SUM(${int('amount')}) AS bal FROM ${this.from('partyEntries')} AND s.k2 LIKE 'customer:%' GROUP BY s.k2
        ) b JOIN shop_records c ON c.tenant_id = ${this.tid} AND c.collection = 'customers' AND c.id = b.cid
        WHERE ${int('creditLimit', 'c')} > 0 AND b.bal > ${int('creditLimit', 'c')}`),
    ]);
    return {
      customerDue: n(customers[0]?.due),
      customersWithDue: n(customers[0]?.people),
      supplierDue: n(suppliers[0]?.due),
      supplierAccounts: n(suppliers[0]?.accounts),
      overLimit: n(over[0]?.c),
    };
  }

  // ------------------------------------------------------------------ stock

  /** Units sold in the last 30 days per product (sales and returns), summed in the database. */
  private async soldSince(sinceIso: string): Promise<Map<string, number>> {
    const rows = await this.rows<{ pid: string; q: string }>(sql`
      SELECT s.k2 AS pid, SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(s.data, '$.qty')) AS DECIMAL(20, 3))) AS q
      FROM ${this.from('stockMoves')} AND s.k3 IN ('sale', 'return') AND s.k1 >= ${sinceIso} GROUP BY s.k2`);
    return new Map(rows.map((r) => [r.pid, -n(r.q)]));
  }

  /** Which products to reorder, plus the stock figures for the cards. */
  async reorder(opts: {
    today: number;
    nowMs: number;
    defaultLeadDays: number;
    coverDays: number;
    salesVelocityDays: number;
    safetyStockDays: number;
    lowStockDaysThreshold: number;
    includeRows: boolean;
    showCost: boolean;
  }): Promise<ReorderResult> {
    const since = new Date(opts.nowMs - opts.salesVelocityDays * 86_400_000).toISOString();
    const [productRows, supplierRows, sold, lastSales] = await Promise.all([
      this.rows<{ data: Product | string }>(sql`SELECT s.data AS data FROM ${this.from('products')}`),
      this.rows<{ data: Supplier | string }>(sql`SELECT s.data AS data FROM ${this.from('suppliers')}`),
      this.soldSince(since),
      this.rows<{ productId: string; lastSale: string }>(sql`
        SELECT s.k2 AS productId, MAX(s.k1) AS lastSale
        FROM ${this.from('stockMoves')} AND s.k3 = 'sale'
        GROUP BY s.k2`),
    ]);
    const parse = <T>(v: T | string): T => (typeof v === 'string' ? (JSON.parse(v) as T) : v);
    const products = productRows.map((r) => parse<Product>(r.data));
    const lastSaleDays = new Map(lastSales.map((row) => [row.productId, Math.max(0, Math.floor((opts.nowMs - Date.parse(row.lastSale)) / 86_400_000))]));
    const rows = computeReorder({
      products,
      suppliers: supplierRows.map((r) => parse<Supplier>(r.data)),
      sold,
      today: opts.today,
      defaultLeadDays: opts.defaultLeadDays,
      coverDays: opts.coverDays,
      salesVelocityDays: opts.salesVelocityDays,
      safetyStockDays: opts.safetyStockDays,
      lowStockDaysThreshold: opts.lowStockDaysThreshold,
    }).map((row) => ({ ...row, lastSaleDays: lastSaleDays.get(row.product.id) ?? null }));
    const active = products.filter((p) => p.active);
    return {
      rows: opts.includeRows ? rows.map((r) => (opts.showCost ? r : { ...r, product: { ...r.product, cost: 0 } })) : [],
      summary: {
        activeProducts: active.length,
        stockValue: opts.showCost ? stockValueOf(active) : null,
        orderNow: rows.filter((r) => r.status === 'order_now').length,
        reorderSoon: rows.filter((r) => r.status === 'reorder_soon').length,
        outOfStock: active.filter((p) => p.stock <= 0).length,
      },
    };
  }
}
