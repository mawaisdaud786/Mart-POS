import {
  ACCOUNT_IDS,
  db,
  nextNumber,
  nowIso,
  uid,
  type Expense,
  type Payment,
  type Purchase,
  type Sale,
  type SaleItem,
  type SaleReturn,
  type ServiceTxn,
  type ServiceType,
  type StockMove,
} from './db';
import { lineTotal, roundQty } from './format';

/**
 * Business operations. Each one runs in a single IndexedDB transaction and writes every
 * effect together (sale → stock + money + khata), so the books always add up.
 */

export class OpError extends Error {}

export function cartSubtotal(items: Pick<SaleItem, 'price' | 'qty' | 'discount'>[]): number {
  return items.reduce((sum, i) => sum + lineTotal(i.price, i.qty) - i.discount, 0);
}

export interface SaleInput {
  items: Omit<SaleItem, 'cost' | 'returnedQty'>[];
  discount: number;
  customerId?: string;
  payments: Payment[];
  userId: string;
  note?: string;
}

export async function completeSale(input: SaleInput): Promise<Sale> {
  if (input.items.length === 0) throw new OpError('Cart is empty');
  const subtotal = cartSubtotal(input.items);
  const total = subtotal - input.discount;
  if (total < 0) throw new OpError('Discount is more than the bill');

  const payments = input.payments.filter((p) => p.amount > 0);
  const tendered = payments.reduce((s, p) => s + p.amount, 0);
  const cashTendered = payments.filter((p) => p.accountId === ACCOUNT_IDS.cash).reduce((s, p) => s + p.amount, 0);
  const nonCash = tendered - cashTendered;
  if (nonCash > total) throw new OpError('Card/wallet payments are more than the bill');
  const change = Math.max(0, tendered - total);
  if (change > cashTendered) throw new OpError('Change can only be given from cash');
  const credit = Math.max(0, total - tendered);
  if (credit > 0 && !input.customerId) throw new OpError('Select a customer for udhaar (credit) sale');

  return db.transaction('rw', [db.sales, db.products, db.stockMoves, db.accountTxns, db.partyEntries, db.counters], async () => {
    const date = nowIso();
    const id = uid();
    const no = await nextNumber('sale', 'INV');
    const items: SaleItem[] = [];
    for (const line of input.items) {
      const product = await db.products.get(line.productId);
      if (!product) throw new OpError(`Product not found: ${line.name}`);
      items.push({ ...line, cost: product.cost, returnedQty: 0 });
      await db.products.update(product.id, { stock: roundQty(product.stock - line.qty) });
      await db.stockMoves.add({ id: uid(), productId: product.id, date, qty: -line.qty, type: 'sale', cost: product.cost, refId: id });
    }
    for (const p of payments) {
      const amount = p.accountId === ACCOUNT_IDS.cash ? p.amount - change : p.amount;
      if (amount > 0) await db.accountTxns.add({ id: uid(), accountId: p.accountId, date, amount, type: 'sale', refId: id, note: no });
    }
    if (credit > 0) {
      await db.partyEntries.add({ id: uid(), partyType: 'customer', partyId: input.customerId!, date, amount: credit, type: 'sale', refId: id, note: no });
    }
    const sale: Sale = {
      id,
      no,
      date,
      ...(input.customerId ? { customerId: input.customerId } : {}),
      items,
      subtotal,
      discount: input.discount,
      total,
      paid: total - credit,
      change,
      credit,
      payments,
      userId: input.userId,
      status: 'completed',
      returnedTotal: 0,
      ...(input.note ? { note: input.note } : {}),
    };
    await db.sales.add(sale);
    return sale;
  });
}

/** Net value of `q` units of a sale line, after line and bill discounts. */
export function returnValue(sale: Sale, item: SaleItem, q: number): number {
  const lineNet = lineTotal(item.price, item.qty) - item.discount;
  const perUnit = item.qty > 0 ? lineNet / item.qty : 0;
  const billFactor = sale.subtotal > 0 ? sale.total / sale.subtotal : 1;
  return Math.round(perUnit * q * billFactor);
}

