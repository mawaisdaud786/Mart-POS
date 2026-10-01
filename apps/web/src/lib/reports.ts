import { db, type Account, type Product } from './db';
import { lineTotal, rangeIso } from './format';

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
  reorderPoint: number;
  suggestedQty: number;
  suggestedPacks: number | null;
  status: ReorderStatus;
}

/**
 * Smart low-stock check. Average daily sale comes from the last 30 days.
 * Reorder point = daily sale × lead time + safety stock (2 days of sales, or min stock if higher).
 * Suggested order covers lead time + 7 days, rounded up to whole cartons when a pack size is set.
 */
export async function reorderReport(defaultLeadDays: number, coverDays = 7): Promise<ReorderRow[]> {
  const products = (await db.products.toArray()).filter((p) => p.active);
  const suppliers = new Map((await db.suppliers.toArray()).map((s) => [s.id, s]));
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const moves = await db.stockMoves.where('date').aboveOrEqual(since).toArray();
  const sold = new Map<string, number>();
  for (const m of moves) {
    if (m.type === 'sale') sold.set(m.productId, (sold.get(m.productId) ?? 0) - m.qty);
    if (m.type === 'return') sold.set(m.productId, (sold.get(m.productId) ?? 0) - m.qty);
  }
  return products.map((product) => {
    const avgDaily = Math.max(0, (sold.get(product.id) ?? 0) / 30);
    const lead = (product.supplierId && suppliers.get(product.supplierId)?.leadDays) || defaultLeadDays;
    const safety = Math.max(product.minStock, avgDaily * 2);
    const reorderPoint = avgDaily * lead + safety;
    const daysLeft = avgDaily > 0 ? product.stock / avgDaily : null;
    const target = avgDaily * (lead + coverDays) + safety;
    let suggestedQty = Math.max(1, Math.ceil(target - product.stock));
    let suggestedPacks: number | null = null;
    if (suggestedQty > 0 && product.packSize && product.packSize > 1) {
      suggestedPacks = Math.ceil(suggestedQty / product.packSize);
      suggestedQty = suggestedPacks * product.packSize;
    }
    let status: ReorderStatus;
    if (product.stock <= 0) status = 'order_now';
    else if (avgDaily === 0 && product.minStock === 0) status = 'no_sales';
    else if (product.stock <= avgDaily * lead || (product.minStock > 0 && product.stock <= product.minStock / 2)) status = 'order_now';
    else if (product.stock <= reorderPoint) status = 'reorder_soon';
    else status = 'ok';
    const needsOrder = status === 'order_now' || status === 'reorder_soon';
    return {
      product,
      avgDaily,
      daysLeft,
      reorderPoint,
      suggestedQty: needsOrder ? suggestedQty : 0,
      suggestedPacks: needsOrder ? suggestedPacks : null,
      status,
    };
  });
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
