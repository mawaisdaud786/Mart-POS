import type { CollectionName, Permission, Product, Sale, SaleReturn, StockMove } from '@retailos/domain';
import type { z } from 'zod';
import { AppError, forbidden } from '../../lib/errors.js';
import type { Doc, ShopStore } from './store.js';
import { AccountDoc, CategoryDoc, CustomerDoc, GharOrderDoc, HeldCartDoc, PrefsDoc, ProductDoc, SettingsDoc, SupplierDoc, VoiceLogDoc } from './schemas.js';

/**
 * Who may read and write each collection, which records they may see, and which fields are hidden.
 * Collections without a `write` rule are changed only by the business operations in ops.ts, so a
 * browser can never forge a sale, a stock movement or a ledger entry.
 */

export interface Caller {
  userId: string;
  can: (permission: Permission) => boolean;
}

type AnyDoc = Doc & Record<string, unknown>;

export interface WriteRule {
  schema: z.ZodType<Record<string, unknown>>;
  canCreate: (c: Caller) => boolean;
  canUpdate: (c: Caller, existing: AnyDoc) => boolean;
  canDelete?: (c: Caller, existing: AnyDoc) => boolean;
  /** Turn the validated browser input into the record to store: keeps server-owned fields, applies field-level permissions. */
  prepare?: (input: AnyDoc, existing: AnyDoc | undefined, c: Caller, s: ShopStore) => Promise<AnyDoc>;
  /** Extra check before deleting. */
  beforeDelete?: (existing: AnyDoc, s: ShopStore) => Promise<void>;
}

export interface CollectionDef {
  /** Anyone signed in may read, regardless of permissions. */
  open?: boolean;
  /** Otherwise at least one of these permissions is needed. */
  read?: Permission[];
  visible?: (doc: AnyDoc, c: Caller) => boolean;
  redact?: (doc: AnyDoc, c: Caller) => AnyDoc;
  write?: WriteRule;
}

const own = (doc: AnyDoc, c: Caller) => doc.userId === c.userId;
const stripItemCosts = <T extends { items: { cost?: number }[] }>(doc: T): T => ({ ...doc, items: doc.items.map(({ cost: _cost, ...rest }) => rest) });

const nonBlank = (field: string) => (input: AnyDoc) => {
  if (typeof input[field] !== 'string' || !(input[field] as string).trim()) throw new AppError(400, 'OP_REJECTED', 'Required field is empty');
};

async function ensureUniqueProductKeys(input: Product, s: ShopStore) {
  const all = await s.list<Product>('products');
  const sku = input.sku.toLowerCase();
  if (all.some((p) => p.id !== input.id && p.sku.toLowerCase() === sku)) throw new AppError(400, 'OP_REJECTED', `SKU ${input.sku} is already used by another product`);
  if (input.barcode && all.some((p) => p.id !== input.id && p.barcode === input.barcode)) throw new AppError(400, 'OP_REJECTED', `Barcode ${input.barcode} is already used by another product`);
}

