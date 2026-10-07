import {
  calculatePricing,
  type Account,
  type AccountTxn,
  type Category,
  type Customer,
  type Expense,
  type GharOrder,
  type Payment,
  type Permission,
  type PricingSettings,
  type Product,
  type Purchase,
  type Sale,
  type SaleItem,
  type SaleReturn,
  type ServiceTxn,
  type ServiceType,
  type ShopSettings,
  type StockMove,
  type Supplier,
  invoiceNumberPrefix,
  supportsFractionalSaleQuantity,
} from '@retailos/domain';
import { randomUUID } from 'node:crypto';
import { AppError, forbidden } from '../../lib/errors.js';
import type { ShopStore } from './store.js';

/**
 * The shop's business operations. Each one runs inside a single database transaction (see
 * inShopTransaction) and writes every effect together (a sale moves stock, money and khata), so the
 * books always add up. Every operation checks the caller's permission, and prices, costs, stock and
 * balances are always taken from the database, never from the request.
 */

export class OpError extends AppError {
  constructor(message: string) {
    super(400, 'OP_REJECTED', message);
  }
}

export interface OpContext {
  userId: string;
  can: (permission: Permission) => boolean;
  now?: () => string;
  newId?: () => string;
}

const now = (c: OpContext) => (c.now ?? (() => new Date().toISOString()))();
const newId = (c: OpContext) => (c.newId ?? randomUUID)();
const need = (c: OpContext, ...permissions: Permission[]) => {
  if (!permissions.some((p) => c.can(p))) throw forbidden();
};

export const ACCOUNT_IDS = { cash: 'acc-cash', bank: 'acc-bank', easypaisa: 'acc-easypaisa', jazzcash: 'acc-jazzcash' } as const;

export const roundQty = (n: number) => Math.round(n * 1000) / 1000;
export const lineTotal = (price: number, q: number) => Math.round(price * q);

const isMoney = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && Number.isInteger(n);
const isQty = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

function summarizePurchasePayments(total: number, amounts: number[]) {
  const paid = amounts.reduce((sum, amount) => sum + (Number.isFinite(amount) && amount > 0 ? amount : 0), 0);
  return { paid, credit: Math.max(0, total - paid), overpayment: Math.max(0, paid - total) };
}

/** The pricing engine's settings, taken from the shop settings stored in the database. */
export function pricingFromSettings(s: Partial<ShopSettings> | undefined): PricingSettings {
  return {
    autoDiscountEnabled: s?.autoDiscountEnabled ?? true,
    threshold: s?.autoDiscountMinOrder ?? 500_000,
    defaultPercent: s?.autoDiscountPct ?? 10,
    maxPercent: s?.autoDiscountMaxPct ?? 70,
    maxProfitPercent: s?.autoDiscountMaxProfitPct ?? 30,
    categoryRules: s?.autoDiscountCategoryRules ?? [],
    deliveryEnabled: s?.homeDeliveryEnabled ?? true,
    deliveryCharge: s?.deliveryCharge ?? 20_000,
    freeDeliveryThreshold: s?.freeDeliveryThreshold ?? 500_000,
    businessPricingEnabled: s?.businessPricingEnabled ?? true,
  };
}

// ------------------------------------------------------------------ sales

export interface SaleInput {
  date?: string | undefined;
  gharOrderId?: string | undefined;
  deliveryAddress?: string | undefined;
  pricingMode?: 'normal' | 'business' | 'cost' | undefined;
  paymentMethod?: 'cash' | 'credit' | undefined;
  deliveryFee?: number | undefined;
  items: { productId: string; name?: string | undefined; unit?: string | undefined; qty: number; price: number; discount: number }[];
  discount: number;
  customerId?: string | undefined;
  payments: Payment[];
  note?: string | undefined;
  homeDelivery?: boolean | undefined;
}

