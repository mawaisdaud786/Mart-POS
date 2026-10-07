import { db, type Account, type Product } from './db';
import { lineTotal, rangeIso } from './format';
import { apiRequest } from './api';

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

/**
 * Profit for a date range (local days, inclusive):
 *   revenue = sales − returns,  gross profit = revenue − cost of goods sold,
 *   net profit = gross profit + Easypaisa/JazzCash income − expenses − damaged/expired stock.
 * Owner withdrawals are shown separately and are NOT expenses.
 */
export async function profitSummary(from: string, to: string): Promise<ProfitSummary> {
  const [start, end] = rangeIso(from, to);
  const sales = (await db.sales.where('date').between(start, end, true, true).toArray()).filter((s) => s.status === 'completed');
  const returns = await db.saleReturns.where('date').between(start, end, true, true).toArray();
  const expenses = await db.expenses.where('date').between(start, end, true, true).toArray();
  const moves = await db.stockMoves.where('date').between(start, end, true, true).toArray();
  const services = await db.serviceTxns.where('date').between(start, end, true, true).toArray();

  const grossSales = sales.reduce((s, x) => s + x.total, 0);
  const returnsTotal = returns.reduce((s, r) => s + r.amount, 0);
  const saleCogs = sales.reduce((s, x) => s + x.items.reduce((a, i) => a + lineTotal(i.cost, i.qty), 0), 0);
  const returnCogs = returns.reduce((s, r) => s + r.items.reduce((a, i) => a + lineTotal(i.cost, i.qty), 0), 0);
  const cogs = saleCogs - returnCogs;
  const revenue = grossSales - returnsTotal;
  const opExpenses = expenses.filter((e) => e.kind === 'expense');
  const expenseTotal = opExpenses.reduce((s, e) => s + e.amount, 0);
  const drawings = expenses.filter((e) => e.kind === 'drawing').reduce((s, e) => s + e.amount, 0);
  const stockLoss = moves
    .filter((m) => m.type === 'damage' || m.type === 'expiry' || (m.type === 'adjust' && m.qty < 0))
    .reduce((s, m) => s + lineTotal(m.cost, -m.qty), 0);
  const serviceIncome = services.reduce((s, t) => s + t.commission + t.fee, 0);

  const expensesByCategory: Record<string, number> = {};
  for (const e of opExpenses) expensesByCategory[e.category] = (expensesByCategory[e.category] ?? 0) + e.amount;

  const byPayment: Record<string, number> = {};
  for (const s of sales) {
    for (const p of s.payments) {
      const amount = p.accountId === 'acc-cash' ? p.amount - s.change : p.amount;
      byPayment[p.accountId] = (byPayment[p.accountId] ?? 0) + amount;
    }
  }

  const grossProfit = revenue - cogs;
  return {
    salesCount: sales.length,
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
    byPayment,
    creditSales: sales.reduce((s, x) => s + x.credit, 0),
  };
}

export async function accountBalances(): Promise<Array<Account & { balance: number }>> {
  const accounts = await db.accounts.toArray();
  const txns = await db.accountTxns.toArray();
  const totals = new Map<string, number>();
  for (const t of txns) totals.set(t.accountId, (totals.get(t.accountId) ?? 0) + t.amount);
  return accounts.filter((a) => a.active).map((a) => ({ ...a, balance: totals.get(a.id) ?? 0 }));
}

/** Balance per customer (they owe us) or supplier (we owe them). */
export async function partyBalances(partyType: 'customer' | 'supplier'): Promise<Map<string, number>> {
  const entries = await db.partyEntries.where('partyType').equals(partyType).toArray();
  const map = new Map<string, number>();
  for (const e of entries) map.set(e.partyId, (map.get(e.partyId) ?? 0) + e.amount);
  return map;
}

export function stockValue(products: Product[]): number {
  return products.reduce((s, p) => s + (p.stock > 0 ? lineTotal(p.cost, p.stock) : 0), 0);
}

export type ReorderStatus = 'order_now' | 'reorder_soon' | 'ok' | 'no_sales';

export interface ReorderRow {
  product: Product;
  avgDaily: number;
  daysLeft: number | null;
  reorderBy: string | null;
  deliveryOn: string | null;
  reorderPoint: number;
  suggestedQty: number;
  suggestedPacks: number | null;
  status: ReorderStatus;
  lastSaleDays?: number | null;
}

/** Server-aggregated stock forecast; live POS pages no longer load stock movements for this report. */
export async function reorderReport(
  defaultLeadDays: number,
  options: { coverDays?: number; salesVelocityDays?: number; safetyStockDays?: number; lowStockDaysThreshold?: number } = {},
): Promise<ReorderRow[]> {
  const query = new URLSearchParams({
    now: String(Date.now()),
    tz: String(new Date().getTimezoneOffset()),
    lead: String(defaultLeadDays),
    cover: String(options.coverDays ?? 7),
    velocityDays: String(options.salesVelocityDays ?? 30),
    safetyDays: String(options.safetyStockDays ?? 2),
    lowDays: String(options.lowStockDaysThreshold ?? 3),
    rows: '1',
  });
  const result = await apiRequest<{ rows: ReorderRow[] }>(`/shop/reports/reorder?${query}`);
  return result.rows;
}

