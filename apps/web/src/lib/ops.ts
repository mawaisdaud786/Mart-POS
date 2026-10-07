import type { Expense, Payment, Purchase, Sale, SaleItem, SaleReturn, ServiceTxn, ServiceType } from '@retailos/domain';
import { ApiError, apiRequest } from './api';
import { invalidate, notifyChange } from './store';
import { lineTotal } from './format';

/**
 * Business operations. Each one is done by the shop server in a single step that writes every effect
 * together (a sale moves stock, money and khata), so the books always add up. Prices, costs, stock and
 * balances always come from the server's records, never from this page.
 */

/** A rejected operation; `message` is shown to the person using the app. */
export class OpError extends Error {}

async function run<T>(name: string, input: unknown): Promise<T> {
  try {
    const result = await apiRequest<T>(`/shop/ops/${name}`, { method: 'POST', json: input });
    invalidate();
    notifyChange();
    return result;
  } catch (error) {
    // Stock, balances and numbers may have changed under us: reload what is shown.
    if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
      invalidate();
      notifyChange();
      throw new OpError(error.message);
    }
    throw error;
  }
}

export function cartSubtotal(items: Pick<SaleItem, 'price' | 'qty' | 'discount'>[]): number {
  return items.reduce((sum, i) => sum + lineTotal(i.price, i.qty) - i.discount, 0);
}

export interface SaleInput {
  date?: string;
  gharOrderId?: string;
  deliveryAddress?: string;
  pricingMode?: 'normal' | 'business' | 'cost';
  paymentMethod?: 'cash' | 'credit';
  deliveryFee?: number;
  items: Omit<SaleItem, 'cost' | 'returnedQty'>[];
  discount: number;
  customerId?: string;
  payments: Payment[];
  note?: string;
  homeDelivery?: boolean;
}

export const completeSale = (input: SaleInput) => run<Sale>('completeSale', input);

export const saveVoiceKeywords = (productId: string, voiceKeywords: string[]) =>
  run<{ ok: true }>('saveVoiceKeywords', { productId, voiceKeywords }).then(() => undefined);

export const quoteSalePricing = (input: {
  items: { productId: string; qty: number; price?: number }[];
  homeDelivery?: boolean;
}) => apiRequest<{ total: number; lines: { productId: string; price: number; discount: number }[] }>('/shop/pricing/quote', {
  method: 'POST',
  json: input,
});

/** Net value of `q` units of a sale line, after line and bill discounts (for showing a refund before it is made). */
export function returnValue(sale: Sale, item: SaleItem, q: number): number {
  const lineNet = lineTotal(item.price, item.qty) - item.discount;
  const perUnit = item.qty > 0 ? lineNet / item.qty : 0;
  const lineDiscounts = sale.items.reduce((sum, saleItem) => sum + saleItem.discount, 0);
  const linesGross = sale.items.reduce((sum, saleItem) => sum + lineTotal(saleItem.price, saleItem.qty), 0);
  const storedSubtotal = sale.subtotal >= linesGross ? sale.subtotal - lineDiscounts : sale.subtotal;
  const billFactor = storedSubtotal > 0 ? Math.max(0, storedSubtotal - sale.discount) / storedSubtotal : 1;
  return Math.round(perUnit * q * billFactor);
}

export const returnSaleItems = (input: { saleId: string; lines: { productId: string; qty: number }[]; refundTo: 'account' | 'khata'; accountId?: string; reason?: string }) =>
  run<SaleReturn>('returnSaleItems', input);

export const voidSale = (saleId: string, reason: string) => run<{ ok: true }>('voidSale', { saleId, reason }).then(() => undefined);

export const recordPurchase = (input: {
  supplierId: string;
  date?: string;
  invoiceNo?: string;
  items: { productId: string; qty: number; cost: number; previousCost?: number; total?: number }[];
  payments: { accountId: string; amount: number }[];
  note?: string;
}) => run<Purchase>('recordPurchase', input);

export const adjustStock = (input: { productId: string; qty: number; type: 'opening' | 'adjust' | 'damage' | 'expiry'; date?: string; cost?: number; note?: string }) =>
  run<{ ok: true }>('adjustStock', input).then(() => undefined);

export const receiveCustomerPayment = (customerId: string, amount: number, accountId: string, note?: string) =>
  run<{ ok: true }>('receiveCustomerPayment', { customerId, amount, accountId, ...(note ? { note } : {}) }).then(() => undefined);