export async function completeSale(s: ShopStore, c: OpContext, input: SaleInput): Promise<Sale> {
  need(c, 'pos.use');
  if (input.items.length === 0) throw new OpError('Cart is empty');
  if (input.pricingMode === 'cost') {
    need(c, 'products.view_cost', 'inventory.view_value');
    if (!input.customerId || input.gharOrderId) throw new OpError('Cost-price sales require a selected customer and cannot be used for a locked delivery order');
  }
  if (input.pricingMode === 'business' && (!input.customerId || input.gharOrderId)) {
    throw new OpError('Shopkeeper pricing requires a selected customer and cannot be used for a locked delivery order');
  }
  for (const line of input.items) {
    if (!isQty(line.qty) || line.qty <= 0) throw new OpError('Every item needs a quantity above zero');
    if (!isMoney(line.price) || line.price < 0 || !isMoney(line.discount) || line.discount < 0) throw new OpError('Prices and discounts must be whole paisa, not negative');
  }
  if (!isMoney(input.discount) || input.discount < 0) throw new OpError('Discount must be a whole amount of paisa, not negative');
  if (input.payments.some((p) => !isMoney(p.amount) || p.amount < 0)) throw new OpError('Payment amounts must be whole paisa, not negative');
  if (new Set(input.items.map((i) => i.productId)).size !== input.items.length) throw new OpError('The same product appears twice in the bill');

  // Lock the product rows: two terminals selling the same product at once must not lose a stock update.
  const products: Product[] = [];
  for (const line of [...input.items].sort((a, b) => a.productId.localeCompare(b.productId))) {
    const product = await s.getForUpdate<Product>('products', line.productId);
    if (!product || !product.active) throw new OpError('A product in the cart is unavailable');
    products.push(product);
  }
  const productById = new Map(products.map((p) => [p.id, p]));
  const categoryIds = [...new Set(products.flatMap((product) => product.categoryId ? [product.categoryId] : []))];
  const categoryRecords = await Promise.all(categoryIds.map((id) => s.get<Category>('categories', id)));
  const categoryNameById = new Map(categoryRecords.filter((category): category is Category => !!category).map((category) => [category.id, category.name]));
  for (const line of input.items) {
    const product = productById.get(line.productId)!;
    if (!supportsFractionalSaleQuantity(categoryNameById.get(product.categoryId ?? '')) && !Number.isInteger(line.qty)) {
      throw new OpError(`Use a whole-number quantity for ${product.name}`);
    }
    if (!product.isService && product.trackStock !== false && product.stock < line.qty) {
      throw new OpError(`${product.name}: only ${product.stock} available`);
    }
  }
  if (input.pricingMode === 'business') {
    const customer = await s.get<Customer>('customers', input.customerId!);
    if (!customer?.shopkeeperPricing) throw new OpError('Shopkeeper pricing is only available for customers marked as special/shop owners');
  }
  const canViewCost = c.can('products.view_cost') || c.can('inventory.view_value');
  if (input.pricingMode === 'business') {
    const productsWithoutAnAvailableRate = products.filter((product) => (
      !product.isService && !(canViewCost && product.cost > 0) && product.wholesalePrice == null
    ));
    if (productsWithoutAnAvailableRate.length > 0) {
      throw new OpError('Every product needs a viewable purchase cost or saved shopkeeper/wholesale price for shopkeeper-rate sales');
    }
  }
  const pricingProducts = products.map((product) => product.isService
    ? { ...toPricingProduct(product, canViewCost), cost: product.salePrice, thresholdPrice: null, wholesalePrice: product.salePrice }
    : toPricingProduct(product, canViewCost));
  const thresholdPricingProducts = products.map((product) => product.isService
    ? { id: product.id, salePrice: product.salePrice, thresholdPrice: null, wholesalePrice: product.salePrice, categoryId: product.categoryId ?? null }
    : toPricingProduct(product));
  const effectivePricingProducts = input.pricingMode === 'business' ? pricingProducts : thresholdPricingProducts;
  const settings = await s.get<ShopSettings & { id: string }>('settings', 'shop');
  const pricingSettings = pricingFromSettings(settings);

  // A line whose price differs from the product's shelf price is a manual price change.
  const overridden = input.items.some((line) => line.price !== productById.get(line.productId)!.salePrice && !productById.get(line.productId)!.isService);
  if (overridden && input.pricingMode !== 'cost' && !c.can('sales.price_override') && !input.gharOrderId) {
    // Engine prices (threshold/wholesale) are recomputed below and replace these; only genuinely manual prices need permission.
    const engine = calculatePricing({
      lines: input.items.map((l) => ({ productId: l.productId, qty: l.qty })),
      products: effectivePricingProducts,
      settings: pricingSettings,
      ...(input.pricingMode ? { pricingMode: input.pricingMode } : {}),
      paymentMethod: input.paymentMethod ?? 'cash',
      ...(input.homeDelivery !== undefined ? { homeDelivery: input.homeDelivery } : {}),
    });
    const manual = input.items.some((l) => {
      if (productById.get(l.productId)!.isService) return false;
      const calc = engine.lines.find((e) => e.productId === l.productId);
      return l.price !== productById.get(l.productId)!.salePrice && l.price !== calc?.price;
    });
    if (manual) throw forbidden('PRICE_OVERRIDE_DENIED', 'You are not allowed to change prices');
  }

  const payments = input.payments.filter((p) => p.amount > 0);
  const tendered = payments.reduce((sum, p) => sum + p.amount, 0);

  const price = (method: 'cash' | 'credit') =>
    input.gharOrderId
      ? undefined
      : calculatePricing({
          lines: input.items.map((line) => ({
            productId: line.productId,
            qty: line.qty,
            ...(line.price !== productById.get(line.productId)!.salePrice ? { price: line.price } : {}),
          })),
          products: effectivePricingProducts,
          settings: pricingSettings,
          ...(input.pricingMode ? { pricingMode: input.pricingMode } : {}),
          paymentMethod: method,
          ...(input.homeDelivery !== undefined ? { homeDelivery: input.homeDelivery } : {}),
        });
  const apply = (pricing: ReturnType<typeof price>) => {
    const items = input.items.map((line) => {
      const calculated = pricing?.lines.find((entry) => entry.productId === line.productId);
      return calculated ? { ...line, price: calculated.price, discount: calculated.discount } : line;
    });
    const subtotal = items.reduce((sum, item) => sum + lineTotal(item.price, item.qty), 0);
    const lineDiscounts = items.reduce((sum, item) => sum + item.discount, 0);
    const deliveryFee = pricing?.deliveryCharge ?? input.deliveryFee ?? 0;
    return { items, subtotal, lineDiscounts, deliveryFee, total: subtotal - lineDiscounts - input.discount + deliveryFee };
  };

  let pricing = price(input.paymentMethod ?? 'cash');
  let bill = apply(pricing);
  // Cash prices apply only when the bill is paid in full; otherwise it is priced as a credit bill.
  if (input.paymentMethod !== 'credit' && tendered < bill.total) {
    pricing = price('credit');
    bill = apply(pricing);
  }
  const { items: pricedItems, subtotal, lineDiscounts, deliveryFee, total } = bill;
  if (total < 0) throw new OpError('Discount is more than the bill');

  // Manual (hand-typed) discount limits for people without the right to exceed them.
  const manualDiscount = input.discount + (pricing ? 0 : lineDiscounts);
  if (manualDiscount > 0) {
    need(c, 'sales.discount.order', 'sales.discount.line', 'sales.discount.above_limit');
    const limitPct = settings?.cashierMaxDiscount ?? 5;
    if (subtotal > 0 && (manualDiscount / subtotal) * 100 > limitPct + 0.001 && !c.can('sales.discount.above_limit')) {
      throw forbidden('DISCOUNT_LIMIT', `Discounts above ${limitPct}% need a manager`);
    }
  }

  const cashTendered = payments.filter((p) => p.accountId === ACCOUNT_IDS.cash).reduce((sum, p) => sum + p.amount, 0);
  if (tendered - cashTendered > total) throw new OpError('Card/wallet payments are more than the bill');
  const change = Math.max(0, tendered - total);
  if (change > cashTendered) throw new OpError('Change can only be given from cash');
  const credit = Math.max(0, total - tendered);
  if (credit > 0) need(c, 'sales.credit');
  if (credit > 0 && !input.customerId) throw new OpError('Select a customer for udhaar (credit) sale');
  if (input.homeDelivery && !input.deliveryAddress?.trim()) throw new OpError('Enter the delivery address');
  if (input.homeDelivery && !input.customerId) throw new OpError('Select a customer for home delivery');
  if ((credit > 0 || input.homeDelivery || input.pricingMode === 'cost' || input.pricingMode === 'business') && input.customerId && !(await s.get<Customer>('customers', input.customerId))) {
    throw new OpError('Select an available customer for credit, home delivery, or customer pricing');
  }
  for (const p of payments) {
    const account = await s.get<Account>('accounts', p.accountId);
    if (!account?.active) throw new OpError('A selected payment account is unavailable');
  }

  const date = input.date && c.can('sales.price_override') ? input.date : now(c);
  const id = newId(c);
  const no = await s.nextNumber('sale', invoiceNumberPrefix(date));
  const items: SaleItem[] = [];
  for (const line of pricedItems) {
    const product = productById.get(line.productId)!;
    items.push({ productId: product.id, name: product.name, unit: product.unit, qty: line.qty, price: line.price, discount: line.discount, cost: product.cost, returnedQty: 0 });
    if (!product.isService && product.trackStock !== false) {
      await s.put('products', { ...product, stock: roundQty(product.stock - line.qty) });
      await putMove(s, c, { productId: product.id, date, qty: -line.qty, type: 'sale', cost: product.cost, refId: id });
    }
  }
  for (const p of payments) {
    const amount = p.accountId === ACCOUNT_IDS.cash ? p.amount - change : p.amount;
    if (amount > 0) await putAccountTxn(s, c, { accountId: p.accountId, date, amount, type: 'sale', refId: id, note: no });
  }
  if (credit > 0) {
    await s.put('partyEntries', { id: newId(c), partyType: 'customer', partyId: input.customerId!, date, amount: credit, type: 'sale', refId: id, note: no });
  }
  const sale: Sale = {
    id,
    no,
    date,
    ...(input.customerId ? { customerId: input.customerId } : {}),
    ...(input.gharOrderId ? { gharOrderId: input.gharOrderId } : {}),
    ...(input.deliveryAddress ? { deliveryAddress: input.deliveryAddress } : {}),
    pricingMode: input.pricingMode ?? 'normal',
    paymentMethod: credit > 0 ? 'credit' : (input.paymentMethod ?? 'cash'),
    items,
    subtotal,
    discount: input.discount,
    deliveryFee,
    total,
    paid: total - credit,
    change,
    credit,
    payments,
    userId: c.userId,
    status: 'completed',
    returnedTotal: 0,
    ...(input.note ? { note: input.note } : {}),
  };
  await s.put('sales', sale);
  if (input.gharOrderId) {
    const order = await s.getForUpdate<GharOrder>('gharOrders', input.gharOrderId);
    if (order) await s.put('gharOrders', { ...order, status: 'delivered', saleId: id });
  }
  return sale;
}

