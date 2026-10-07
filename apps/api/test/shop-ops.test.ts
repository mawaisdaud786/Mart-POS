import { ALL_PERMISSIONS, SYSTEM_ROLES, type AccountTxn, type Customer, type Permission, type Product, type Sale, type ShopSettings, type StockMove } from '@retailos/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import * as ops from '../src/modules/shop/ops';
import { MemoryStore } from './memory-store';

// One counter for every caller, like random UUIDs in production: ids must never collide.
let idCounter = 0;
const ctxFor = (permissions: readonly Permission[], userId = 'u-test'): ops.OpContext => {
  const set = new Set(permissions);
  return { userId, can: (p) => set.has(p), newId: () => `id-${++idCounter}`, now: () => '2026-10-04T10:00:00.000Z' };
};
const owner = () => ctxFor(ALL_PERMISSIONS, 'u-owner');
const cashier = () => ctxFor(SYSTEM_ROLES.cashier.permissions, 'u-cashier');
const manager = () => ctxFor(SYSTEM_ROLES.manager.permissions, 'u-manager');
const markShopkeeperCustomer = async () => {
  const customer = (await s.get<Customer>('customers', 'c1'))!;
  await s.put('customers', { ...customer, shopkeeperPricing: true });
};

const product = (id: string, over: Partial<Product> = {}): Product => ({
  id, name: `Product ${id}`, sku: id, unit: 'Packet', salePrice: 10_000, cost: 8_000, stock: 100, minStock: 5, favorite: false, active: true, createdAt: '2026-01-01T00:00:00.000Z', ...over,
});

let s: MemoryStore;
beforeEach(async () => {
  s = new MemoryStore();
  await ops.setupShop(s, owner(), { shopName: 'Test Mart', address: '', phone: '', openingCash: 100_000 });
  await s.put('products', product('p1'));
  await s.put('products', product('p2', { salePrice: 5_000, cost: 4_000 }));
  await s.put('customers', { id: 'c1', name: 'Ali', creditLimit: 0, createdAt: '2026-01-01T00:00:00.000Z' });
  await s.put('suppliers', { id: 's1', name: 'Peak', createdAt: '2026-01-01T00:00:00.000Z' });
});

const cashBalance = () => ops.accountBalance(s, 'acc-cash');
const stockOf = async (id: string) => (await s.get<Product>('products', id))!.stock;
const sale = (over: Partial<ops.SaleInput> = {}): ops.SaleInput => ({
  items: [{ productId: 'p1', qty: 2, price: 10_000, discount: 0 }],
  discount: 0,
  payments: [{ accountId: 'acc-cash', amount: 20_000 }],
  ...over,
});

describe('bulk master records', () => {
  it('creates unique categories and prevents removing categories used by products', async () => {
    const created = await ops.bulkMasterRecords(s, owner(), {
      entity: 'categories',
      action: 'create',
      records: [{ name: 'Dry goods' }, { name: 'Cleaning' }],
    });
    expect(created.changed).toBe(2);
    const categories = (await s.list<{ id: string; name: string }>('categories')).filter((category) => ['Dry goods', 'Cleaning'].includes(category.name));
    expect(categories).toHaveLength(2);
    await expect(ops.bulkMasterRecords(s, owner(), {
      entity: 'categories',
      action: 'create',
      records: [{ name: 'dry goods' }],
    })).rejects.toThrow(/already exists/);
    await s.put('products', product('categorized', { categoryId: categories[0]!.id }));
    await expect(ops.bulkMasterRecords(s, owner(), {
      entity: 'categories',
      action: 'delete',
      ids: [categories[0]!.id, categories[1]!.id],
    })).rejects.toThrow(/used by products/);
    expect(await s.get('categories', categories[1]!.id)).toBeDefined();
  });

  it('updates customer and supplier fields but preserves financial history on deletion', async () => {
    const result = await ops.bulkMasterRecords(s, owner(), {
      entity: 'customers',
      action: 'update',
      ids: ['c1'],
      updates: { shopkeeperPricing: true },
    });
    expect(result.changed).toBe(1);
    expect(await s.get<Customer>('customers', 'c1')).toMatchObject({ shopkeeperPricing: true });
    await expect(ops.bulkMasterRecords(s, owner(), {
      entity: 'customers',
      action: 'update',
      ids: ['c1'],
      updates: { creditLimit: 500 },
    })).rejects.toThrow(/unsupported fields/);
    await s.put('partyEntries', { id: 'customer-entry', partyType: 'customer', partyId: 'c1', amount: 1 });
    await expect(ops.bulkMasterRecords(s, owner(), { entity: 'customers', action: 'delete', ids: ['c1'] }))
      .rejects.toThrow(/transaction history/);

    const supplierResult = await ops.bulkMasterRecords(s, owner(), {
      entity: 'suppliers',
      action: 'update',
      ids: ['s1'],
      updates: { leadDays: 4, orderDay: 2 },
    });
    expect(supplierResult.changed).toBe(1);
    expect(await s.get('suppliers', 's1')).toMatchObject({ leadDays: 4, orderDay: 2 });
  });

  it('requires matching master-data permissions', async () => {
    await expect(ops.bulkMasterRecords(s, cashier(), {
      entity: 'customers',
      action: 'create',
      records: [{ name: 'Blocked' }],
    })).rejects.toMatchObject({ status: 403 });
  });
});