export async function returnSaleItems(input: {
  saleId: string;
  lines: { productId: string; qty: number }[];
  refundTo: 'account' | 'khata';
  accountId?: string;
  reason?: string;
  userId: string;
}): Promise<SaleReturn> {
  return db.transaction('rw', [db.sales, db.saleReturns, db.products, db.stockMoves, db.accountTxns, db.partyEntries], async () => {
    const sale = await db.sales.get(input.saleId);
    if (!sale || sale.status === 'void') throw new OpError('Sale not found');
    if (input.refundTo === 'khata' && !sale.customerId) throw new OpError('This sale has no customer khata');
    const date = nowIso();
    const id = uid();
    const items: SaleReturn['items'] = [];
    for (const line of input.lines) {
      if (line.qty <= 0) continue;
      const item = sale.items.find((i) => i.productId === line.productId);
      if (!item) throw new OpError('Item is not in this sale');
      if (line.qty > roundQty(item.qty - item.returnedQty)) throw new OpError(`Cannot return more ${item.name} than was sold`);
      const amount = returnValue(sale, item, line.qty);
      items.push({ productId: item.productId, name: item.name, qty: line.qty, amount, cost: item.cost });
      item.returnedQty = roundQty(item.returnedQty + line.qty);
      const product = await db.products.get(item.productId);
      if (product) await db.products.update(product.id, { stock: roundQty(product.stock + line.qty) });
      await db.stockMoves.add({ id: uid(), productId: item.productId, date, qty: line.qty, type: 'return', cost: item.cost, refId: id });
    }
    if (items.length === 0) throw new OpError('Nothing to return');
    const amount = items.reduce((s, i) => s + i.amount, 0);
    if (input.refundTo === 'khata') {
      await db.partyEntries.add({ id: uid(), partyType: 'customer', partyId: sale.customerId!, date, amount: -amount, type: 'return', refId: id, note: `Return ${sale.no}` });
    } else {
      const accountId = input.accountId ?? ACCOUNT_IDS.cash;
      await db.accountTxns.add({ id: uid(), accountId, date, amount: -amount, type: 'refund', refId: id, note: `Return ${sale.no}` });
    }
    await db.sales.update(sale.id, { items: sale.items, returnedTotal: sale.returnedTotal + amount });
    const ret: SaleReturn = {
      id,
      saleId: sale.id,
      saleNo: sale.no,
      date,
      items,
      amount,
      refundTo: input.refundTo,
      ...(input.refundTo === 'account' ? { accountId: input.accountId ?? ACCOUNT_IDS.cash } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
      userId: input.userId,
    };
    await db.saleReturns.add(ret);
    return ret;
  });
}

/** Cancel a sale completely: stock goes back, payments and khata are reversed. */
export async function voidSale(saleId: string, reason: string): Promise<void> {
  await db.transaction('rw', [db.sales, db.products, db.stockMoves, db.accountTxns, db.partyEntries], async () => {
    const sale = await db.sales.get(saleId);
    if (!sale || sale.status === 'void') throw new OpError('Sale not found');
    if (sale.returnedTotal > 0) throw new OpError('Items were already returned from this sale; use Return instead');
    const date = nowIso();
    for (const item of sale.items) {
      const product = await db.products.get(item.productId);
      if (product) await db.products.update(product.id, { stock: roundQty(product.stock + item.qty) });
      await db.stockMoves.add({ id: uid(), productId: item.productId, date, qty: item.qty, type: 'return', cost: item.cost, refId: sale.id, note: 'Void' });
    }
    const txns = await db.accountTxns.where('refId').equals(sale.id).toArray();
    for (const t of txns) {
      await db.accountTxns.add({ id: uid(), accountId: t.accountId, date, amount: -t.amount, type: 'refund', refId: sale.id, note: `Void ${sale.no}` });
    }
    if (sale.credit > 0 && sale.customerId) {
      await db.partyEntries.add({ id: uid(), partyType: 'customer', partyId: sale.customerId, date, amount: -sale.credit, type: 'return', refId: sale.id, note: `Void ${sale.no}` });
    }
    await db.sales.update(sale.id, { status: 'void', note: reason });
  });
}

/** Stock received from a supplier. Updates weighted average cost, supplier balance and cash. */
export async function recordPurchase(input: {
  supplierId: string;
  invoiceNo?: string;
  /** `total` = exact line amount from the bill (e.g. cartons × carton price); defaults to cost × qty. */
  items: { productId: string; qty: number; cost: number; total?: number }[];
  paid: number;
  accountId?: string;
  note?: string;
}): Promise<Purchase> {
  const items = input.items.filter((i) => i.qty > 0);
  if (items.length === 0) throw new OpError('Add at least one item');
  const total = items.reduce((s, i) => s + (i.total ?? lineTotal(i.cost, i.qty)), 0);
  if (input.paid > total) throw new OpError('Paid amount is more than the bill');
  if (input.paid > 0 && !input.accountId) throw new OpError('Choose the account you paid from');

  return db.transaction('rw', [db.purchases, db.products, db.stockMoves, db.accountTxns, db.partyEntries, db.counters], async () => {
    const date = nowIso();
    const id = uid();
    const no = await nextNumber('purchase', 'PUR');
    const lines: Purchase['items'] = [];
    for (const i of items) {
      const product = await db.products.get(i.productId);
      if (!product) throw new OpError('Product not found');
      const newStock = roundQty(product.stock + i.qty);
      const newCost =
        product.stock > 0 && newStock > 0 ? Math.round((product.stock * product.cost + i.qty * i.cost) / newStock) : i.cost;
      await db.products.update(product.id, { stock: newStock, cost: newCost, ...(product.supplierId ? {} : { supplierId: input.supplierId }) });
      await db.stockMoves.add({ id: uid(), productId: product.id, date, qty: i.qty, type: 'purchase', cost: i.cost, refId: id });
      lines.push({ productId: product.id, name: product.name, qty: i.qty, cost: i.cost });
    }
    const unpaid = total - input.paid;
    if (unpaid > 0) {
      await db.partyEntries.add({ id: uid(), partyType: 'supplier', partyId: input.supplierId, date, amount: unpaid, type: 'purchase', refId: id, note: no });
    }
    if (input.paid > 0) {
      await db.accountTxns.add({ id: uid(), accountId: input.accountId!, date, amount: -input.paid, type: 'purchase', refId: id, note: no });
    }
    const purchase: Purchase = {
      id,
      no,
      date,
      supplierId: input.supplierId,
      ...(input.invoiceNo ? { invoiceNo: input.invoiceNo } : {}),
      items: lines,
      total,
      paid: input.paid,
      ...(input.accountId ? { accountId: input.accountId } : {}),
      ...(input.note ? { note: input.note } : {}),
    };
    await db.purchases.add(purchase);
    return purchase;
  });
}

/** Manual stock change with a reason. Adding stock with a cost updates the average cost. */
export async function adjustStock(input: {
  productId: string;
  qty: number;
  type: Extract<StockMove['type'], 'opening' | 'adjust' | 'damage' | 'expiry'>;
  cost?: number;
  note?: string;
}): Promise<void> {
  if (input.qty === 0) throw new OpError('Quantity cannot be zero');
  await db.transaction('rw', [db.products, db.stockMoves], async () => {
    const product = await db.products.get(input.productId);
    if (!product) throw new OpError('Product not found');
    const newStock = roundQty(product.stock + input.qty);
    let cost = product.cost;
    if (input.qty > 0 && input.cost !== undefined && input.cost > 0) {
      cost = product.stock > 0 && newStock > 0 ? Math.round((product.stock * product.cost + input.qty * input.cost) / newStock) : input.cost;
    }
    await db.products.update(product.id, { stock: newStock, cost });
    await db.stockMoves.add({
      id: uid(),
      productId: product.id,
      date: nowIso(),
      qty: input.qty,
      type: input.type,
      cost: input.qty > 0 && input.cost ? input.cost : product.cost,
      ...(input.note ? { note: input.note } : {}),
    });
  });
}

export async function receiveCustomerPayment(customerId: string, amount: number, accountId: string, note?: string) {
  if (amount <= 0) throw new OpError('Enter an amount');
  await db.transaction('rw', [db.partyEntries, db.accountTxns], async () => {
    const id = uid();
    const date = nowIso();
    await db.partyEntries.add({ id, partyType: 'customer', partyId: customerId, date, amount: -amount, type: 'payment', note: note || 'Payment received' });
    await db.accountTxns.add({ id: uid(), accountId, date, amount, type: 'customer_payment', refId: id, note: note || 'Customer payment' });
  });
}

export async function paySupplier(supplierId: string, amount: number, accountId: string, note?: string) {
  if (amount <= 0) throw new OpError('Enter an amount');
  await db.transaction('rw', [db.partyEntries, db.accountTxns], async () => {
    const id = uid();
    const date = nowIso();
    await db.partyEntries.add({ id, partyType: 'supplier', partyId: supplierId, date, amount: -amount, type: 'payment', note: note || 'Payment made' });
    await db.accountTxns.add({ id: uid(), accountId, date, amount: -amount, type: 'supplier_payment', refId: id, note: note || 'Supplier payment' });
  });
}

/** Opening balance or manual correction on a customer/supplier khata. */
export async function addPartyAdjustment(partyType: 'customer' | 'supplier', partyId: string, amount: number, note: string, type: 'opening' | 'adjustment' = 'adjustment') {
  if (amount === 0) return;
  await db.partyEntries.add({ id: uid(), partyType, partyId, date: nowIso(), amount, type, note });
}

export async function addExpense(input: Omit<Expense, 'id' | 'date'> & { date?: string }) {
  if (input.amount <= 0) throw new OpError('Enter an amount');
  await db.transaction('rw', [db.expenses, db.accountTxns], async () => {
    const id = uid();
    const date = input.date ?? nowIso();
    await db.expenses.add({ ...input, id, date });
    await db.accountTxns.add({
      id: uid(),
      accountId: input.accountId,
      date,
      amount: -input.amount,
      type: input.kind === 'drawing' ? 'drawing' : 'expense',
      refId: id,
      note: input.kind === 'drawing' ? 'Owner withdrawal' : input.category,
    });
  });
}

export async function deleteExpense(id: string) {
  await db.transaction('rw', [db.expenses, db.accountTxns], async () => {
    await db.expenses.delete(id);
    const txns = await db.accountTxns.where('refId').equals(id).toArray();
    await db.accountTxns.bulkDelete(txns.map((t) => t.id));
  });
}

export async function transferMoney(fromId: string, toId: string, amount: number, note?: string) {
  if (amount <= 0) throw new OpError('Enter an amount');
  if (fromId === toId) throw new OpError('Choose two different accounts');
  await db.transaction('rw', [db.accountTxns], async () => {
    const ref = uid();
    const date = nowIso();
    await db.accountTxns.add({ id: uid(), accountId: fromId, date, amount: -amount, type: 'transfer', refId: ref, note: note || 'Transfer out' });
    await db.accountTxns.add({ id: uid(), accountId: toId, date, amount, type: 'transfer', refId: ref, note: note || 'Transfer in' });
  });
}

export async function adjustAccount(accountId: string, amount: number, note: string) {
  if (amount === 0) return;
  await db.accountTxns.add({ id: uid(), accountId, date: nowIso(), amount, type: 'adjustment', note });
}

export const SERVICE_TYPES: Record<ServiceType, { label: string; floatSign: -1 | 1; cashSign: -1 | 1 }> = {
  cash_in: { label: 'Cash In (deposit)', floatSign: -1, cashSign: 1 },
  send_money: { label: 'Send Money', floatSign: -1, cashSign: 1 },
  bill: { label: 'Bill Payment', floatSign: -1, cashSign: 1 },
  load: { label: 'Mobile Load', floatSign: -1, cashSign: 1 },
  cash_out: { label: 'Cash Out (withdrawal)', floatSign: 1, cashSign: -1 },
};

/**
 * Easypaisa / JazzCash retailer transaction. Two balances move: the provider float (wallet)
 * and the shop cash. Commission is credited to the float per transaction.
 */
export async function addServiceTxn(input: Omit<ServiceTxn, 'id' | 'date'>) {
  if (input.amount <= 0) throw new OpError('Enter an amount');
  const floatAccount = await db.accounts.where('provider').equals(input.provider).first();
  if (!floatAccount) throw new OpError(`No account set up for ${input.provider}`);
  const t = SERVICE_TYPES[input.type];
  await db.transaction('rw', [db.serviceTxns, db.accountTxns], async () => {
    const id = uid();
    const date = nowIso();
    await db.serviceTxns.add({ ...input, id, date });
    const label = `${input.provider} ${t.label}`;
    await db.accountTxns.add({ id: uid(), accountId: floatAccount.id, date, amount: t.floatSign * input.amount, type: 'service', refId: id, note: label });
    await db.accountTxns.add({ id: uid(), accountId: ACCOUNT_IDS.cash, date, amount: t.cashSign * input.amount, type: 'service', refId: id, note: label });
    if (input.fee > 0) {
      await db.accountTxns.add({ id: uid(), accountId: ACCOUNT_IDS.cash, date, amount: input.fee, type: 'service', refId: id, note: `${input.provider} fee` });
    }
    if (input.commission > 0) {
      await db.accountTxns.add({ id: uid(), accountId: floatAccount.id, date, amount: input.commission, type: 'service', refId: id, note: `${input.provider} commission` });
    }
  });
}

export async function deleteServiceTxn(id: string) {
  await db.transaction('rw', [db.serviceTxns, db.accountTxns], async () => {
    await db.serviceTxns.delete(id);
    const txns = await db.accountTxns.where('refId').equals(id).toArray();
    await db.accountTxns.bulkDelete(txns.map((t) => t.id));
  });
}

export async function accountBalance(accountId: string): Promise<number> {
  const txns = await db.accountTxns.where('accountId').equals(accountId).toArray();
  return txns.reduce((s, t) => s + t.amount, 0);
}

/**
 * Daily closing: compare counted money with what the books expect. The difference is booked
 * as an adjustment so the next day starts from the real amount.
 */
export async function saveClosing(input: { accountId: string; counted: number; note?: string; userId: string }) {
  await db.transaction('rw', [db.closings, db.accountTxns], async () => {
    const expected = (await db.accountTxns.where('accountId').equals(input.accountId).toArray()).reduce((s, t) => s + t.amount, 0);
    const difference = input.counted - expected;
    const id = uid();
    const date = nowIso();
    await db.closings.add({ id, date, accountId: input.accountId, expected, counted: input.counted, difference, ...(input.note ? { note: input.note } : {}), userId: input.userId });
    if (difference !== 0) {
      await db.accountTxns.add({ id: uid(), accountId: input.accountId, date, amount: difference, type: 'adjustment', refId: id, note: 'Closing difference' });
    }
  });
}