const toPricingProduct = (p: Product, includeCost = true) => ({
  id: p.id,
  salePrice: p.salePrice,
  cost: includeCost ? p.cost : 0,
  thresholdPrice: p.thresholdPrice ?? null,
  thresholdDiscountEnabled: p.thresholdDiscountEnabled,
  thresholdDiscountAmount: p.thresholdDiscountAmount ?? null,
  quantityPrices: p.quantityPrices ?? [],
  wholesalePrice: p.wholesalePrice ?? null,
  categoryId: p.categoryId ?? null,
});

async function putMove(s: ShopStore, c: OpContext, m: Omit<StockMove, 'id'>) {
  await s.put('stockMoves', { ...m, id: newId(c) });
}
async function putAccountTxn(s: ShopStore, c: OpContext, t: Omit<AccountTxn, 'id'>) {
  await s.put('accountTxns', { ...t, id: newId(c) });
}

/** Net value of `q` units of a sale line, after line and bill discounts. */
export function returnValue(sale: Sale, item: SaleItem, q: number): number {
  const lineNet = lineTotal(item.price, item.qty) - item.discount;
  const perUnit = item.qty > 0 ? lineNet / item.qty : 0;
  const lineDiscounts = sale.items.reduce((sum, i) => sum + i.discount, 0);
  const linesGross = sale.items.reduce((sum, i) => sum + lineTotal(i.price, i.qty), 0);
  const storedSubtotal = sale.subtotal >= linesGross ? sale.subtotal - lineDiscounts : sale.subtotal;
  const billFactor = storedSubtotal > 0 ? Math.max(0, storedSubtotal - sale.discount) / storedSubtotal : 1;
  return Math.round(perUnit * q * billFactor);
}

export async function returnSaleItems(
  s: ShopStore,
  c: OpContext,
  input: { saleId: string; lines: { productId: string; qty: number }[]; refundTo: 'account' | 'khata'; accountId?: string | undefined; reason?: string | undefined },
): Promise<SaleReturn> {
  need(c, 'sales.return');
  const sale = await s.getForUpdate<Sale>('sales', input.saleId);
  if (!sale || sale.status === 'void') throw new OpError('Sale not found');
  if (input.refundTo === 'khata' && !sale.customerId) throw new OpError('This sale has no customer khata');
  const date = now(c);
  const id = newId(c);
  const items: SaleReturn['items'] = [];
  for (const line of input.lines) {
    if (!isQty(line.qty) || line.qty <= 0) continue;
    const item = sale.items.find((i) => i.productId === line.productId);
    if (!item) throw new OpError('Item is not in this sale');
    if (line.qty > roundQty(item.qty - item.returnedQty)) throw new OpError(`Cannot return more ${item.name} than was sold`);
    const amount = returnValue(sale, item, line.qty);
    items.push({ productId: item.productId, name: item.name, qty: line.qty, amount, cost: item.cost });
    item.returnedQty = roundQty(item.returnedQty + line.qty);
    const product = await s.getForUpdate<Product>('products', item.productId);
    if (product && !product.isService && product.trackStock !== false) {
      await s.put('products', { ...product, stock: roundQty(product.stock + line.qty) });
      await putMove(s, c, { productId: item.productId, date, qty: line.qty, type: 'return', cost: item.cost, refId: id });
    }
  }
  if (items.length === 0) throw new OpError('Nothing to return');
  const amount = items.reduce((sum, i) => sum + i.amount, 0);
  if (input.refundTo === 'khata') {
    await s.put('partyEntries', { id: newId(c), partyType: 'customer', partyId: sale.customerId!, date, amount: -amount, type: 'return', refId: id, note: `Return ${sale.no}` });
  } else {
    const accountId = input.accountId ?? ACCOUNT_IDS.cash;
    if (!(await s.get<Account>('accounts', accountId))) throw new OpError('Refund account not found');
    await putAccountTxn(s, c, { accountId, date, amount: -amount, type: 'refund', refId: id, note: `Return ${sale.no}` });
  }
  await s.put('sales', { ...sale, items: sale.items, returnedTotal: sale.returnedTotal + amount });
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
    userId: c.userId,
  };
  await s.put('saleReturns', ret);
  return ret;
}

/** Cancel a sale completely: stock goes back, payments and khata are reversed. */
export async function voidSale(s: ShopStore, c: OpContext, saleId: string, reason: string): Promise<void> {
  need(c, 'sales.void');
  const sale = await s.getForUpdate<Sale>('sales', saleId);
  if (!sale || sale.status === 'void') throw new OpError('Sale not found');
  if (sale.returnedTotal > 0) throw new OpError('Items were already returned from this sale; use Return instead');
  const date = now(c);
  for (const item of sale.items) {
    const product = await s.getForUpdate<Product>('products', item.productId);
    if (product && !product.isService && product.trackStock !== false) {
      await s.put('products', { ...product, stock: roundQty(product.stock + item.qty) });
      await putMove(s, c, { productId: item.productId, date, qty: item.qty, type: 'return', cost: item.cost, refId: sale.id, note: 'Void' });
    }
  }
  for (const t of await s.list<AccountTxn>('accountTxns', { k4: sale.id })) {
    await putAccountTxn(s, c, { accountId: t.accountId, date, amount: -t.amount, type: 'refund', refId: sale.id, note: `Void ${sale.no}` });
  }
  if (sale.credit > 0 && sale.customerId) {
    await s.put('partyEntries', { id: newId(c), partyType: 'customer', partyId: sale.customerId, date, amount: -sale.credit, type: 'return', refId: sale.id, note: `Void ${sale.no}` });
  }
  await s.put('sales', { ...sale, status: 'void', note: reason });
}