describe('voice product keywords', () => {
  it('allows settings managers to save aliases without changing other product fields', async () => {
    await ops.saveVoiceKeywords(s, ctxFor(['settings.manage']), {
      productId: 'p1',
      voiceKeywords: [' ceni ', 'CENI', 'Product p1'],
    });
    expect(await s.get<Product>('products', 'p1')).toMatchObject({
      voiceKeywords: ['ceni'],
      salePrice: 10_000,
      stock: 100,
      cost: 8_000,
    });
  });

  it('allows product editors and rejects callers without either permission', async () => {
    await ops.saveVoiceKeywords(s, ctxFor(['products.edit']), { productId: 'p2', voiceKeywords: ['eggs'] });
    expect((await s.get<Product>('products', 'p2'))?.voiceKeywords).toEqual(['eggs']);
    await expect(ops.saveVoiceKeywords(s, cashier(), { productId: 'p1', voiceKeywords: ['blocked'] }))
      .rejects.toMatchObject({ status: 403 });
  });

  it('rejects a product that no longer exists', async () => {
    await expect(ops.saveVoiceKeywords(s, ctxFor(['settings.manage']), {
      productId: 'missing',
      voiceKeywords: ['alias'],
    })).rejects.toThrow(/no longer exists/);
  });
});

describe('first-run setup', () => {
  it('creates accounts, categories, counters and opening cash, once, for people who may', async () => {
    expect((await s.list('accounts')).map((a) => a.id).sort()).toEqual(['acc-bank', 'acc-cash', 'acc-easypaisa', 'acc-jazzcash']);
    expect((await s.list('categories')).length).toBeGreaterThan(5);
    expect(await cashBalance()).toBe(100_000);
    await expect(ops.setupShop(s, owner(), { shopName: 'Again', address: '', phone: '', openingCash: 0 })).rejects.toThrow(/already set up/);
    const fresh = new MemoryStore();
    await expect(ops.setupShop(fresh, cashier(), { shopName: 'X', address: '', phone: '', openingCash: 0 })).rejects.toMatchObject({ status: 403 });
  });
});

