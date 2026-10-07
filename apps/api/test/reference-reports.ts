/**
 * REFERENCE IMPLEMENTATION (tests only).
 *
 * These are the report calculations exactly as the web app performed them in the browser before they
 * moved to the server (apps/web/src/lib/reports.ts and the page-level totals), rewritten to work on
 * plain arrays. The server-side SQL must produce the same numbers for the same records.
 * Do not "improve" these: they define what "the same" means.
 */
import type { AccountTxn, Product, Purchase, Sale, SaleReturn, ServiceTxn, StockMove, Supplier, Expense } from '@retailos/domain';

export const lineTotal = (price: number, q: number) => Math.round(price * q);

const inRange = (date: string, start: string, end: string) => date >= start && date <= end;

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

interface Books {
  sales: Sale[];
  saleReturns: SaleReturn[];
  expenses: Expense[];
  stockMoves: StockMove[];
  serviceTxns: ServiceTxn[];
  purchases: Purchase[];
  accountTxns: AccountTxn[];
}

/** Records in the order the browser saw them: by date, ties by id (what the server list returned). */
const byDate = <T extends { id: string; date: string }>(rows: T[]) => [...rows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

export function refProfit(b: Books, start: string, end: string): ProfitSummary {
  const sales = byDate(b.sales).filter((s) => inRange(s.date, start, end) && s.status === 'completed');
  const returns = byDate(b.saleReturns).filter((r) => inRange(r.date, start, end));
  const expenses = byDate(b.expenses).filter((e) => inRange(e.date, start, end));
  const moves = byDate(b.stockMoves).filter((m) => inRange(m.date, start, end));
  const services = byDate(b.serviceTxns).filter((t) => inRange(t.date, start, end));

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

export function refProductSales(b: Books, start: string, end: string) {
  const sales = byDate(b.sales).filter((s) => inRange(s.date, start, end) && s.status === 'completed');
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

export function refServiceSummary(b: Books, provider: string, start: string, end: string, onlyUserId?: string) {
  const txns = byDate(b.serviceTxns).filter((t) => inRange(t.date, start, end) && t.provider === provider && (!onlyUserId || t.userId === onlyUserId));
  const sum = (types: string[]) => txns.filter((t) => types.includes(t.type)).reduce((s, t) => s + t.amount, 0);
  return {
    count: txns.length,
    cashIn: sum(['cash_in', 'send_money', 'bill', 'load']),
    cashOut: sum(['cash_out']),
    volume: txns.reduce((s, t) => s + t.amount, 0),
    commission: txns.reduce((s, t) => s + t.commission, 0),
    fees: txns.reduce((s, t) => s + t.fee, 0),
  };
}

export const refStockValue = (products: Product[]) => products.reduce((s, p) => s + (p.stock > 0 ? lineTotal(p.cost, p.stock) : 0), 0);

/** Dashboard "best sellers": weekly completed sales, newest first, ranked by quantity. */
export function refTopProducts(b: Books, start: string, end: string, limit: number) {
  const weekly = [...byDate(b.sales)].reverse().filter((s) => s.status === 'completed' && inRange(s.date, start, end));
  const top = new Map<string, { name: string; qty: number; revenue: number }>();
  for (const sale of weekly) {
    for (const item of sale.items) {
      const entry = top.get(item.productId) ?? { name: item.name, qty: 0, revenue: 0 };
      entry.qty += item.qty;
      entry.revenue += lineTotal(item.price, item.qty) - item.discount;
      top.set(item.productId, entry);
    }
  }
  return [...top.values()].sort((a, b) => b.qty - a.qty).slice(0, limit);
}

/** Dashboard daily bars: total of completed sales inside each [start, end] day range. */
export function refDaily(b: Books, ranges: [string, string][]) {
  return ranges.map(([s, e]) => {
    const rows = b.sales.filter((x) => x.status === 'completed' && inRange(x.date, s, e));
    return { count: rows.length, total: rows.reduce((sum, x) => sum + x.total, 0) };
  });
}

/** POS product ranking: units sold per product (completed sales, minus returned units) since a date. */
export function refVelocity(b: Books, since: string) {
  const out = new Map<string, number>();
  for (const sale of b.sales) {
    if (sale.date < since || sale.status !== 'completed') continue;
    for (const item of sale.items) out.set(item.productId, (out.get(item.productId) ?? 0) + Math.max(0, item.qty - item.returnedQty));
  }
  return out;
}

/** Cash page "by transaction type" for one account and a day range. */
export function refCashBreakdown(b: Books, accountId: string, start: string, end: string) {
  const map = new Map<string, number>();
  for (const t of byDate(b.accountTxns).filter((x) => inRange(x.date, start, end) && x.accountId === accountId)) map.set(t.type, (map.get(t.type) ?? 0) + t.amount);
  return [...map.entries()];
}

/** Expenses page totals for a month. */
export function refExpenseTotals(b: Books, start: string, end: string) {
  const list = byDate(b.expenses).filter((e) => inRange(e.date, start, end));
  const expenses = list.filter((e) => e.kind === 'expense');
  const byCat = new Map<string, number>();
  for (const e of expenses) byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.amount);
  return {
    expenseTotal: expenses.reduce((s, e) => s + e.amount, 0),
    drawingTotal: list.filter((e) => e.kind === 'drawing').reduce((s, e) => s + e.amount, 0),
    byCategory: [...byCat.entries()],
  };
}

export function refPurchases(b: Books, start: string, end: string) {
  const rows = b.purchases.filter((p) => inRange(p.date, start, end));
  return { count: rows.length, total: rows.reduce((s, p) => s + p.total, 0), paid: rows.reduce((s, p) => s + p.paid, 0) };
}

/** Sales page stat cards for a range; a person without sales.view_all only counts their own bills. */
export function refSalesSummary(b: Books, start: string, end: string, onlyUserId?: string) {
  const sales = b.sales.filter((s) => inRange(s.date, start, end) && (!onlyUserId || s.userId === onlyUserId));
  const completed = sales.filter((s) => s.status === 'completed');
  const returns = b.saleReturns.filter((r) => inRange(r.date, start, end) && (!onlyUserId || r.userId === onlyUserId));
  return {
    bills: completed.length,
    total: completed.reduce((s, x) => s + x.total, 0),
    returns: returns.reduce((s, r) => s + r.amount, 0),
    cancelled: sales.filter((s) => s.status === 'void').length,
  };
}

export type { Books };

// ---------------------------------------------------------------- reorder (the old browser version, driven by a Date)

export function refReorder(
  products: Product[],
  suppliers: Supplier[],
  moves: StockMove[],
  defaultLeadDays: number,
  now: Date,
  coverDays = 7,
  options: { salesVelocityDays?: number; safetyStockDays?: number; lowStockDaysThreshold?: number } = {},
) {
  type Status = 'order_now' | 'reorder_soon' | 'ok' | 'no_sales';
  const dateKey = (date: Date) => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  const addDays = (date: Date, days: number) => {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  };
  const daysBetween = (from: Date, to: Date) => {
    const start = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
    const end = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
    return Math.round((end - start) / 86_400_000);
  };
  const sup = new Map(suppliers.map((s) => [s.id, s]));
  const velocityDays = options.salesVelocityDays ?? 30;
  const safetyStockDays = options.safetyStockDays ?? 2;
  const lowStockDaysThreshold = options.lowStockDaysThreshold ?? 3;
  const since = new Date(now.getTime() - velocityDays * 86_400_000).toISOString();
  const sold = new Map<string, number>();
  for (const m of moves.filter((x) => x.date >= since)) {
    if (m.type === 'sale') sold.set(m.productId, (sold.get(m.productId) ?? 0) - m.qty);
    if (m.type === 'return') sold.set(m.productId, (sold.get(m.productId) ?? 0) - m.qty);
  }
  return products
    .filter((p) => p.active)
    .map((product) => {
      const avgDaily = Math.max(0, (sold.get(product.id) ?? 0) / velocityDays);
      const supplier = product.supplierId ? sup.get(product.supplierId) : undefined;
      const lead = supplier?.leadDays ?? defaultLeadDays;
      const today = now;
      const scheduledDate = supplier?.orderDay === undefined ? null : addDays(today, (supplier.orderDay - today.getDay() + 7) % 7);
      const daysUntilScheduled = scheduledDate ? daysBetween(today, scheduledDate) : 0;
      const safety = Math.max(product.minStock, avgDaily * safetyStockDays);
      const reorderPoint = avgDaily * (lead + daysUntilScheduled) + safety;
      const daysLeft = avgDaily > 0 ? product.stock / avgDaily : null;
      let status: Status;
      if (product.stock <= 0) status = 'order_now';
      else if (avgDaily === 0 && product.minStock === 0) status = 'no_sales';
      else if (
        product.stock <= avgDaily * (lead + daysUntilScheduled) ||
        (product.minStock > 0 && product.stock <= product.minStock / 2) ||
        (daysLeft !== null && daysLeft <= lowStockDaysThreshold)
      ) status = 'order_now';
      else if (product.stock <= reorderPoint) status = 'reorder_soon';
      else status = 'ok';
      const orderRequired = status === 'order_now' || status === 'reorder_soon';
      const scheduledOrderIsTooLate =
        !!scheduledDate &&
        (product.stock <= 0 ||
          (product.minStock > 0 && product.stock <= product.minStock / 2) ||
          (daysLeft !== null && daysLeft <= lowStockDaysThreshold) ||
          (avgDaily > 0 && product.stock <= avgDaily * (daysUntilScheduled + lead)));
      const orderOn = scheduledDate ? (scheduledOrderIsTooLate ? today : scheduledDate) : null;
      const daysUntilOrder = orderOn ? daysBetween(today, orderOn) : 0;
      const target = avgDaily * (daysUntilOrder + lead + coverDays) + safety;
      let suggestedQty = scheduledDate ? Math.max(product.stock <= 0 ? 1 : 0, Math.ceil(target - product.stock)) : orderRequired ? Math.max(1, Math.ceil(target - product.stock)) : 0;
      let suggestedPacks: number | null = null;
      if (suggestedQty > 0 && product.packSize && product.packSize > 1) {
        suggestedPacks = Math.ceil(suggestedQty / product.packSize);
        suggestedQty = suggestedPacks * product.packSize;
      }
      const daysUntilReorder = avgDaily > 0 ? Math.max(0, Math.ceil((product.stock - reorderPoint) / avgDaily)) : null;
      const reorderDate = orderOn ?? (orderRequired ? today : daysUntilReorder === null ? null : addDays(today, daysUntilReorder));
      const reorderBy = scheduledDate && suggestedQty === 0 ? null : reorderDate ? dateKey(reorderDate) : null;
      const deliveryOn = reorderBy ? dateKey(addDays(new Date(`${reorderBy}T00:00:00`), lead)) : null;
      const lastSale = moves.filter((move) => move.productId === product.id && move.type === 'sale').reduce<string | null>((latest, move) => latest === null || move.date > latest ? move.date : latest, null);
      const lastSaleDays = lastSale === null ? null : Math.max(0, Math.floor((now.getTime() - Date.parse(lastSale)) / 86_400_000));
      return { product, avgDaily, daysLeft, reorderBy, deliveryOn, reorderPoint, suggestedQty, suggestedPacks: suggestedQty > 0 ? suggestedPacks : null, status, lastSaleDays };
    });
}