export const paySupplier = (supplierId: string, amount: number, accountId: string, note?: string) =>
  run<{ ok: true }>('paySupplier', { supplierId, amount, accountId, ...(note ? { note } : {}) }).then(() => undefined);

/** Opening balance or manual correction on a customer/supplier khata. */
export const addPartyAdjustment = (partyType: 'customer' | 'supplier', partyId: string, amount: number, note: string, type: 'opening' | 'adjustment' = 'adjustment', date?: string) =>
  amount === 0 ? Promise.resolve() : run<{ ok: true }>('addPartyAdjustment', { partyType, partyId, amount, note, type, ...(date ? { date } : {}) }).then(() => undefined);

export const addExpense = (input: Omit<Expense, 'id' | 'date' | 'userId'> & { date?: string }) => run<Expense>('addExpense', input).then(() => undefined);

export const deleteExpense = (id: string) => run<{ ok: true }>('deleteExpense', { id }).then(() => undefined);

export const transferMoney = (fromId: string, toId: string, amount: number, note?: string) =>
  run<{ ok: true }>('transferMoney', { fromId, toId, amount, ...(note ? { note } : {}) }).then(() => undefined);

export const adjustAccount = (accountId: string, amount: number, note: string) =>
  amount === 0 ? Promise.resolve() : run<{ ok: true }>('adjustAccount', { accountId, amount, note }).then(() => undefined);

export const SERVICE_TYPES: Record<ServiceType, { label: string; floatSign: -1 | 1; cashSign: -1 | 1 }> = {
  cash_in: { label: 'Cash In (deposit)', floatSign: -1, cashSign: 1 },
  send_money: { label: 'Send Money', floatSign: -1, cashSign: 1 },
  bill: { label: 'Bill Payment', floatSign: -1, cashSign: 1 },
  load: { label: 'Mobile Load', floatSign: -1, cashSign: 1 },
  cash_out: { label: 'Cash Out (withdrawal)', floatSign: 1, cashSign: -1 },
};

export const addServiceTxn = (input: Omit<ServiceTxn, 'id' | 'date' | 'userId'>) => run<ServiceTxn>('addServiceTxn', input).then(() => undefined);

export const deleteServiceTxn = (id: string) => run<{ ok: true }>('deleteServiceTxn', { id }).then(() => undefined);

/** Current balance of one account, summed by the server. */
export async function accountBalance(accountId: string): Promise<number> {
  const balances = await apiRequest<Record<string, number>>('/shop/balances/accounts');
  return balances[accountId] ?? 0;
}

export const saveClosing = (input: { accountId: string; counted: number; note?: string }) => run<{ ok: true }>('saveClosing', input).then(() => undefined);

export const setupShop = (input: { shopName: string; address: string; phone: string; openingCash: number }) => run<{ ok: true }>('setupShop', input).then(() => undefined);

export interface ImportRecord {
  sku: string;
  name: string;
  nameUr?: string;
  voiceKeywords?: string[];
  barcode?: string;
  category?: string;
  supplier?: string;
  unit: string;
  packName?: string;
  packSize?: number;
  salePrice: number;
  thresholdPrice?: number;
  wholesalePrice?: number;
  cost?: number;
  openingStock: number;
  minStock: number;
  favorite: boolean;
  active: boolean;
}

export const importProducts = (records: ImportRecord[]) =>
  run<{ added: number; updated: number; suppliersAdded: number; categoriesAdded: number }>('importProducts', { records });

export const manageProducts = (action: 'archive' | 'activate' | 'delete', ids: string[]) =>
  run<{ changed: number }>('manageProducts', { action, ids });

export const bulkUpdateProducts = (
  ids: string[],
  changes: {
    categoryId?: string | null;
    supplierId?: string | null;
    unit?: string;
    thresholdDiscountEnabled?: boolean;
    thresholdDiscountAmount?: number | null;
  },
) => run<{ changed: number }>('bulkUpdateProducts', { ids, ...changes });

export const bulkMasterRecords = (
  entity: 'categories' | 'customers' | 'suppliers',
  action: 'create' | 'update' | 'delete',
  input: { ids?: string[]; records?: { name: string }[]; updates?: Record<string, unknown> },
) => run<{ changed: number }>('bulkMasterRecords', { entity, action, ...input });