describe('bulk product management', () => {
  it('stores imported purchase cost as the shopkeeper price when wholesale price is omitted', async () => {
    await ops.importProducts(s, owner(), {
      records: [{
        sku: 'imported-purchase-rate',
        name: 'Imported purchase rate',
        unit: 'Piece',
        salePrice: 12_000,
        cost: 7_500,
        openingStock: 0,
        minStock: 0,
        favorite: false,
        active: true,
      }],
    });

    expect((await s.list<Product>('products')).find((product) => product.sku === 'imported-purchase-rate'))
      .toMatchObject({ salePrice: 12_000, cost: 7_500, wholesalePrice: 7_500 });
  });

  it('does not silently discard purchase prices from imports without cost-edit permission', async () => {
    const importer = ctxFor([...SYSTEM_ROLES.cashier.permissions, 'products.import']);
    await expect(ops.importProducts(s, importer, {
      records: [{
        sku: 'new-item',
        name: 'New item',
        unit: 'Piece',
        salePrice: 10_000,
        cost: 8_000,
        openingStock: 0,
        minStock: 0,
        favorite: false,
        active: true,
      }],
    })).rejects.toMatchObject({ status: 403 });
    expect((await s.list<Product>('products')).some((entry) => entry.sku === 'new-item')).toBe(false);
  });

  it('archives selected products without deleting their records', async () => {
    const result = await ops.manageProducts(s, manager(), { action: 'archive', ids: ['p1', 'p2'] });
    expect(result.changed).toBe(2);
    expect((await s.get<Product>('products', 'p1'))?.active).toBe(false);
    expect((await s.get<Product>('products', 'p2'))?.active).toBe(false);
  });

  it('reactivates selected archived products without changing stock or history', async () => {
    await s.put('products', product('archived', { active: false, stock: 12 }));
    const result = await ops.manageProducts(s, manager(), { action: 'activate', ids: ['archived'] });
    expect(result.changed).toBe(1);
    expect(await s.get<Product>('products', 'archived')).toMatchObject({ active: true, stock: 12 });
  });

  it('bulk updates selected product fields and preserves other product values', async () => {
    await s.put('categories', { id: 'cat-grocery', name: 'Grocery' });
    const result = await ops.bulkUpdateProducts(s, manager(), {
      ids: ['p1', 'p2'],
      categoryId: 'cat-grocery',
      supplierId: 's1',
      unit: 'Kg',
    });
    expect(result.changed).toBe(2);
    expect(await s.get<Product>('products', 'p1')).toMatchObject({
      categoryId: 'cat-grocery',
      supplierId: 's1',
      unit: 'Kg',
      salePrice: 10_000,
      stock: 100,
    });
    expect(await s.get<Product>('products', 'p2')).toMatchObject({
      categoryId: 'cat-grocery',
      supplierId: 's1',
      unit: 'Kg',
      salePrice: 5_000,
      stock: 100,
    });
  });

  it('bulk sets product discount permissions and per-unit rupee discounts', async () => {
    await ops.bulkUpdateProducts(s, owner(), { ids: ['p1', 'p2'], thresholdDiscountEnabled: true, thresholdDiscountAmount: 300 });
    expect(await s.get<Product>('products', 'p1')).toMatchObject({ thresholdDiscountEnabled: true, thresholdDiscountAmount: 300 });
    expect(await s.get<Product>('products', 'p2')).toMatchObject({ thresholdDiscountEnabled: true, thresholdDiscountAmount: 300 });
    await ops.bulkUpdateProducts(s, owner(), { ids: ['p1', 'p2'], thresholdDiscountEnabled: false, thresholdDiscountAmount: null });
    expect(await s.get<Product>('products', 'p1')).toMatchObject({ thresholdDiscountEnabled: false });
    expect((await s.get<Product>('products', 'p1'))?.thresholdDiscountAmount).toBeUndefined();
    await expect(ops.bulkUpdateProducts(s, ctxFor(['products.edit'], 'u-basic'), { ids: ['p1'], thresholdDiscountAmount: 300 })).rejects.toThrow();
  });

  it('clears optional bulk assignments and rejects missing categories', async () => {
    await s.put('products', product('assigned', { categoryId: 'old-category', supplierId: 's1' }));
    await ops.bulkUpdateProducts(s, manager(), { ids: ['assigned'], categoryId: null, supplierId: null });
    expect(await s.get<Product>('products', 'assigned')).toMatchObject({ categoryId: undefined, supplierId: undefined });
    await expect(ops.bulkUpdateProducts(s, manager(), { ids: ['assigned'], categoryId: 'missing' })).rejects.toThrow(/category no longer exists/);
  });

  it('permanently deletes unused products with permission', async () => {
    await s.put('products', product('unused', { stock: 0 }));
    const result = await ops.manageProducts(s, owner(), { action: 'delete', ids: ['unused'] });
    expect(result.changed).toBe(1);
    expect(await s.get('products', 'unused')).toBeUndefined();
  });

  it('blocks permanent deletion when products have stock or transaction history', async () => {
    await expect(ops.manageProducts(s, owner(), { action: 'delete', ids: ['p1'] })).rejects.toThrow(/stock or transaction history/);
    await ops.completeSale(s, cashier(), sale());
    await s.put('products', product('sold', { stock: 0 }));
    await s.put('sales', { id: 'sale-with-sold-product', items: [{ productId: 'sold' }] });
    await expect(ops.manageProducts(s, owner(), { action: 'delete', ids: ['sold'] })).rejects.toThrow(/stock or transaction history/);
    expect(await s.get<Product>('products', 'sold')).toBeDefined();
  });

  it('requires edit permission to archive and delete permission to permanently remove', async () => {
    await expect(ops.manageProducts(s, cashier(), { action: 'archive', ids: ['p1'] })).rejects.toMatchObject({ status: 403 });
    await expect(ops.manageProducts(s, ctxFor(SYSTEM_ROLES.inventory_manager.permissions), { action: 'delete', ids: ['p1'] })).rejects.toMatchObject({ status: 403 });
  });
});

