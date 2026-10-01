import Dexie, { type EntityTable } from 'dexie';

/**
 * Everything is stored in the browser (IndexedDB), so the app works with no server and no
 * internet. Money is stored as whole paisa (Rs 1 = 100) to avoid rounding errors.
 */

export type Role = 'owner' | 'manager' | 'cashier';
export type AccountType = 'cash' | 'bank' | 'wallet';

export interface ShopSettings {
  id: 'shop';
  shopName: string;
  address: string;
  phone: string;
  receiptFooter: string;
  /** Default supplier lead time (days) for reorder suggestions. */
  leadDays: number;
  /** Cash difference (paisa) above which closing needs an explanation. */
  discrepancyLimit: number;
  /** Max discount % a cashier may give. */
  cashierMaxDiscount: number;
  setupDone: boolean;
}

export interface User {
  id: string;
  name: string;
  role: Role;
  pin: string;
  active: boolean;
}

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  /** Set for Easypaisa/JazzCash retailer float accounts. */
  provider?: string;
  active: boolean;
}

export interface AccountTxn {
  id: string;
  accountId: string;
  date: string;
  /** + money in, − money out (paisa). */
  amount: number;
  type:
    | 'opening'
    | 'sale'
    | 'refund'
    | 'customer_payment'
    | 'purchase'
    | 'supplier_payment'
    | 'expense'
    | 'drawing'
    | 'transfer'
    | 'service'
    | 'adjustment';
  refId?: string;
  note?: string;
}

export interface Category {
  id: string;
  name: string;
}

export interface Product {
  id: string;
  name: string;
  nameUr?: string;
  sku: string;
  barcode?: string;
  categoryId?: string;
  supplierId?: string;
  /** Unit the product is sold and counted in (piece, packet, kg…). */
  unit: string;
  /** Pack used when buying from the supplier, e.g. Carton of 24. */
  packName?: string;
  packSize?: number;
  salePrice: number;
  /** Weighted average cost per unit (paisa). */
  cost: number;
  stock: number;
  minStock: number;
  favorite: boolean;
  active: boolean;
  createdAt: string;
}

export interface StockMove {
  id: string;
  productId: string;
  date: string;
  /** + stock in, − stock out. */
  qty: number;
  type: 'opening' | 'sale' | 'return' | 'purchase' | 'purchase_return' | 'adjust' | 'damage' | 'expiry';
  /** Cost per unit at the time (paisa). */
  cost: number;
  refId?: string;
  note?: string;
}

export interface Customer {
  id: string;
  name: string;
  phone?: string;
  address?: string;
  creditLimit: number;
  createdAt: string;
}

export interface Supplier {
  id: string;
  name: string;
  phone?: string;
  company?: string;
  leadDays?: number;
  createdAt: string;
}

export interface PartyEntry {
  id: string;
  partyType: 'customer' | 'supplier';
  partyId: string;
  date: string;
  /**
   * Customer: + they owe us more (credit sale), − they paid / returned.
   * Supplier: + we owe them more (credit purchase), − we paid / returned.
   */
  amount: number;
  type: 'opening' | 'sale' | 'purchase' | 'payment' | 'return' | 'adjustment';
  refId?: string;
  note?: string;
}

export interface SaleItem {
  productId: string;
  name: string;
  unit: string;
  qty: number;
  price: number;
  /** Line discount (paisa, whole line). */
  discount: number;
  /** Average cost per unit when sold (for profit). */
  cost: number;
  returnedQty: number;
}

export interface Payment {
  accountId: string;
  amount: number;
}

export interface Sale {
  id: string;
  no: string;
  date: string;
  customerId?: string;
  items: SaleItem[];
  subtotal: number;
  discount: number;
  total: number;
  /** Paid now across payment accounts. */
  paid: number;
  /** Cash handed back. */
  change: number;
  /** Unpaid part added to the customer's khata. */
  credit: number;
  payments: Payment[];
  userId: string;
  status: 'completed' | 'void';
  /** Total refunded/credited back through returns. */
  returnedTotal: number;
  note?: string;
}

export interface SaleReturn {
  id: string;
  saleId: string;
  saleNo: string;
  date: string;
  items: { productId: string; name: string; qty: number; amount: number; cost: number }[];
  amount: number;
  /** Where the money went back: an account (cash refund) or the customer's khata. */
  refundTo: 'account' | 'khata';
  accountId?: string;
  reason?: string;
  userId: string;
}

export interface Purchase {
  id: string;
  no: string;
  date: string;
  supplierId: string;
  invoiceNo?: string;
  items: { productId: string; name: string; qty: number; cost: number }[];
  total: number;
  paid: number;
  accountId?: string;
  note?: string;
}

export interface Expense {
  id: string;
  date: string;
  /** 'expense' counts against profit; 'drawing' is owner withdrawal (not an expense). */
  kind: 'expense' | 'drawing';
  category: string;
  amount: number;
  accountId: string;
  note?: string;
  userId: string;
}

export type ServiceType = 'cash_in' | 'cash_out' | 'send_money' | 'bill' | 'load';

export interface ServiceTxn {
  id: string;
  date: string;
  provider: string;
  type: ServiceType;
  amount: number;
  /** Fee charged to the customer in cash. */
  fee: number;
  /** Commission credited to the float by the provider. */
  commission: number;
  mobile?: string;
  ref?: string;
  note?: string;
  userId: string;
}

export interface Closing {
  id: string;
  date: string;
  accountId: string;
  expected: number;
  counted: number;
  difference: number;
  note?: string;
  userId: string;
}