// ------------------------------------------------------------------ stock and purchasing

export async function recordPurchase(
  s: ShopStore,
  c: OpContext,
  input: {
    supplierId: string;
    date?: string | undefined;
    invoiceNo?: string | undefined;
    items: { productId: string; qty: number; cost: number; previousCost?: number | undefined; total?: number | undefined }[];
    payments: { accountId: string; amount: number }[];
    note?: string | undefined;
  },
): Promise<Purchase> {
  need(c, 'purchasing.receive');
  const items = input.items.filter((i) => i.qty > 0);
  if (items.length === 0) throw new OpError('Add at least one item');
  if (items.some((item) => !isQty(item.qty) || !isMoney(item.cost) || item.cost < 0 || (item.total !== undefined && (!isMoney(item.total) || item.total < 0)))) {
    throw new OpError('Purchase quantity and cost must be valid nonnegative amounts');
  }
  if (input.payments.some((p) => !isMoney(p.amount) || p.amount < 0)) throw new OpError('Payment amounts cannot be negative or invalid');
  if (new Set(items.map((i) => i.productId)).size !== items.length) throw new OpError('The same product appears twice in this purchase');
  const payments = input.payments.filter((p) => p.amount > 0);
  if (payments.some((p) => !p.accountId)) throw new OpError('Choose a valid payment account and amount');
  if (payments.length > 0) need(c, 'suppliers.pay');
  const total = items.reduce((sum, i) => sum + (i.total ?? lineTotal(i.cost, i.qty)), 0);
  const summary = summarizePurchasePayments(total, payments.map((p) => p.amount));
  if (summary.overpayment > 0) throw new OpError('Payment exceeds purchase total');

  if (!(await s.get<Supplier>('suppliers', input.supplierId))) throw new OpError('Supplier not found');
  for (const payment of payments) {
    const account = await s.get<Account>('accounts', payment.accountId);
    if (!account?.active) throw new OpError('A selected payment account is unavailable');
  }
  const date = input.date ?? now(c);
  const id = newId(c);
  const no = await s.nextNumber('purchase', 'PUR');
  const lines: Purchase['items'] = [];
  for (const i of [...items].sort((a, b) => a.productId.localeCompare(b.productId))) {
    const product = await s.getForUpdate<Product>('products', i.productId);
    if (!product) throw new OpError('Product not found');
    if (product.isService || product.trackStock === false) throw new OpError(`${product.name} is not a stock-tracked product`);
    const newStock = roundQty(product.stock + i.qty);
    const newCost = product.stock > 0 && newStock > 0 ? Math.round((product.stock * product.cost + i.qty * i.cost) / newStock) : i.cost;
    await s.put('products', { ...product, stock: newStock, cost: newCost, ...(product.supplierId ? {} : { supplierId: input.supplierId }) });
    await putMove(s, c, { productId: product.id, date, qty: i.qty, type: 'purchase', cost: i.cost, refId: id });
    lines.push({ productId: product.id, name: product.name, qty: i.qty, cost: i.cost, ...(i.previousCost === undefined ? {} : { previousCost: i.previousCost }) });
  }
  if (summary.credit > 0) {
    await s.put('partyEntries', { id: newId(c), partyType: 'supplier', partyId: input.supplierId, date, amount: summary.credit, type: 'purchase', refId: id, note: no });
  }
  for (const payment of payments) {
    await putAccountTxn(s, c, { accountId: payment.accountId, date, amount: -payment.amount, type: 'purchase', refId: id, note: no });
  }
  const purchase: Purchase = {
    id,
    no,
    date,
    supplierId: input.supplierId,
    ...(input.invoiceNo ? { invoiceNo: input.invoiceNo } : {}),
    items: lines,
    total,
    paid: summary.paid,
    payments,
    ...(payments.length === 1 ? { accountId: payments[0]!.accountId } : {}),
    ...(input.note ? { note: input.note } : {}),
  };
  await s.put('purchases', purchase);
  // Keep input order stable for the caller's receipt.
  purchase.items.sort((a, b) => items.findIndex((i) => i.productId === a.productId) - items.findIndex((i) => i.productId === b.productId));
  return purchase;
}

/** Manual stock change with a reason. Adding stock with a cost updates the average cost. */
export async function adjustStock(
  s: ShopStore,
  c: OpContext,
  input: { productId: string; qty: number; type: 'opening' | 'adjust' | 'damage' | 'expiry'; date?: string | undefined; cost?: number | undefined; note?: string | undefined },
): Promise<void> {
  need(c, 'inventory.adjust');
  if (!isQty(input.qty) || input.qty === 0) throw new OpError('Quantity cannot be zero');
  if (input.cost !== undefined && (!isMoney(input.cost) || input.cost < 0)) throw new OpError('Cost must be a whole amount of paisa');
  const product = await s.getForUpdate<Product>('products', input.productId);
  if (!product) throw new OpError('Product not found');
  if (product.isService || product.trackStock === false) throw new OpError(`${product.name} does not track stock`);
  const newStock = roundQty(product.stock + input.qty);
  let cost = product.cost;
  if (input.qty > 0 && input.cost !== undefined && input.cost > 0) {
    cost = product.stock > 0 && newStock > 0 ? Math.round((product.stock * product.cost + input.qty * input.cost) / newStock) : input.cost;
  }
  await s.put('products', { ...product, stock: newStock, cost });
  await putMove(s, c, {
    productId: product.id,
    date: input.date ?? now(c),
    qty: input.qty,
    type: input.type,
    cost: input.qty > 0 && input.cost ? input.cost : product.cost,
    ...(input.note ? { note: input.note } : {}),
  });
}

// ------------------------------------------------------------------ khata

export async function receiveCustomerPayment(s: ShopStore, c: OpContext, customerId: string, amount: number, accountId: string, note?: string): Promise<void> {
  need(c, 'customers.receive_payment');
  if (!isMoney(amount) || amount <= 0) throw new OpError('Enter an amount');
  if (!(await s.get<Customer>('customers', customerId))) throw new OpError('Customer not found');
  const account = await s.get<Account>('accounts', accountId);
  if (!account?.active) throw new OpError('A selected payment account is unavailable');
  const id = newId(c);
  const date = now(c);
  await s.put('partyEntries', { id, partyType: 'customer', partyId: customerId, date, amount: -amount, type: 'payment', note: note || 'Payment received' });
  await putAccountTxn(s, c, { accountId, date, amount, type: 'customer_payment', refId: id, note: note || 'Customer payment' });
}