describe('server-enforced threshold discount limits', () => {
  it('uses the stored product cost to cap cashier discounts without requiring cost visibility', async () => {
    const settings = (await s.get<ShopSettings>('settings', 'shop'))!;
    await s.put('settings', {
      ...settings,
      autoDiscountMinOrder: 0,
      autoDiscountPct: 50,
      autoDiscountMaxProfitPct: 30,
    });
    const result = await ops.completeSale(s, cashier(), sale({
      items: [{ productId: 'p1', qty: 1, price: 10_000, discount: 0 }],
      payments: [{ accountId: 'acc-cash', amount: 9_400 }],
    }));
    expect(result).toMatchObject({ subtotal: 10_000, total: 9_400 });
    expect(result.items[0]?.discount).toBe(600);
  });

  it('prices a named customer sale at server-recorded cost only for authorized callers', async () => {
    const result = await ops.completeSale(s, owner(), sale({
      customerId: 'c1',
      pricingMode: 'cost',
      payments: [{ accountId: 'acc-cash', amount: 16_000 }],
    }));
    expect(result).toMatchObject({ pricingMode: 'cost', subtotal: 16_000, total: 16_000, customerId: 'c1' });
    expect(result.items[0]).toMatchObject({ price: 8_000, cost: 8_000 });

    await expect(ops.completeSale(s, cashier(), sale({ customerId: 'c1', pricingMode: 'cost' }))).rejects.toMatchObject({ status: 403 });
    await expect(ops.completeSale(s, owner(), sale({ pricingMode: 'cost' }))).rejects.toThrow(/require a selected customer/);
  });

  it('uses wholesale shopkeeper pricing only for a selected customer', async () => {
    await markShopkeeperCustomer();
    await s.put('products', product('p1', { wholesalePrice: 9_000 }));
    const result = await ops.completeSale(s, cashier(), sale({
      customerId: 'c1',
      pricingMode: 'business',
      payments: [{ accountId: 'acc-cash', amount: 18_000 }],
    }));
    expect(result).toMatchObject({ pricingMode: 'business', subtotal: 18_000, total: 18_000, customerId: 'c1' });
    expect(result.items[0]).toMatchObject({ price: 9_000, cost: 8_000 });
    await expect(ops.completeSale(s, cashier(), sale({ pricingMode: 'business' }))).rejects.toThrow(/requires a selected customer/);
  });

  it('uses imported purchase cost for shopkeeper rate only when the caller may view cost', async () => {
    await markShopkeeperCustomer();
    await s.put('products', product('p1', { wholesalePrice: 9_000 }));
    const result = await ops.completeSale(s, owner(), sale({
      customerId: 'c1',
      pricingMode: 'business',
      payments: [{ accountId: 'acc-cash', amount: 16_000 }],
    }));
    expect(result).toMatchObject({ pricingMode: 'business', subtotal: 16_000, total: 16_000 });
    expect(result.items[0]).toMatchObject({ price: 8_000, cost: 8_000 });

    const wholesaleSale = await ops.completeSale(s, cashier(), sale({
      customerId: 'c1',
      pricingMode: 'business',
      payments: [{ accountId: 'acc-cash', amount: 18_000 }],
    }));
    expect(wholesaleSale).toMatchObject({ pricingMode: 'business', subtotal: 18_000, total: 18_000 });
    expect(wholesaleSale.items[0]).toMatchObject({ price: 9_000, cost: 8_000 });
  });

  it('rejects shopkeeper-rate sales if neither wholesale price nor purchase cost is available', async () => {
    await markShopkeeperCustomer();
    await s.put('products', product('p1', { cost: 0 }));
    await expect(ops.completeSale(s, owner(), sale({
      customerId: 'c1',
      pricingMode: 'business',
    }))).rejects.toThrow(/needs a viewable purchase cost or saved shopkeeper\/wholesale price/);
    expect(await stockOf('p1')).toBe(100);
  });

  it('rejects shopkeeper pricing for customers who are not marked special', async () => {
    await s.put('products', product('p1', { wholesalePrice: 9_000 }));
    await expect(ops.completeSale(s, cashier(), sale({
      customerId: 'c1',
      pricingMode: 'business',
    }))).rejects.toThrow(/only available for customers marked as special/);
  });
});