export const COLLECTION_RULES: Record<Exclude<CollectionName, 'counters'>, CollectionDef> = {
  settings: {
    open: true,
    write: {
      schema: SettingsDoc,
      canCreate: () => false,
      canUpdate: (c) => c.can('settings.manage'),
      prepare: async (input, existing) => ({ ...input, setupDone: true, ...(existing?.demoDataLoaded ? { demoDataLoaded: true } : {}) }),
    },
  },
  categories: {
    open: true,
    write: {
      schema: CategoryDoc,
      canCreate: (c) => c.can('products.edit'),
      canUpdate: (c) => c.can('products.edit'),
      canDelete: (c) => c.can('products.edit'),
      prepare: async (input) => {
        nonBlank('name')(input);
        return input;
      },
      beforeDelete: async (existing, s) => {
        if ((await s.list<Product>('products')).some((p) => p.categoryId === existing.id)) throw new AppError(400, 'OP_REJECTED', 'This category is used by products. Move them first.');
      },
    },
  },
  products: {
    read: ['pos.use', 'products.view', 'inventory.view'],
    redact: (doc, c) => {
      if (c.can('products.view_cost') || c.can('inventory.view_value')) return doc;
      const { cost: _cost, ...rest } = doc;
      return { ...rest, cost: 0 };
    },
    write: {
      schema: ProductDoc,
      canCreate: (c) => c.can('products.create'),
      canUpdate: (c) => c.can('products.edit'),
      prepare: async (input, existing, c, s) => {
        const next = input as unknown as Product;
        await ensureUniqueProductKeys(next, s);
        if (!existing) {
          if (next.isService && !c.can('settings.manage')) throw forbidden();
          // New products start with no stock (record opening stock as a stock movement) and with the cost only people allowed to set it can give.
          return { ...next, stock: 0, cost: c.can('products.edit_cost') ? next.cost : 0, createdAt: new Date().toISOString() } as unknown as AnyDoc;
        }
        const old = existing as unknown as Product;
        if (next.isService !== old.isService && !c.can('settings.manage')) throw forbidden();
        const priceChanged = next.salePrice !== old.salePrice ||
          (next.thresholdPrice ?? null) !== (old.thresholdPrice ?? null) ||
          (next.thresholdDiscountEnabled ?? true) !== (old.thresholdDiscountEnabled ?? true) ||
          (next.thresholdDiscountAmount ?? null) !== (old.thresholdDiscountAmount ?? null) ||
          JSON.stringify(next.quantityPrices ?? []) !== JSON.stringify(old.quantityPrices ?? []) ||
          (next.wholesalePrice ?? null) !== (old.wholesalePrice ?? null);
        if (priceChanged && !c.can('products.edit_price')) throw forbidden('PRICE_EDIT_DENIED', 'You are not allowed to change prices');
        return { ...next, stock: old.stock, cost: c.can('products.edit_cost') ? next.cost : old.cost, createdAt: old.createdAt } as unknown as AnyDoc;
      },
    },
  },
  customers: {
    read: ['customers.view', 'pos.use'],
    write: {
      schema: CustomerDoc,
      // A cashier may add a new customer at the counter, but only a manager may edit one or set a credit limit.
      canCreate: (c) => c.can('customers.manage') || c.can('pos.use'),
      canUpdate: (c) => c.can('customers.manage'),
      prepare: async (input, existing, c) => {
        nonBlank('name')(input);
        const limit = c.can('customers.set_credit_limit') ? (input.creditLimit as number) : (existing?.creditLimit as number | undefined) ?? 0;
        const shopkeeperPricing = c.can('customers.manage')
          ? input.shopkeeperPricing === true
          : (existing?.shopkeeperPricing as boolean | undefined) ?? false;
        return { ...input, creditLimit: limit, shopkeeperPricing, createdAt: (existing?.createdAt as string | undefined) ?? new Date().toISOString() };
      },
    },
  },
  suppliers: {
    read: ['suppliers.view', 'purchasing.view'],
    write: {
      schema: SupplierDoc,
      canCreate: (c) => c.can('suppliers.manage'),
      canUpdate: (c) => c.can('suppliers.manage'),
      prepare: async (input, existing) => ({ ...input, createdAt: (existing?.createdAt as string | undefined) ?? new Date().toISOString() }),
    },
  },
  accounts: {
    open: true,
    write: {
      schema: AccountDoc,
      canCreate: (c) => c.can('accounts.manage'),
      canUpdate: (c) => c.can('accounts.manage'),
      prepare: async (input, existing) => {
        if (input.id === 'acc-cash' && input.active === false) throw new AppError(400, 'OP_REJECTED', 'The cash drawer cannot be switched off');
        return existing?.provider && !input.provider ? { ...input, provider: existing.provider } : input;
      },
    },
  },
  accountTxns: { read: ['accounts.view_balances'] },
  stockMoves: {
    read: ['inventory.view'],
    redact: (doc, c) => (c.can('products.view_cost') ? doc : ({ ...(doc as unknown as StockMove), cost: 0 } as unknown as AnyDoc)),
  },
  partyEntries: {
    read: ['customers.view_balance', 'suppliers.view_balance'],
    visible: (doc, c) => (doc.partyType === 'customer' ? c.can('customers.view_balance') : c.can('suppliers.view_balance')),
  },
  sales: {
    read: ['sales.view_all', 'sales.view_own'],
    visible: (doc, c) => c.can('sales.view_all') || own(doc, c),
    redact: (doc, c) => (c.can('products.view_cost') ? doc : (stripItemCosts(doc as unknown as Sale) as unknown as AnyDoc)),
  },
  saleReturns: {
    read: ['sales.view_all', 'sales.view_own'],
    visible: (doc, c) => c.can('sales.view_all') || own(doc, c),
    redact: (doc, c) => (c.can('products.view_cost') ? doc : (stripItemCosts(doc as unknown as SaleReturn) as unknown as AnyDoc)),
  },
  purchases: { read: ['purchasing.view', 'suppliers.view_balance'] },
  expenses: { read: ['expenses.view'] },
  serviceTxns: {
    read: ['retailer.transact', 'retailer.view_all'],
    visible: (doc, c) => c.can('retailer.view_all') || own(doc, c),
  },
  closings: {
    read: ['cash.session.open_close', 'cash.session.review', 'cash.session.view_expected'],
    visible: (doc, c) => c.can('cash.session.review') || c.can('cash.session.view_expected') || own(doc, c),
    // Blind count: a cashier sees what they counted, not what the books expected.
    redact: (doc, c) => {
      if (c.can('cash.session.view_expected') || c.can('cash.session.review')) return doc;
      const { expected: _e, difference: _d, ...rest } = doc;
      return rest as AnyDoc;
    },
  },
  heldCarts: {
    read: ['pos.use'],
    visible: own,
    write: {
      schema: HeldCartDoc,
      canCreate: (c) => c.can('pos.use'),
      canUpdate: (c, existing) => c.can('pos.use') && own(existing, c),
      canDelete: (c, existing) => c.can('pos.use') && own(existing, c),
      prepare: async (input, _existing, c) => ({ ...input, userId: c.userId }),
    },
  },
  gharOrders: {
    read: ['pos.use', 'customers.manage'],
    write: {
      schema: GharOrderDoc,
      canCreate: (c) => c.can('pos.use'),
      canUpdate: (c) => c.can('pos.use') || c.can('customers.manage'),
      prepare: async (input, existing, c) => ({ ...input, userId: (existing?.userId as string | undefined) ?? c.userId }),
    },
  },
  voiceLogs: {
    read: ['pos.use'],
    visible: (doc, c) => c.can('settings.manage') || own(doc, c),
    write: {
      schema: VoiceLogDoc,
      canCreate: (c) => c.can('pos.use'),
      canUpdate: (c, existing) => c.can('settings.manage') || (c.can('pos.use') && own(existing, c)),
      canDelete: (c, existing) => c.can('settings.manage') || own(existing, c),
      prepare: async (input, existing, c) => ({ ...input, userId: (existing?.userId as string | undefined) ?? c.userId }),
    },
  },
  prefs: {
    open: true,
    visible: (doc, c) => doc.id === `u:${c.userId}`,
    write: {
      schema: PrefsDoc,
      canCreate: () => true,
      canUpdate: () => true,
      prepare: async (input, _existing, c) => {
        if (input.id !== `u:${c.userId}`) throw forbidden();
        return input;
      },
    },
  },
};

export function canRead(def: CollectionDef, c: Caller): boolean {
  return !!def.open || (def.read ?? []).some((p) => c.can(p));
}

/** Apply per-record visibility and field hiding for one caller. */
export function view<T extends Doc>(def: CollectionDef, docs: T[], c: Caller): T[] {
  return docs
    .filter((d) => !def.visible || def.visible(d as unknown as AnyDoc, c))
    .map((d) => (def.redact ? (def.redact(d as unknown as AnyDoc, c) as unknown as T) : d));
}