export async function paySupplier(s: ShopStore, c: OpContext, supplierId: string, amount: number, accountId: string, note?: string): Promise<void> {
  need(c, 'suppliers.pay');
  if (!isMoney(amount) || amount <= 0) throw new OpError('Enter an amount');
  if (!(await s.get<Supplier>('suppliers', supplierId))) throw new OpError('Supplier not found');
  const account = await s.get<Account>('accounts', accountId);
  if (!account?.active) throw new OpError('A selected payment account is unavailable');
  const id = newId(c);
  const date = now(c);
  await s.put('partyEntries', { id, partyType: 'supplier', partyId: supplierId, date, amount: -amount, type: 'payment', note: note || 'Payment made' });
  await putAccountTxn(s, c, { accountId, date, amount: -amount, type: 'supplier_payment', refId: id, note: note || 'Supplier payment' });
}

/** Opening balance or manual correction on a customer/supplier khata. */
export async function addPartyAdjustment(
  s: ShopStore,
  c: OpContext,
  input: { partyType: 'customer' | 'supplier'; partyId: string; amount: number; note: string; type?: 'opening' | 'adjustment' | undefined; date?: string | undefined },
): Promise<void> {
  need(c, input.partyType === 'customer' ? 'customers.manage' : 'suppliers.manage');
  if (!isMoney(input.amount)) throw new OpError('Amount must be a whole amount of paisa');
  if (input.amount === 0) return;
  const exists = input.partyType === 'customer' ? await s.get<Customer>('customers', input.partyId) : await s.get<Supplier>('suppliers', input.partyId);
  if (!exists) throw new OpError(`${input.partyType === 'customer' ? 'Customer' : 'Supplier'} not found`);
  await s.put('partyEntries', { id: newId(c), partyType: input.partyType, partyId: input.partyId, date: input.date ?? now(c), amount: input.amount, type: input.type ?? 'adjustment', note: input.note });
}

// ------------------------------------------------------------------ money

export async function addExpense(s: ShopStore, c: OpContext, input: Omit<Expense, 'id' | 'date' | 'userId'> & { date?: string | undefined }): Promise<Expense> {
  need(c, input.kind === 'drawing' ? 'owner.drawings' : 'expenses.create');
  if (!isMoney(input.amount) || input.amount <= 0) throw new OpError('Enter an amount');
  if (!input.category?.trim()) throw new OpError('Choose a category');
  const account = await s.get<Account>('accounts', input.accountId);
  if (!account?.active) throw new OpError('A selected payment account is unavailable');
  const id = newId(c);
  const date = input.date ?? now(c);
  const expense: Expense = { id, date, kind: input.kind, category: input.category, amount: input.amount, accountId: input.accountId, ...(input.note ? { note: input.note } : {}), userId: c.userId };
  await s.put('expenses', expense);
  await putAccountTxn(s, c, { accountId: input.accountId, date, amount: -input.amount, type: input.kind === 'drawing' ? 'drawing' : 'expense', refId: id, note: input.kind === 'drawing' ? 'Owner withdrawal' : input.category });
  return expense;
}

export async function deleteExpense(s: ShopStore, c: OpContext, id: string): Promise<void> {
  need(c, 'expenses.edit_void');
  await s.remove('expenses', id);
  for (const t of await s.list<AccountTxn>('accountTxns', { k4: id })) await s.remove('accountTxns', t.id);
}

export async function transferMoney(s: ShopStore, c: OpContext, fromId: string, toId: string, amount: number, note?: string): Promise<void> {
  need(c, 'cash.transfer');
  if (!isMoney(amount) || amount <= 0) throw new OpError('Enter an amount');
  if (fromId === toId) throw new OpError('Choose two different accounts');
  for (const accountId of [fromId, toId]) if (!(await s.get<Account>('accounts', accountId))?.active) throw new OpError('A selected account is unavailable');
  const ref = newId(c);
  const date = now(c);
  await putAccountTxn(s, c, { accountId: fromId, date, amount: -amount, type: 'transfer', refId: ref, note: note || 'Transfer out' });
  await putAccountTxn(s, c, { accountId: toId, date, amount, type: 'transfer', refId: ref, note: note || 'Transfer in' });
}

export async function adjustAccount(s: ShopStore, c: OpContext, accountId: string, amount: number, note: string): Promise<void> {
  need(c, 'cash.adjust');
  if (!isMoney(amount)) throw new OpError('Amount must be a whole amount of paisa');
  if (amount === 0) return;
  if (!(await s.get<Account>('accounts', accountId))) throw new OpError('Account not found');
  await putAccountTxn(s, c, { accountId, date: now(c), amount, type: 'adjustment', note });
}

export const SERVICE_TYPES: Record<ServiceType, { label: string; floatSign: -1 | 1; cashSign: -1 | 1 }> = {
  cash_in: { label: 'Cash In (deposit)', floatSign: -1, cashSign: 1 },
  send_money: { label: 'Send Money', floatSign: -1, cashSign: 1 },
  bill: { label: 'Bill Payment', floatSign: -1, cashSign: 1 },
  load: { label: 'Mobile Load', floatSign: -1, cashSign: 1 },
  cash_out: { label: 'Cash Out (withdrawal)', floatSign: 1, cashSign: -1 },
};

/** Easypaisa / JazzCash retailer transaction: the provider float and the shop cash both move. */
export async function addServiceTxn(s: ShopStore, c: OpContext, input: Omit<ServiceTxn, 'id' | 'date' | 'userId'>): Promise<ServiceTxn> {
  need(c, 'retailer.transact');
  if (!isMoney(input.amount) || input.amount <= 0) throw new OpError('Enter an amount');
  if (!isMoney(input.fee) || input.fee < 0 || !isMoney(input.commission) || input.commission < 0) throw new OpError('Fee and commission must be whole paisa, not negative');
  const t = SERVICE_TYPES[input.type];
  if (!t) throw new OpError('Unknown transaction type');
  const floatAccount = (await s.list<Account>('accounts')).find((a) => a.provider === input.provider);
  if (!floatAccount) throw new OpError(`No account set up for ${input.provider}`);
  const id = newId(c);
  const date = now(c);
  const txn: ServiceTxn = { ...input, id, date, userId: c.userId };
  await s.put('serviceTxns', txn);
  const label = `${input.provider} ${t.label}`;
  await putAccountTxn(s, c, { accountId: floatAccount.id, date, amount: t.floatSign * input.amount, type: 'service', refId: id, note: label });
  await putAccountTxn(s, c, { accountId: ACCOUNT_IDS.cash, date, amount: t.cashSign * input.amount, type: 'service', refId: id, note: label });
  if (input.fee > 0) await putAccountTxn(s, c, { accountId: ACCOUNT_IDS.cash, date, amount: input.fee, type: 'service', refId: id, note: `${input.provider} fee` });
  if (input.commission > 0) await putAccountTxn(s, c, { accountId: floatAccount.id, date, amount: input.commission, type: 'service', refId: id, note: `${input.provider} commission` });
  return txn;
}