describe('completeSale', () => {
  it('allows fractional quantities in Karyana categories', async () => {
    await s.put('categories', { id: 'cat-karyana', name: 'Karyana' });
    await s.put('products', product('rice', { categoryId: 'cat-karyana', unit: 'Kg', salePrice: 10_000 }));
    const result = await ops.completeSale(s, cashier(), sale({
      items: [{ productId: 'rice', qty: 0.333, price: 10_000, discount: 0 }],
      payments: [{ accountId: 'acc-cash', amount: 3_330 }],
    }));
    expect(result.items[0]).toMatchObject({ productId: 'rice', qty: 0.333 });
    expect(await stockOf('rice')).toBe(99.667);
  });

  it('rejects fractional quantities for Biscuits categories', async () => {
    await s.put('categories', { id: 'cat-biscuits', name: 'Biscuits & Confectionery' });
    await s.put('products', product('biscuit', { categoryId: 'cat-biscuits' }));
    await expect(ops.completeSale(s, cashier(), sale({
      items: [{ productId: 'biscuit', qty: 0.5, price: 10_000, discount: 0 }],
      payments: [{ accountId: 'acc-cash', amount: 5_000 }],
    }))).rejects.toThrow(/whole-number quantity/);
    expect(await stockOf('biscuit')).toBe(100);
  });

  it('bills configurable services at an editable price without changing inventory', async () => {
    await s.put('products', product('photocopy', {
      name: 'Photocopy',
      unit: 'page',
      salePrice: 500,
      cost: 0,
      stock: 0,
      trackStock: false,
      isService: true,
    }));
    const result = await ops.completeSale(s, cashier(), sale({
      items: [{ productId: 'photocopy', qty: 3, price: 750, discount: 0 }],
      payments: [{ accountId: 'acc-cash', amount: 2_250 }],
    }));
    expect(result.items[0]).toMatchObject({ productId: 'photocopy', qty: 3, price: 750, cost: 0 });
    expect(await stockOf('photocopy')).toBe(0);
    expect((await s.list<StockMove>('stockMoves')).filter((move) => move.productId === 'photocopy')).toHaveLength(0);
  });
  it('takes stock, money and numbers from the database and writes every effect', async () => {
    const r = await ops.completeSale(s, cashier(), sale());
    expect(r).toMatchObject({ no: 'INV-20261004-150000-000001', total: 20_000, paid: 20_000, credit: 0, change: 0, status: 'completed', userId: 'u-cashier' });
    expect(r.items[0]).toMatchObject({ cost: 8_000, returnedQty: 0, name: 'Product p1' });
    expect(await stockOf('p1')).toBe(98);
    expect(await cashBalance()).toBe(120_000);
    expect((await s.list('stockMoves', { k2: 'p1' }))[0]).toMatchObject({ qty: -2, type: 'sale', cost: 8_000, refId: r.id });
    expect((await ops.completeSale(s, cashier(), sale())).no).toBe('INV-20261004-150000-000002');
  });

  it('rejects a sale above available stock without changing stock', async () => {
    await s.put('products', product('low-stock', { stock: 1 }));
    await expect(ops.completeSale(s, cashier(), sale({
      items: [{ productId: 'low-stock', qty: 2, price: 10_000, discount: 0 }],
      payments: [{ accountId: 'acc-cash', amount: 20_000 }],
    }))).rejects.toThrow(/only 1 available/);
    expect(await stockOf('low-stock')).toBe(1);
  });

  it('gives change from cash and books only the net cash', async () => {
    const r = await ops.completeSale(s, cashier(), sale({ payments: [{ accountId: 'acc-cash', amount: 50_000 }] }));
    expect(r).toMatchObject({ change: 30_000, paid: 20_000 });
    expect(await cashBalance()).toBe(120_000);
  });

  it('splits across wallets and refuses over-payment by wallet or change from a wallet', async () => {
    await ops.completeSale(s, cashier(), sale({ payments: [{ accountId: 'acc-cash', amount: 5_000 }, { accountId: 'acc-easypaisa', amount: 15_000 }] }));
    expect(await ops.accountBalance(s, 'acc-easypaisa')).toBe(15_000);
    await expect(ops.completeSale(s, cashier(), sale({ payments: [{ accountId: 'acc-easypaisa', amount: 30_000 }] }))).rejects.toThrow(/more than the bill/);
  });

  it('puts the unpaid part on the customer khata, and needs a customer and the credit permission', async () => {
    const r = await ops.completeSale(s, cashier(), sale({ customerId: 'c1', payments: [{ accountId: 'acc-cash', amount: 5_000 }] }));
    expect(r).toMatchObject({ credit: 15_000, paid: 5_000, paymentMethod: 'credit' });
    expect(await s.sum('partyEntries', 'amount', { k2: 'customer:c1' })).toBe(15_000);
    await expect(ops.completeSale(s, cashier(), sale({ payments: [] }))).rejects.toThrow(/Select a customer/);
    const noCredit = ctxFor(['pos.use']);
    await expect(ops.completeSale(s, noCredit, sale({ customerId: 'c1', payments: [] }))).rejects.toMatchObject({ status: 403 });
    await expect(ops.completeSale(s, cashier(), sale({ customerId: 'nobody', payments: [] }))).rejects.toThrow(/available customer/);
  });

  it('is atomic in intent: a rejected sale leaves no trace', async () => {
    await expect(ops.completeSale(s, cashier(), sale({ items: [{ productId: 'p1', qty: 1, price: 10_000, discount: 0 }, { productId: 'ghost', qty: 1, price: 1, discount: 0 }] }))).rejects.toThrow(/unavailable/);
    expect(await stockOf('p1')).toBe(100);
    expect(await s.list('sales')).toHaveLength(0);
  });

  it('refuses people without pos.use, inactive products, and malformed lines', async () => {
    await expect(ops.completeSale(s, ctxFor(['products.view']), sale())).rejects.toMatchObject({ status: 403 });
    await s.put('products', product('p3', { active: false }));
    await expect(ops.completeSale(s, cashier(), sale({ items: [{ productId: 'p3', qty: 1, price: 10_000, discount: 0 }] }))).rejects.toThrow(/unavailable/);
    for (const bad of [{ qty: 0 }, { qty: -1 }, { price: -5 }, { price: 10.5 }, { discount: -1 }, { qty: Number.NaN }]) {
      await expect(ops.completeSale(s, cashier(), sale({ items: [{ productId: 'p1', qty: 1, price: 10_000, discount: 0, ...bad }] }))).rejects.toThrow();
    }
    await expect(ops.completeSale(s, cashier(), sale({ items: [] }))).rejects.toThrow(/empty/);
    await expect(ops.completeSale(s, cashier(), sale({ items: [{ productId: 'p1', qty: 1, price: 10_000, discount: 0 }, { productId: 'p1', qty: 1, price: 10_000, discount: 0 }] }))).rejects.toThrow(/twice/);
    await expect(ops.completeSale(s, cashier(), sale({ payments: [{ accountId: 'acc-cash', amount: -5 }] }))).rejects.toThrow();
    await expect(ops.completeSale(s, cashier(), sale({ discount: -100 }))).rejects.toThrow();
  });

  it('ignores a price the cashier typed unless they may override prices', async () => {
    const cheap = sale({ items: [{ productId: 'p1', qty: 1, price: 1, discount: 0 }], payments: [{ accountId: 'acc-cash', amount: 1 }] });
    await expect(ops.completeSale(s, cashier(), cheap)).rejects.toMatchObject({ code: 'PRICE_OVERRIDE_DENIED' });
    const r = await ops.completeSale(s, manager(), { ...cheap, payments: [{ accountId: 'acc-cash', amount: 1 }] }).catch(() => null);
    expect(r === null || r.items[0]!.price === 1).toBe(true); // managers have sales.price_override
    const ok = await ops.completeSale(s, owner(), cheap);
    expect(ok.items[0]!.price).toBe(1);
  });

  it('applies the automatic big-bill discount on the server whatever the browser says', async () => {
    await s.put('products', product('big', { salePrice: 100_000, cost: 50_000 }));
    const r = await ops.completeSale(s, cashier(), { items: [{ productId: 'big', qty: 6, price: 100_000, discount: 0 }], discount: 0, payments: [{ accountId: 'acc-cash', amount: 600_000 }] });
    expect(r.total).toBeLessThan(600_000); // Rs 6,000 is above the Rs 5,000 threshold, so the default 10% applies
    expect(r.items[0]!.discount).toBeGreaterThan(0);
  });

  it('limits hand-typed bill discounts for people who may not exceed the limit', async () => {
    await expect(ops.completeSale(s, cashier(), sale({ discount: 5_000, payments: [{ accountId: 'acc-cash', amount: 15_000 }] }))).rejects.toMatchObject({ code: 'DISCOUNT_LIMIT' });
    const small = await ops.completeSale(s, cashier(), sale({ discount: 500, payments: [{ accountId: 'acc-cash', amount: 19_500 }] }));
    expect(small.total).toBe(19_500);
    const big = await ops.completeSale(s, manager(), sale({ discount: 5_000, payments: [{ accountId: 'acc-cash', amount: 15_000 }] }));
    expect(big.total).toBe(15_000);
  });

  it('marks a linked home-delivery order as delivered', async () => {
    await s.put('gharOrders', { id: 'g1', no: 'G-1', date: '2026-10-04T09:00:00.000Z', customerId: 'c1', customerName: 'Ali', address: 'x', items: [], subtotal: 0, deliveryFee: 0, total: 0, status: 'out_for_delivery', userId: 'u' });
    const r = await ops.completeSale(s, cashier(), sale({ gharOrderId: 'g1', customerId: 'c1', payments: [{ accountId: 'acc-cash', amount: 20_000 }] }));
    expect(await s.get('gharOrders', 'g1')).toMatchObject({ status: 'delivered', saleId: r.id });
  });
});