export interface HeldCart {
  id: string;
  label: string;
  date: string;
  customerId?: string;
  items: SaleItem[];
  discount: number;
}

/** Lightweight debug record of voice commands (no audio is stored). */
export interface VoiceLog {
  id: string;
  date: string;
  spokenText: string;
  parsed: unknown;
  productIds: string[];
  customerId?: string;
  status: 'success' | 'partial' | 'failed';
  lang: string;
  userId: string;
}

export interface Counter {
  id: string;
  value: number;
}

export class RetailDb extends Dexie {
  settings!: EntityTable<ShopSettings, 'id'>;
  users!: EntityTable<User, 'id'>;
  accounts!: EntityTable<Account, 'id'>;
  accountTxns!: EntityTable<AccountTxn, 'id'>;
  categories!: EntityTable<Category, 'id'>;
  products!: EntityTable<Product, 'id'>;
  stockMoves!: EntityTable<StockMove, 'id'>;
  customers!: EntityTable<Customer, 'id'>;
  suppliers!: EntityTable<Supplier, 'id'>;
  partyEntries!: EntityTable<PartyEntry, 'id'>;
  sales!: EntityTable<Sale, 'id'>;
  saleReturns!: EntityTable<SaleReturn, 'id'>;
  purchases!: EntityTable<Purchase, 'id'>;
  expenses!: EntityTable<Expense, 'id'>;
  serviceTxns!: EntityTable<ServiceTxn, 'id'>;
  closings!: EntityTable<Closing, 'id'>;
  heldCarts!: EntityTable<HeldCart, 'id'>;
  counters!: EntityTable<Counter, 'id'>;
  voiceLogs!: EntityTable<VoiceLog, 'id'>;

  constructor() {
    super('retailos');
    this.version(1).stores({
      settings: 'id',
      users: 'id, name',
      accounts: 'id, type, provider',
      accountTxns: 'id, accountId, date, type, refId',
      categories: 'id, name',
      products: 'id, name, sku, barcode, categoryId, supplierId, active',
      stockMoves: 'id, productId, date, type, refId',
      customers: 'id, name, phone',
      suppliers: 'id, name',
      partyEntries: 'id, [partyType+partyId], partyType, date, refId',
      sales: 'id, no, date, customerId, status',
      saleReturns: 'id, saleId, date',
      purchases: 'id, no, date, supplierId',
      expenses: 'id, date, kind, category',
      serviceTxns: 'id, date, provider, type',
      closings: 'id, date, accountId',
      heldCarts: 'id',
      counters: 'id',
    });
    // v2: voice command log (existing data is kept as-is).
    this.version(2).stores({ voiceLogs: 'id, date, status' });
  }
}

export const db = new RetailDb();

export const uid = () => crypto.randomUUID();
export const nowIso = () => new Date().toISOString();

export const ACCOUNT_IDS = {
  cash: 'acc-cash',
  bank: 'acc-bank',
  easypaisa: 'acc-easypaisa',
  jazzcash: 'acc-jazzcash',
} as const;

export const DEFAULT_EXPENSE_CATEGORIES = [
  'Rent',
  'Electricity',
  'Gas',
  'Internet',
  'Salary',
  'Transportation',
  'Repairs',
  'Packaging',
  'Maintenance',
  'Food',
  'Miscellaneous',
  'Other',
];

export const UNITS = ['Piece', 'Packet', 'Box', 'Bottle', 'Dozen', 'Kg', 'Gram', 'Litre', 'ML', 'Sack', 'Carton'];

/** Next document number, e.g. INV-000123. */
export async function nextNumber(key: 'sale' | 'purchase', prefix: string): Promise<string> {
  const current = (await db.counters.get(key))?.value ?? 0;
  const value = current + 1;
  await db.counters.put({ id: key, value });
  return `${prefix}-${String(value).padStart(6, '0')}`;
}

/** First run: shop settings, default payment accounts, categories. */
export async function setupShop(input: { shopName: string; address: string; phone: string; ownerName: string; pin: string; openingCash: number }) {
  await db.transaction('rw', [db.settings, db.users, db.accounts, db.accountTxns, db.categories], async () => {
    await db.settings.put({
      id: 'shop',
      shopName: input.shopName,
      address: input.address,
      phone: input.phone,
      receiptFooter: 'Thank you for shopping with us!',
      leadDays: 2,
      discrepancyLimit: 50000,
      cashierMaxDiscount: 5,
      setupDone: true,
    });
    await db.users.put({ id: uid(), name: input.ownerName, role: 'owner', pin: input.pin, active: true });
    await db.accounts.bulkPut([
      { id: ACCOUNT_IDS.cash, name: 'Cash Drawer', type: 'cash', active: true },
      { id: ACCOUNT_IDS.bank, name: 'Bank', type: 'bank', active: true },
      { id: ACCOUNT_IDS.easypaisa, name: 'Easypaisa', type: 'wallet', provider: 'Easypaisa', active: true },
      { id: ACCOUNT_IDS.jazzcash, name: 'JazzCash', type: 'wallet', provider: 'JazzCash', active: true },
    ]);
    if (input.openingCash > 0) {
      await db.accountTxns.add({ id: uid(), accountId: ACCOUNT_IDS.cash, date: nowIso(), amount: input.openingCash, type: 'opening', note: 'Opening cash' });
    }
    const cats = ['Grocery', 'Beverages', 'Biscuits & Snacks', 'Dairy', 'Personal Care', 'Household', 'Cooking Oil & Ghee', 'Spices'];
    await db.categories.bulkPut(cats.map((name) => ({ id: uid(), name })));
  });
}