export async function deleteServiceTxn(s: ShopStore, c: OpContext, id: string): Promise<void> {
  need(c, 'retailer.reverse');
  await s.remove('serviceTxns', id);
  for (const t of await s.list<AccountTxn>('accountTxns', { k4: id })) await s.remove('accountTxns', t.id);
}

export async function accountBalance(s: ShopStore, accountId: string): Promise<number> {
  return s.sum('accountTxns', 'amount', { k2: accountId });
}

/**
 * Daily closing: compare counted money with what the books expect. The difference is booked as an
 * adjustment so the next day starts from the real amount.
 */
export async function saveClosing(s: ShopStore, c: OpContext, input: { accountId: string; counted: number; note?: string | undefined }) {
  need(c, 'cash.session.open_close');
  if (!isMoney(input.counted) || input.counted < 0) throw new OpError('Counted amount must be whole paisa, not negative');
  if (!(await s.get<Account>('accounts', input.accountId))) throw new OpError('Account not found');
  const expected = await accountBalance(s, input.accountId);
  const difference = input.counted - expected;
  const id = newId(c);
  const date = now(c);
  await s.put('closings', { id, date, accountId: input.accountId, expected, counted: input.counted, difference, ...(input.note ? { note: input.note } : {}), userId: c.userId });
  if (difference !== 0) await putAccountTxn(s, c, { accountId: input.accountId, date, amount: difference, type: 'adjustment', refId: id, note: 'Closing difference' });
}

// ------------------------------------------------------------------ first-run setup

export const DEFAULT_CATEGORIES = ['Karyana', 'Grocery', 'Beverages', 'Biscuits & Snacks', 'Dairy', 'Personal Care', 'Household', 'Cooking Oil & Ghee', 'Spices'];