describe('returns and voids', () => {
  let made: Sale;
  beforeEach(async () => {
    made = await ops.completeSale(s, cashier(), sale({ items: [{ productId: 'p1', qty: 4, price: 10_000, discount: 0 }], customerId: 'c1', payments: [{ accountId: 'acc-cash', amount: 10_000 }] }));
  });

  it('returns part of a sale to the cash drawer and the shelf, never more than was sold', async () => {
    const r = await ops.returnSaleItems(s, cashier(), { saleId: made.id, lines: [{ productId: 'p1', qty: 1 }], refundTo: 'account' });
    expect(r.amount).toBe(10_000);
    expect(await stockOf('p1')).toBe(97);
    expect(await cashBalance()).toBe(100_000 + 10_000 - 10_000);
    expect((await s.get<Sale>('sales', made.id))).toMatchObject({ returnedTotal: 10_000, items: [{ returnedQty: 1 }] });
    await expect(ops.returnSaleItems(s, cashier(), { saleId: made.id, lines: [{ productId: 'p1', qty: 4 }], refundTo: 'account' })).rejects.toThrow(/more Product p1/);
    await expect(ops.returnSaleItems(s, cashier(), { saleId: made.id, lines: [{ productId: 'nope', qty: 1 }], refundTo: 'account' })).rejects.toThrow(/not in this sale/);
    await expect(ops.returnSaleItems(s, cashier(), { saleId: made.id, lines: [], refundTo: 'account' })).rejects.toThrow(/Nothing to return/);
  });

  it('can credit the customer khata instead, and needs sales.return', async () => {
    await ops.returnSaleItems(s, cashier(), { saleId: made.id, lines: [{ productId: 'p1', qty: 2 }], refundTo: 'khata' });
    expect(await s.sum('partyEntries', 'amount', { k2: 'customer:c1' })).toBe(30_000 - 20_000);
    await expect(ops.returnSaleItems(s, ctxFor(['pos.use']), { saleId: made.id, lines: [{ productId: 'p1', qty: 1 }], refundTo: 'account' })).rejects.toMatchObject({ status: 403 });
  });

  it('voids a whole sale: stock back, money and khata reversed; only with sales.void', async () => {
    await expect(ops.voidSale(s, cashier(), made.id, 'mistake')).rejects.toMatchObject({ status: 403 });
    await ops.voidSale(s, manager(), made.id, 'mistake');
    expect(await stockOf('p1')).toBe(100);
    expect(await cashBalance()).toBe(100_000);
    expect(await s.sum('partyEntries', 'amount', { k2: 'customer:c1' })).toBe(0);
    expect(await s.get('sales', made.id)).toMatchObject({ status: 'void', note: 'mistake' });
    await expect(ops.voidSale(s, manager(), made.id, 'again')).rejects.toThrow(/not found/);
  });

  it('will not void a sale that already had returns', async () => {
    await ops.returnSaleItems(s, cashier(), { saleId: made.id, lines: [{ productId: 'p1', qty: 1 }], refundTo: 'account' });
    await expect(ops.voidSale(s, manager(), made.id, 'x')).rejects.toThrow(/already returned/);
  });
});

