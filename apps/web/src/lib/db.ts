import type {
  Account,
  AccountTxn,
  Category,
  Closing,
  Customer,
  GharOrder,
  HeldCart,
  PartyEntry,
  Product,
  ProductPairRule,
  Purchase,
  Sale,
  SaleReturn,
  ServiceTxn,
  ShopSettings,
  StockMove,
  Supplier,
  VoiceLog,
} from '@retailos/domain';
import { Table } from './store';
import type { WhatsAppTemplate } from './whatsapp';

/**
 * The shop's records live on the server (see lib/store.ts); nothing is stored in the browser.
 * Money is whole paisa (Rs 1 = 100) to avoid rounding errors.
 */

export type {
  Account,
  AccountTxn,
  AccountType,
  Category,
  Closing,
  Customer,
  Expense,
  GharOrder,
  GharOrderStatus,
  HeldCart,
  Payment,
  PartyEntry,
  Product,
  ProductPairRule,
  Purchase,
  Sale,
  SaleItem,
  SaleReturn,
  ServiceTxn,
  ServiceType,
  ShopSettings,
  StockMove,
  Supplier,
  VoiceLog,
} from '@retailos/domain';

export type Role = 'owner' | 'manager' | 'cashier';

/** A person who signs in to this shop (their account lives on the server). */
export interface User {
  id: string;
  name: string;
  role: Role;
  active: boolean;
}

export const db = {
  settings: new Table<ShopSettings>('settings'),
  accounts: new Table<Account>('accounts'),
  accountTxns: new Table<AccountTxn>('accountTxns'),
  categories: new Table<Category>('categories'),
  products: new Table<Product>('products'),
  stockMoves: new Table<StockMove>('stockMoves'),
  customers: new Table<Customer>('customers'),
  suppliers: new Table<Supplier>('suppliers'),
  partyEntries: new Table<PartyEntry>('partyEntries'),
  sales: new Table<Sale>('sales'),
  saleReturns: new Table<SaleReturn>('saleReturns'),
  purchases: new Table<Purchase>('purchases'),
  expenses: new Table<import('@retailos/domain').Expense>('expenses'),
  serviceTxns: new Table<ServiceTxn>('serviceTxns'),
  closings: new Table<Closing>('closings'),
  heldCarts: new Table<HeldCart & { userId?: string }>('heldCarts'),
  gharOrders: new Table<GharOrder>('gharOrders'),
  voiceLogs: new Table<VoiceLog>('voiceLogs'),
  prefs: new Table<{
    id: string;
    voiceLang?: 'ur-PK' | 'en-IN';
    actionShortcuts?: Partial<Record<import('./pos-shortcuts').PosActionId, string[]>>;
    productShortcuts?: import('./pos-shortcuts').ProductShortcut[];
    whatsappTemplates?: WhatsAppTemplate[];
  }>('prefs'),
  /**
   * Kept so older call sites still read naturally. Changes that must be all-or-nothing are done by the
   * server (see lib/ops.ts); this simply runs the function.
   */
  transaction: <T>(...args: unknown[]): Promise<T> => Promise.resolve((args[args.length - 1] as () => T | Promise<T>)()),
};

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