/** Update only voice aliases; settings managers need not have permission to edit product details. */
export async function saveVoiceKeywords(
  s: ShopStore,
  c: OpContext,
  input: { productId: string; voiceKeywords: string[] },
): Promise<void> {
  need(c, 'settings.manage', 'products.edit');
  const product = await s.getForUpdate<Product>('products', input.productId);
  if (!product) throw new OpError('Product no longer exists');
  const seen = new Set<string>();
  const voiceKeywords = input.voiceKeywords
    .map((keyword) => keyword.trim())
    .filter((keyword) => {
      const normalized = keyword.toLocaleLowerCase();
      if (!normalized || normalized === product.name.trim().toLocaleLowerCase() || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
  await s.put('products', { ...product, voiceKeywords });
}

/** First run: shop settings, default payment accounts, categories and counters. Only once. */
export async function setupShop(s: ShopStore, c: OpContext, input: { shopName: string; address: string; phone: string; openingCash: number }): Promise<void> {
  need(c, 'settings.manage');
  if (await s.get('settings', 'shop')) throw new OpError('The shop is already set up');
  if (!input.shopName.trim()) throw new OpError('Enter the shop name');
  if (!isMoney(input.openingCash) || input.openingCash < 0) throw new OpError('Opening cash must be whole paisa, not negative');
  await s.put('settings', {
    id: 'shop',
    shopName: input.shopName.trim(),
    address: input.address,
    phone: input.phone,
    receiptFooter: 'Thank you for shopping with us!',
    leadDays: 2,
    discrepancyLimit: 50000,
    cashierMaxDiscount: 5,
    autoDiscountMinOrder: 500000,
    autoDiscountPct: 10,
    autoDiscountMaxPct: 70,
    autoDiscountMaxProfitPct: 30,
    autoDiscountCategoryId: 'all',
    autoDiscountEnabled: true,
    autoDiscountCategoryRules: [],
    homeDeliveryEnabled: true,
    deliveryCharge: 20000,
    freeDeliveryThreshold: 500000,
    businessPricingEnabled: true,
    gharDiscountPct: 5,
    gharMinimumMarginPct: 10,
    gharDeliveryFee: 15000,
    gharFreeDeliveryThreshold: 400000,
    setupDone: true,
  });
  const accounts: Account[] = [
    { id: ACCOUNT_IDS.cash, name: 'Cash Drawer', type: 'cash', active: true },
    { id: ACCOUNT_IDS.bank, name: 'Bank', type: 'bank', active: true },
    { id: ACCOUNT_IDS.easypaisa, name: 'Easypaisa', type: 'wallet', provider: 'Easypaisa', active: true },
    { id: ACCOUNT_IDS.jazzcash, name: 'JazzCash', type: 'wallet', provider: 'JazzCash', active: true },
  ];
  for (const a of accounts) await s.put('accounts', a);
  if (input.openingCash > 0) await putAccountTxn(s, c, { accountId: ACCOUNT_IDS.cash, date: now(c), amount: input.openingCash, type: 'opening', note: 'Opening cash' });
  for (const name of DEFAULT_CATEGORIES) await s.put('categories', { id: newId(c), name });
  for (const kind of ['sale', 'purchase', 'ghar'] as const) await s.put('counters', { id: kind, value: 0 });
}

// ------------------------------------------------------------------ bulk product import

export interface ImportRecord {
  sku: string;
  name: string;
  nameUr?: string | undefined;
  voiceKeywords?: string[] | undefined;
  barcode?: string | undefined;
  category?: string | undefined;
  supplier?: string | undefined;
  unit: string;
  packName?: string | undefined;
  packSize?: number | undefined;
  salePrice: number;
  thresholdPrice?: number | undefined;
  wholesalePrice?: number | undefined;
  cost?: number | undefined;
  openingStock: number;
  minStock: number;
  favorite: boolean;
  active: boolean;
}

/** Archive selected products or permanently remove them when they have no inventory or history. */
export async function manageProducts(
  s: ShopStore,
  c: OpContext,
  input: { action: 'archive' | 'activate' | 'delete'; ids: string[] },
): Promise<{ changed: number }> {
  need(c, input.action === 'delete' ? 'products.delete' : 'products.edit');

  const selected: Product[] = [];
  for (const id of [...input.ids].sort()) {
    const product = await s.getForUpdate<Product>('products', id);
    if (!product) throw new OpError(`Product ${id} no longer exists`);
    selected.push(product);
  }

  if (input.action !== 'delete') {
    const active = input.action === 'activate';
    for (const product of selected) {
      if (product.active !== active) await s.put('products', { ...product, active });
    }
    return { changed: selected.filter((product) => product.active !== active).length };
  }

  const ids = new Set(input.ids);
  const [sales, saleReturns, purchases, stockMoves, gharOrders, heldCarts, voiceLogs] = await Promise.all([
    s.list<{ id: string; items?: { productId?: string }[] }>('sales'),
    s.list<{ id: string; items?: { productId?: string }[] }>('saleReturns'),
    s.list<{ id: string; items?: { productId?: string }[] }>('purchases'),
    s.list<{ id: string; productId?: string }>('stockMoves'),
    s.list<{ id: string; items?: { productId?: string }[] }>('gharOrders'),
    s.list<{ id: string; items?: { productId?: string }[] }>('heldCarts'),
    s.list<{ id: string; productIds?: string[] }>('voiceLogs'),
  ]);
  const referencesProduct = (documents: { items?: { productId?: string }[] }[]) =>
    documents.some((document) => document.items?.some((item) => item.productId && ids.has(item.productId)));
  const hasHistory =
    selected.some((product) => product.stock !== 0) ||
    referencesProduct(sales) ||
    referencesProduct(saleReturns) ||
    referencesProduct(purchases) ||
    stockMoves.some((move) => move.productId && ids.has(move.productId)) ||
    referencesProduct(gharOrders) ||
    referencesProduct(heldCarts) ||
    voiceLogs.some((log) => log.productIds?.some((id) => ids.has(id)));
  if (hasHistory) throw new OpError('Some selected products have stock or transaction history. Archive them instead to preserve records.');

  for (const product of selected) await s.remove('products', product.id);
  return { changed: selected.length };
}

/** Apply selected catalog fields to many products without changing stock, prices, or sales history. */
export async function bulkUpdateProducts(
  s: ShopStore,
  c: OpContext,
  input: {
    ids: string[];
    categoryId?: string | null;
    supplierId?: string | null;
    unit?: string;
    thresholdDiscountEnabled?: boolean;
    thresholdDiscountAmount?: number | null;
  },
): Promise<{ changed: number }> {
  need(c, 'products.edit');
  if (input.thresholdDiscountEnabled !== undefined || input.thresholdDiscountAmount !== undefined) need(c, 'products.edit_price');
  if (input.categoryId) {
    const category = await s.get('categories', input.categoryId);
    if (!category) throw new OpError('Selected category no longer exists');
  }
  if (input.supplierId) {
    const supplier = await s.get('suppliers', input.supplierId);
    if (!supplier) throw new OpError('Selected supplier no longer exists');
  }

  const selected: Product[] = [];
  for (const id of [...input.ids].sort()) {
    const product = await s.getForUpdate<Product>('products', id);
    if (!product) throw new OpError(`Product ${id} no longer exists`);
    selected.push(product);
  }

  for (const product of selected) {
    await s.put('products', {
      ...product,
      ...(input.categoryId !== undefined ? { categoryId: input.categoryId ?? undefined } : {}),
      ...(input.supplierId !== undefined ? { supplierId: input.supplierId ?? undefined } : {}),
      ...(input.unit !== undefined ? { unit: input.unit } : {}),
      ...(!product.isService && input.thresholdDiscountEnabled !== undefined
        ? { thresholdDiscountEnabled: input.thresholdDiscountEnabled }
        : {}),
      ...(!product.isService && input.thresholdDiscountAmount !== undefined
        ? { thresholdDiscountAmount: input.thresholdDiscountAmount === null ? undefined : input.thresholdDiscountAmount, thresholdPrice: undefined }
        : {}),
    });
  }
  return { changed: selected.length };
}

type MasterCollection = 'categories' | 'customers' | 'suppliers';
type MasterRecord = { id: string; name: string; [key: string]: unknown };

/** Create, edit safe shared fields, or remove selected master records without touching financial history. */
export async function bulkMasterRecords(
  s: ShopStore,
  c: OpContext,
  input: {
    entity: MasterCollection;
    action: 'create' | 'update' | 'delete';
    ids?: string[];
    records?: Record<string, unknown>[];
    updates?: Record<string, unknown>;
  },
): Promise<{ changed: number }> {
  const permission: Permission = input.entity === 'categories' ? 'products.edit' : input.entity === 'customers' ? 'customers.manage' : 'suppliers.manage';
  need(c, permission);
  const collection = input.entity;
  const current = await s.list<MasterRecord>(collection);

  if (input.action === 'create') {
    const records = input.records ?? [];
    const names = new Set(current.map((item) => item.name.trim().toLowerCase()));
    for (const record of records) {
      const normalized = String(record.name ?? '').trim().toLowerCase();
      if (names.has(normalized)) throw new OpError(`A ${input.entity.slice(0, -1)} named "${record.name}" already exists`);
      names.add(normalized);
    }
    for (const record of records) {
      const base = { id: newId(c), name: String(record.name).trim(), createdAt: now(c) };
      const doc = collection === 'categories'
        ? base
        : collection === 'customers'
          ? { ...base, phone: record.phone, address: record.address, creditLimit: 0, shopkeeperPricing: record.shopkeeperPricing ?? false }
          : { ...base, phone: record.phone, company: record.company, orderDay: record.orderDay, leadDays: record.leadDays };
      await s.put(collection, doc as MasterRecord);
    }
    return { changed: records.length };
  }

  const selected: MasterRecord[] = [];
  for (const id of [...(input.ids ?? [])].sort()) {
    const record = await s.getForUpdate<MasterRecord>(collection, id);
    if (!record) throw new OpError(`Selected ${input.entity.slice(0, -1)} ${id} no longer exists`);
    selected.push(record);
  }

  if (input.action === 'update') {
    if (collection === 'categories') throw new OpError('Bulk category field updates are not supported');
    const updates = input.updates ?? {};
    const allowedFields = collection === 'customers'
      ? ['shopkeeperPricing', 'phone', 'address']
      : ['company', 'phone', 'leadDays', 'orderDay'];
    if (!Object.keys(updates).length || Object.keys(updates).some((field) => !allowedFields.includes(field))) {
      throw new OpError('Bulk update contains unsupported fields');
    }
    for (const record of selected) await s.put(collection, { ...record, ...updates } as MasterRecord);
    return { changed: selected.length };
  }

  const ids = new Set(selected.map((record) => record.id));
  if (collection === 'categories') {
    if ((await s.list<Product>('products')).some((product) => product.categoryId && ids.has(product.categoryId))) {
      throw new OpError('Some selected categories are used by products. Move those products first.');
    }
  } else if (collection === 'customers') {
    const [sales, returns, orders, entries] = await Promise.all([
      s.list<{ id: string; customerId?: string }>('sales'),
      s.list<{ id: string; customerId?: string }>('saleReturns'),
      s.list<{ id: string; customerId?: string }>('gharOrders'),
      s.list<{ id: string; partyId?: string; partyType?: string }>('partyEntries'),
    ]);
    if ([...sales, ...returns, ...orders].some((doc) => doc.customerId && ids.has(doc.customerId)) ||
      entries.some((entry) => entry.partyType === 'customer' && entry.partyId && ids.has(entry.partyId)) ||
      (await s.list<Customer>('customers')).some((customer) => ids.has(customer.id) && customer.creditLimit > 0)) {
      throw new OpError('Some selected customers have transaction history or credit settings. Keep them to preserve records.');
    }
  } else {
    const [purchases, entries] = await Promise.all([
      s.list<{ id: string; supplierId?: string }>('purchases'),
      s.list<{ id: string; partyId?: string; partyType?: string }>('partyEntries'),
    ]);
    if (purchases.some((purchase) => purchase.supplierId && ids.has(purchase.supplierId)) ||
      entries.some((entry) => entry.partyType === 'supplier' && entry.partyId && ids.has(entry.partyId))) {
      throw new OpError('Some selected suppliers have transaction history. Keep them to preserve records.');
    }
  }

  for (const record of selected) await s.remove(collection, record.id);
  return { changed: selected.length };
}

/**
 * Create or update products from a spreadsheet (matched by SKU), creating missing categories and
 * suppliers. Stock of an existing product is never changed by an import; a new product's opening
 * stock is recorded as a stock movement. Cost is only taken from the file by people who may edit cost.
 */
export async function importProducts(
  s: ShopStore,
  c: OpContext,
  input: { records: ImportRecord[] },
): Promise<{ added: number; updated: number; suppliersAdded: number; categoriesAdded: number }> {
  need(c, 'products.import');
  const seenSkus = new Set<string>();
  const seenBarcodes = new Set<string>();
  for (const [i, r] of input.records.entries()) {
    const sku = r.sku.toLowerCase();
    if (seenSkus.has(sku)) throw new OpError(`Row ${i + 2}: duplicate SKU ${r.sku} in the file`);
    seenSkus.add(sku);
    if (r.barcode) {
      if (seenBarcodes.has(r.barcode)) throw new OpError(`Row ${i + 2}: duplicate barcode ${r.barcode} in the file`);
      seenBarcodes.add(r.barcode);
    }
  }
  const [currentProducts, currentCategories, currentSuppliers] = await Promise.all([s.list<Product>('products'), s.list<{ id: string; name: string }>('categories'), s.list<Supplier>('suppliers')]);
  const bySku = new Map(currentProducts.map((p) => [p.sku.toLowerCase(), p]));
  const categoriesByName = new Map(currentCategories.map((x) => [x.name.toLowerCase(), x]));
  const suppliersByName = new Map(currentSuppliers.map((x) => [x.name.toLowerCase(), x]));
  const barcodeOwners = new Map(currentProducts.filter((p) => p.barcode).map((p) => [p.barcode!, p.id]));
  const newCategories: { id: string; name: string }[] = [];
  const newSuppliers: Supplier[] = [];
  const importedAt = now(c);
  let added = 0;
  let updated = 0;
  const products: Product[] = [];
  const openingMoves: Omit<StockMove, 'id'>[] = [];

  for (const [i, r] of input.records.entries()) {
    const existing = bySku.get(r.sku.toLowerCase());
    if (r.cost !== undefined && (!existing || r.cost !== existing.cost)) need(c, 'products.edit_cost');
    if (r.barcode) {
      const owner = barcodeOwners.get(r.barcode);
      if (owner && owner !== existing?.id) throw new OpError(`Row ${i + 2}: barcode ${r.barcode} is already assigned to another product`);
    }
    if (existing && (existing.salePrice !== r.salePrice || (r.thresholdPrice !== undefined && r.thresholdPrice !== existing.thresholdPrice) || ((r.wholesalePrice ?? r.cost) !== undefined && (r.wholesalePrice ?? r.cost) !== existing.wholesalePrice))) {
      need(c, 'products.edit_price');
    }
    let category = r.category ? categoriesByName.get(r.category.toLowerCase()) : undefined;
    if (r.category && !category) {
      category = { id: newId(c), name: r.category };
      categoriesByName.set(r.category.toLowerCase(), category);
      newCategories.push(category);
    }
    let supplier = r.supplier ? suppliersByName.get(r.supplier.toLowerCase()) : undefined;
    if (r.supplier && !supplier) {
      supplier = { id: newId(c), name: r.supplier, createdAt: importedAt };
      suppliersByName.set(r.supplier.toLowerCase(), supplier);
      newSuppliers.push(supplier);
    }
    const cost = c.can('products.edit_cost') && r.cost !== undefined ? r.cost : (existing?.cost ?? 0);
    const product: Product = {
      id: existing?.id ?? newId(c),
      name: r.name,
      ...(r.nameUr ? { nameUr: r.nameUr } : {}),
      ...((r.voiceKeywords ?? existing?.voiceKeywords) ? { voiceKeywords: r.voiceKeywords ?? existing?.voiceKeywords } : {}),
      sku: r.sku,
      ...(r.barcode ? { barcode: r.barcode } : {}),
      ...(category ? { categoryId: category.id } : {}),
      ...(supplier ? { supplierId: supplier.id } : {}),
      unit: r.unit,
      ...(r.packName ? { packName: r.packName } : {}),
      ...(r.packSize ? { packSize: r.packSize } : {}),
      salePrice: r.salePrice,
      ...((r.thresholdPrice ?? existing?.thresholdPrice) !== undefined ? { thresholdPrice: (r.thresholdPrice ?? existing?.thresholdPrice)! } : {}),
      ...((r.wholesalePrice ?? r.cost ?? existing?.wholesalePrice) !== undefined ? { wholesalePrice: (r.wholesalePrice ?? r.cost ?? existing?.wholesalePrice)! } : {}),
      cost,
      stock: existing?.stock ?? r.openingStock,
      minStock: r.minStock,
      favorite: r.favorite,
      active: r.active,
      createdAt: existing?.createdAt ?? importedAt,
    };
    if (existing) updated += 1;
    else {
      added += 1;
      if (r.openingStock > 0) openingMoves.push({ productId: product.id, date: importedAt, qty: r.openingStock, type: 'opening', cost, note: 'Opening stock (bulk import)' });
    }
    products.push(product);
  }
  for (const x of newCategories) await s.put('categories', x);
  for (const x of newSuppliers) await s.put('suppliers', x);
  for (const p of products) await s.put('products', p);
  for (const m of openingMoves) await putMove(s, c, m);
  return { added, updated, suppliersAdded: newSuppliers.length, categoriesAdded: newCategories.length };
}