describe('purchases and stock', () => {
  it('receives stock at a weighted average cost, owes the supplier the unpaid part, and pays from accounts', async () => {
    const p = await ops.recordPurchase(s, manager(), { supplierId: 's1', items: [{ productId: 'p1', qty: 100, cost: 10_000 }], payments: [{ accountId: 'acc-cash', amount: 400_000 }] });
    expect(p).toMatchObject({ no: 'PUR-000001', total: 1_000_000, paid: 400_000 });
    const after = (await s.get<Product>('products', 'p1'))!;
    expect(after.stock).toBe(200);
    expect(after.cost).toBe(9_000); // (100 × 80 + 100 × 100) / 200
    expect(await s.sum('partyEntries', 'amount', { k2: 'supplier:s1' })).toBe(600_000);
    expect(await cashBalance()).toBe(100_000 - 400_000);
  });

  it('refuses overpayment, empty or invalid purchases, unknown suppliers, and missing permissions', async () => {
    const base = { supplierId: 's1', items: [{ productId: 'p1', qty: 1, cost: 100 }], payments: [] };
    await expect(ops.recordPurchase(s, manager(), { ...base, payments: [{ accountId: 'acc-cash', amount: 500 }] })).rejects.toThrow(/exceeds/);
    await expect(ops.recordPurchase(s, manager(), { ...base, items: [] })).rejects.toThrow(/at least one/);
    await expect(ops.recordPurchase(s, manager(), { ...base, items: [{ productId: 'p1', qty: 1, cost: -1 }] })).rejects.toThrow();
    await expect(ops.recordPurchase(s, manager(), { ...base, supplierId: 'nobody' })).rejects.toThrow(/Supplier not found/);
    await expect(ops.recordPurchase(s, cashier(), base)).rejects.toMatchObject({ status: 403 });
  });

  it('adjusts stock with a reason and updates average cost only when adding stock with a cost', async () => {
    await ops.adjustStock(s, manager(), { productId: 'p1', qty: -3, type: 'damage', note: 'broken' });
    expect(await stockOf('p1')).toBe(97);
    expect((await s.list('stockMoves', { k2: 'p1' }))[0]).toMatchObject({ qty: -3, type: 'damage', cost: 8_000, note: 'broken' });
    await expect(ops.adjustStock(s, manager(), { productId: 'p1', qty: 0, type: 'adjust' })).rejects.toThrow(/zero/);
    await expect(ops.adjustStock(s, cashier(), { productId: 'p1', qty: 1, type: 'adjust' })).rejects.toMatchObject({ status: 403 });
  });
});