/** Units sold and profit per product in a range (top sellers). */
export async function productSales(from: string, to: string) {
  const [start, end] = rangeIso(from, to);
  const sales = (await db.sales.where('date').between(start, end, true, true).toArray()).filter((s) => s.status === 'completed');
  const map = new Map<string, { name: string; qty: number; revenue: number; cost: number }>();
  for (const s of sales) {
    const factor = s.subtotal > 0 ? s.total / s.subtotal : 1;
    for (const i of s.items) {
      const row = map.get(i.productId) ?? { name: i.name, qty: 0, revenue: 0, cost: 0 };
      row.qty += i.qty;
      row.revenue += Math.round((lineTotal(i.price, i.qty) - i.discount) * factor);
      row.cost += lineTotal(i.cost, i.qty);
      map.set(i.productId, row);
    }
  }
  return [...map.entries()].map(([productId, r]) => ({ productId, ...r, profit: r.revenue - r.cost })).sort((a, b) => b.revenue - a.revenue);
}

/** Retailer (Easypaisa/JazzCash) summary for a range. */
export async function serviceSummary(provider: string, from: string, to: string) {
  const [start, end] = rangeIso(from, to);
  const txns = (await db.serviceTxns.where('date').between(start, end, true, true).toArray()).filter((t) => t.provider === provider);
  const sum = (types: string[]) => txns.filter((t) => types.includes(t.type)).reduce((s, t) => s + t.amount, 0);
  return {
    count: txns.length,
    cashIn: sum(['cash_in', 'send_money', 'bill', 'load']),
    cashOut: sum(['cash_out']),
    volume: txns.reduce((s, t) => s + t.amount, 0),
    commission: txns.reduce((s, t) => s + t.commission, 0),
    fees: txns.reduce((s, t) => s + t.fee, 0),
    txns,
  };
}

export interface SalesSummary {
  bills: number;
  total: number;
  returns: number;
  unitsSold: number;
}

export interface ProductPerformance {
  productId: string;
  name: string;
  qty: number;
  revenue: number;
  cost: number;
  profit: number;
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

export interface ProductPair {
  productAId: string;
  productAName: string;
  productAQty: number;
  productBId: string;
  productBName: string;
  productBQty: number;
  bills: number;
}

export async function productPairs(from: string, to: string): Promise<ProductPair[]> {
  const [start, end] = rangeIso(from, to);
  const query = new URLSearchParams({ start, end, limit: '100' });
  return apiRequest<ProductPair[]>(`/shop/reports/product-pairs?${query}`);
}

/** Server-aggregated product margins and sales performance for the requested inclusive days. */
export async function productPerformance(from: string, to: string, minimumMarginPct: number): Promise<ProductPerformance[]> {
  const [start, end] = rangeIso(from, to);
  const query = new URLSearchParams({ start, end, minimumMarginPct: String(minimumMarginPct) });
  return apiRequest<ProductPerformance[]>(`/shop/reports/product-performance?${query}`);
}

export interface DailySalesPoint {
  count: number;
  total: number;
}

/** Completed sales totals for several date ranges in a single report request. */
export async function dailySales(ranges: [string, string][]): Promise<DailySalesPoint[]> {
  const query = new URLSearchParams({ ranges: JSON.stringify(ranges) });
  return apiRequest<DailySalesPoint[]>(`/shop/reports/daily-sales?${query}`);
}

/** Bills in a local-day range, newest first; optionally restrict to one seller. */
export async function salesInRange(from: string, to: string, limit?: number, userId?: string): Promise<import('@retailos/domain').Sale[]> {
  const [start, end] = rangeIso(from, to);
  const sales = await db.sales.where('date').between(start, end, true, true).toArray();
  return sales
    .filter((sale) => !userId || sale.userId === userId)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit);
}

/** Completed bill totals and returned value for a local-day range. */
export async function salesSummary(from: string, to: string, userId?: string): Promise<SalesSummary> {
  const [start, end] = rangeIso(from, to);
  const [sales, returns] = await Promise.all([
    db.sales.where('date').between(start, end, true, true).toArray(),
    db.saleReturns.where('date').between(start, end, true, true).toArray(),
  ]);
  const visible = sales.filter((sale) => !userId || sale.userId === userId);
  const soldUnits = visible
    .filter((sale) => sale.status === 'completed')
    .reduce((sum, sale) => sum + sale.items.reduce((units, item) => units + item.qty, 0), 0);
  const returnedUnits = returns
    .filter((saleReturn) => !userId || saleReturn.userId === userId)
    .reduce((sum, saleReturn) => sum + saleReturn.items.reduce((units, item) => units + item.qty, 0), 0);
  return {
    bills: visible.filter((sale) => sale.status === 'completed').length,
    total: visible.filter((sale) => sale.status === 'completed').reduce((sum, sale) => sum + sale.total, 0),
    returns: visible.reduce((sum, sale) => sum + sale.returnedTotal, 0),
    unitsSold: Math.max(0, soldUnits - returnedUnits),
  };
}

/** Units sold per product within the requested rolling period. */
export async function salesVelocity(since: string): Promise<Record<string, number>> {
  const sales = (await db.sales.where('date').aboveOrEqual(since).toArray()).filter((sale) => sale.status === 'completed');
  const velocity: Record<string, number> = {};
  for (const sale of sales) {
    for (const item of sale.items) {
      velocity[item.productId] = (velocity[item.productId] ?? 0) + Math.max(0, item.qty - item.returnedQty);
    }
  }
  return velocity;
}