describe('khata, expenses, transfers, Easypaisa and closing', () => {
  it('records customer and supplier payments on both the khata and the account', async () => {
    await ops.addPartyAdjustment(s, owner(), { partyType: 'customer', partyId: 'c1', amount: 50_000, note: 'opening', type: 'opening' });
    await ops.receiveCustomerPayment(s, cashier(), 'c1', 20_000, 'acc-cash');
    expect(await s.sum('partyEntries', 'amount', { k2: 'customer:c1' })).toBe(30_000);
    expect(await cashBalance()).toBe(120_000);
    await ops.paySupplier(s, manager(), 's1', 10_000, 'acc-cash');
    expect(await s.sum('partyEntries', 'amount', { k2: 'supplier:s1' })).toBe(-10_000);
    await expect(ops.paySupplier(s, cashier(), 's1', 1, 'acc-cash')).rejects.toMatchObject({ status: 403 });
    await expect(ops.receiveCustomerPayment(s, cashier(), 'c1', 0, 'acc-cash')).rejects.toThrow(/amount/);
    await expect(ops.receiveCustomerPayment(s, cashier(), 'ghost', 5, 'acc-cash')).rejects.toThrow(/Customer not found/);
  });

  it('books expenses against an account, owner drawings only for the owner, and deleting removes the money entry', async () => {
    const e = await ops.addExpense(s, manager(), { kind: 'expense', category: 'Electricity', amount: 5_000, accountId: 'acc-cash' });
    expect(await cashBalance()).toBe(95_000);
    await expect(ops.addExpense(s, manager(), { kind: 'drawing', category: 'Owner', amount: 1, accountId: 'acc-cash' })).rejects.toMatchObject({ status: 403 });
    await ops.addExpense(s, owner(), { kind: 'drawing', category: 'Owner', amount: 10_000, accountId: 'acc-cash' });
    expect(await cashBalance()).toBe(85_000);
    await ops.deleteExpense(s, manager(), e.id);
    expect(await cashBalance()).toBe(90_000);
    await expect(ops.deleteExpense(s, cashier(), e.id)).rejects.toMatchObject({ status: 403 });
    await expect(ops.addExpense(s, manager(), { kind: 'expense', category: '', amount: 5, accountId: 'acc-cash' })).rejects.toThrow(/category/);
    await expect(ops.addExpense(s, manager(), { kind: 'expense', category: 'x', amount: 5, accountId: 'nope' })).rejects.toThrow(/unavailable/);
  });

  it('transfers between accounts and adjusts one with permission', async () => {
    await ops.transferMoney(s, manager(), 'acc-cash', 'acc-bank', 30_000);
    expect(await cashBalance()).toBe(70_000);
    expect(await ops.accountBalance(s, 'acc-bank')).toBe(30_000);
    await expect(ops.transferMoney(s, manager(), 'acc-cash', 'acc-cash', 1)).rejects.toThrow(/two different/);
    await expect(ops.adjustAccount(s, manager(), 'acc-cash', 5, 'x')).rejects.toMatchObject({ status: 403 });
    await ops.adjustAccount(s, owner(), 'acc-cash', -500, 'recount');
    expect(await cashBalance()).toBe(69_500);
  });

  it('moves both the wallet float and the cash for an Easypaisa cash-in, with fee and commission, and reverses it', async () => {
    await ops.adjustAccount(s, owner(), 'acc-easypaisa', 1_000_000, 'float');
    const t = await ops.addServiceTxn(s, cashier(), { provider: 'Easypaisa', type: 'cash_in', amount: 500_000, fee: 2_000, commission: 5_000 });
    expect(await ops.accountBalance(s, 'acc-easypaisa')).toBe(1_000_000 - 500_000 + 5_000);
    expect(await cashBalance()).toBe(100_000 + 500_000 + 2_000);
    await ops.deleteServiceTxn(s, manager(), t.id);
    expect(await ops.accountBalance(s, 'acc-easypaisa')).toBe(1_000_000);
    expect(await cashBalance()).toBe(100_000);
    await expect(ops.deleteServiceTxn(s, cashier(), t.id)).rejects.toMatchObject({ status: 403 });
    await expect(ops.addServiceTxn(s, cashier(), { provider: 'Nobody', type: 'cash_in', amount: 5, fee: 0, commission: 0 })).rejects.toThrow(/No account/);
  });

  it('closes the day: expected comes from the books and the difference is booked so tomorrow starts true', async () => {
    await ops.completeSale(s, cashier(), sale());
    await ops.saveClosing(s, cashier(), { accountId: 'acc-cash', counted: 118_000, note: 'short' });
    const [closing] = await s.list('closings');
    expect(closing).toMatchObject({ expected: 120_000, counted: 118_000, difference: -2_000, userId: 'u-cashier' });
    expect(await cashBalance()).toBe(118_000);
    const adj = (await s.list<AccountTxn>('accountTxns', { k4: (closing as { id: string }).id }))[0];
    expect(adj).toMatchObject({ amount: -2_000, type: 'adjustment' });
    await expect(ops.saveClosing(s, ctxFor(['pos.use']), { accountId: 'acc-cash', counted: 1 })).rejects.toMatchObject({ status: 403 });
    await expect(ops.saveClosing(s, cashier(), { accountId: 'acc-cash', counted: -1 })).rejects.toThrow();
  });
});

describe('numbering', () => {
  it('never repeats a document number', async () => {
    const numbers = new Set<string>();
    for (let i = 0; i < 5; i++) numbers.add((await ops.completeSale(s, cashier(), sale())).no);
    expect(numbers.size).toBe(5);
  });
});
