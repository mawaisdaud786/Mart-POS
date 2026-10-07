import { ListQuery } from '@retailos/contracts';
import { schema } from '@retailos/db';
import { COLLECTIONS, calculatePricing, isCollection, type CollectionName, type Product, type Sale, type ShopSettings } from '@retailos/domain';
import { eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { audit } from '../../lib/audit.js';
import { AppError, forbidden, notFound } from '../../lib/errors.js';
import { COLLECTION_RULES, canRead, view, type Caller } from './collections.js';
import * as ops from './ops.js';
import { OP_INPUTS, PricingQuoteSchema, type OpName } from './schemas.js';
import { SqlShopStore, inShopTransaction, type Doc, type ShopStore } from './store.js';

const { shopRecords } = schema;

const idParam = z.string().min(1).max(64).regex(/^[A-Za-z0-9._:-]+$/);
type Rules = typeof COLLECTION_RULES;
const ruleFor = (name: string) => (name in COLLECTION_RULES ? COLLECTION_RULES[name as keyof Rules] : undefined);

/** MySQL asks one of two transactions to give way when both lock the same rows: simply try again. */
async function withRetry<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await work();
    } catch (error) {
      const code = (error as { code?: string; errno?: number; cause?: { code?: string } }) ?? {};
      const retryable = ['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(code.code ?? code.cause?.code ?? '');
      if (!retryable || attempt >= 3) throw error;
    }
  }
}

function validation(error: z.ZodError): AppError {
  return new AppError(400, 'VALIDATION_FAILED', 'Some fields are not valid', error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
}

function runOp(name: OpName, s: ShopStore, c: ops.OpContext, i: Record<string, any>): Promise<unknown> {
  switch (name) {
    case 'saveVoiceKeywords':
      return ops.saveVoiceKeywords(s, c, i as never).then(() => ({ ok: true }));
    case 'completeSale':
      return ops.completeSale(s, c, i as never);
    case 'returnSaleItems':
      return ops.returnSaleItems(s, c, i as never);
    case 'voidSale':
      return ops.voidSale(s, c, i.saleId, i.reason).then(() => ({ ok: true }));
    case 'recordPurchase':
      return ops.recordPurchase(s, c, i as never);
    case 'adjustStock':
      return ops.adjustStock(s, c, i as never).then(() => ({ ok: true }));
    case 'receiveCustomerPayment':
      return ops.receiveCustomerPayment(s, c, i.customerId, i.amount, i.accountId, i.note).then(() => ({ ok: true }));
    case 'paySupplier':
      return ops.paySupplier(s, c, i.supplierId, i.amount, i.accountId, i.note).then(() => ({ ok: true }));
    case 'addPartyAdjustment':
      return ops.addPartyAdjustment(s, c, i as never).then(() => ({ ok: true }));
    case 'addExpense':
      return ops.addExpense(s, c, i as never);
    case 'deleteExpense':
      return ops.deleteExpense(s, c, i.id).then(() => ({ ok: true }));
    case 'transferMoney':
      return ops.transferMoney(s, c, i.fromId, i.toId, i.amount, i.note).then(() => ({ ok: true }));
    case 'adjustAccount':
      return ops.adjustAccount(s, c, i.accountId, i.amount, i.note).then(() => ({ ok: true }));
    case 'addServiceTxn':
      return ops.addServiceTxn(s, c, i as never);
    case 'deleteServiceTxn':
      return ops.deleteServiceTxn(s, c, i.id).then(() => ({ ok: true }));
    case 'saveClosing':
      return ops.saveClosing(s, c, i as never).then(() => ({ ok: true }));
    case 'setupShop':
      return ops.setupShop(s, c, i as never).then(() => ({ ok: true }));
    case 'manageProducts':
      return ops.manageProducts(s, c, i as never);
    case 'bulkUpdateProducts':
      return ops.bulkUpdateProducts(s, c, i as never);
    case 'bulkMasterRecords':
      return ops.bulkMasterRecords(s, c, i as never);
    case 'importProducts':
      return ops.importProducts(s, c, i as never);
  }
}

const BACKUP_VERSION = 2;

export const shopRoutes: FastifyPluginAsyncZod = async (app) => {
  const caller = (request: { ctx: { userId: string; permissions: ReadonlySet<string> } }): Caller => ({
    userId: request.ctx.userId,
    can: (p) => request.ctx.permissions.has(p),
  });
  const storeFor = (request: { ctx: { tenantId: string; userId: string } }) => new SqlShopStore(app.db, request.ctx.tenantId, request.ctx.userId);

  // ------------------------------------------------------------ state

  app.get('/state', async (request) => {
    const settings = await storeFor(request).get<Doc & { shopName?: string }>('settings', 'shop');
    return { setupDone: !!settings, shopName: settings?.shopName ?? null };
  });

  app.post(
    '/pricing/quote',
    { schema: { body: PricingQuoteSchema }, config: { write: true, rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request) => {
      const c = caller(request);
      if (!c.can('pos.use')) throw forbidden();
      const input = request.body;
      return withRetry(() => inShopTransaction(app.db, request.ctx.tenantId, request.ctx.userId, async (s) => {
        const products: Product[] = [];
        for (const item of [...input.items].sort((a, b) => a.productId.localeCompare(b.productId))) {
          const product = await s.get<Product>('products', item.productId);
          if (!product || !product.active) throw new AppError(400, 'PRODUCT_UNAVAILABLE', 'A product in the cart is unavailable');
          if (item.price !== undefined && item.price !== product.salePrice && !product.isService && !c.can('sales.price_override')) {
            throw forbidden('PRICE_OVERRIDE_DENIED', 'You are not allowed to change prices');
          }
          products.push(product);
        }
        const settings = await s.get<ShopSettings & { id: string }>('settings', 'shop');
        const pricing = calculatePricing({
          lines: input.items.map(({ productId, qty, price }) => ({
            productId,
            qty,
            ...(price !== undefined && price !== products.find((product) => product.id === productId)?.salePrice ? { price } : {}),
          })),
          products: products.map((product) => product.isService
            ? { id: product.id, salePrice: product.salePrice, thresholdPrice: null, wholesalePrice: product.salePrice, categoryId: product.categoryId }
            : {
              id: product.id,
              salePrice: product.salePrice,
              cost: product.cost,
              thresholdPrice: product.thresholdPrice,
              thresholdDiscountEnabled: product.thresholdDiscountEnabled,
              thresholdDiscountAmount: product.thresholdDiscountAmount,
              quantityPrices: product.quantityPrices ?? [],
              wholesalePrice: product.wholesalePrice,
              categoryId: product.categoryId,
            }),
          settings: ops.pricingFromSettings(settings),
          paymentMethod: 'cash',
          ...(input.homeDelivery !== undefined ? { homeDelivery: input.homeDelivery } : {}),
        });
        return {
          total: pricing.total,
          lines: pricing.lines.map(({ productId, price, discount }) => ({ productId, price, discount })),
        };
      }));
    },
  );

  /** One cheap call the web app polls to learn which collections changed (count + latest change time). */
  app.get('/versions', async (request) => {
    const rows = await app.db
      .select({ collection: shopRecords.collection, n: sql<number>`count(*)`, last: sql<string>`max(${shopRecords.updatedAt})` })
      .from(shopRecords)
      .where(eq(shopRecords.tenantId, request.ctx.tenantId))
      .groupBy(shopRecords.collection);
    const c = caller(request);
    const out: Record<string, string> = {};
    for (const r of rows) {
      const def = ruleFor(r.collection);
      if (def && canRead(def, c)) out[r.collection] = `${r.n}:${r.last}`;
    }
    return out;
  });

  // ------------------------------------------------------------ collections

  app.get('/c/:collection', { schema: { params: z.object({ collection: z.string().max(24) }), querystring: ListQuery } }, async (request) => {
    const def = ruleFor(request.params.collection);
    if (!def || !isCollection(request.params.collection)) throw notFound('Collection');
    const c = caller(request);
    if (!canRead(def, c)) throw forbidden();
    const { limit, ...rest } = request.query;
    // With per-record visibility the limit must apply after hiding records, or people would see fewer than they should.
    const docs = await storeFor(request).list(request.params.collection, def.visible ? rest : request.query);
    const items = view(def, docs, c);
    return { items: def.visible && limit ? items.slice(0, limit) : items };
  });

  app.get('/c/:collection/:id', { schema: { params: z.object({ collection: z.string().max(24), id: idParam }) } }, async (request) => {
    const def = ruleFor(request.params.collection);
    if (!def || !isCollection(request.params.collection)) throw notFound('Collection');
    const c = caller(request);
    if (!canRead(def, c)) throw forbidden();
    const doc = await storeFor(request).get(request.params.collection, request.params.id);
    const shown = doc ? view(def, [doc], c)[0] : undefined;
    if (!shown) throw notFound('Record');
    return shown;
  });

  app.put(
    '/c/:collection/:id',
    { schema: { params: z.object({ collection: z.string().max(24), id: idParam }) }, config: { write: true, rateLimit: { max: 600, timeWindow: '1 minute' } } },
    async (request) => {
      const name = request.params.collection;
      const def = ruleFor(name);
      if (!def || !isCollection(name)) throw notFound('Collection');
      const rule = def.write;
      if (!rule) throw forbidden('READ_ONLY', 'This data can only be changed through the app screens that record it properly');
      const parsed = rule.schema.safeParse(request.body);
      if (!parsed.success) throw validation(parsed.error);
      if (parsed.data.id !== request.params.id) throw new AppError(400, 'OP_REJECTED', 'The record id does not match the address');
      const c = caller(request);
      const doc = await withRetry(() =>
        inShopTransaction(app.db, request.ctx.tenantId, request.ctx.userId, async (s) => {
          const existing = await s.getForUpdate(name, request.params.id);
          if (existing ? !rule.canUpdate(c, existing as never) : !rule.canCreate(c)) throw forbidden();
          const next = rule.prepare ? await rule.prepare(parsed.data as never, existing as never, c, s) : (parsed.data as never);
          await s.put(name, next);
          return next as Doc;
        }),
      );
      if (['settings', 'products', 'accounts', 'customers', 'suppliers'].includes(name)) {
        await audit(request.ctx.tdb, request.ctx, request, { action: `shop.save.${name}`, entityType: name, entityId: request.params.id });
      }
      return view(def, [doc], c)[0];
    },
  );

  app.delete(
    '/c/:collection/:id',
    { schema: { params: z.object({ collection: z.string().max(24), id: idParam }) }, config: { write: true } },
    async (request) => {
      const name = request.params.collection;
      const def = ruleFor(name);
      if (!def || !isCollection(name)) throw notFound('Collection');
      const rule = def.write;
      if (!rule?.canDelete) throw forbidden('READ_ONLY', 'This record cannot be deleted');
      const c = caller(request);
      await withRetry(() =>
        inShopTransaction(app.db, request.ctx.tenantId, request.ctx.userId, async (s) => {
          const existing = await s.getForUpdate(name, request.params.id);
          if (!existing) return;
          if (!rule.canDelete!(c, existing as never)) throw forbidden();
          if (rule.beforeDelete) await rule.beforeDelete(existing as never, s);
          await s.remove(name, request.params.id);
        }),
      );
      return { ok: true };
    },
  );

  // ------------------------------------------------------------ business operations

  app.post(
    '/ops/:name',
    { schema: { params: z.object({ name: z.string().max(40) }) }, config: { write: true, rateLimit: { max: 240, timeWindow: '1 minute' } }, bodyLimit: 8 * 1024 * 1024 },
    async (request) => {
      const name = request.params.name as OpName;
      const inputSchema = (OP_INPUTS as Record<string, z.ZodType | undefined>)[name];
      if (!inputSchema) throw notFound('Operation');
      const parsed = inputSchema.safeParse(request.body ?? {});
      if (!parsed.success) throw validation(parsed.error);
      const c = caller(request);
      const context: ops.OpContext = { userId: request.ctx.userId, can: c.can as ops.OpContext['can'] };
      const result = await withRetry(() =>
        inShopTransaction(app.db, request.ctx.tenantId, request.ctx.userId, (s) => runOp(name, s, context, parsed.data as Record<string, unknown>)),
      );
      const entityId = (result as { id?: string } | undefined)?.id;
      await audit(request.ctx.tdb, request.ctx, request, { action: `shop.${name}`, entityType: 'shop', ...(entityId ? { entityId } : {}) });
      // The person who sold something does not get the cost price back in the answer unless they may see costs.
      if (name === 'completeSale' && !c.can('products.view_cost') && !c.can('inventory.view_value')) {
        const sale = result as Sale;
        return { ...sale, items: sale.items.map(({ cost: _cost, ...rest }) => rest) };
      }
      return result;
    },
  );

  // ------------------------------------------------------------ balances (summed in the database)

  app.get('/balances/accounts', async (request) => {
    const c = caller(request);
    const s = storeFor(request);
    const wantsAll = c.can('accounts.view_balances') || c.can('cash.session.view_expected') || c.can('cash.session.review');
    if (!wantsAll && !c.can('retailer.transact')) throw forbidden();
    const balances = await s.sumByKey('accountTxns', 'amount');
    if (wantsAll) return Object.fromEntries(balances);
    // A counter user may see the wallet floats they operate, not the cash drawer or bank.
    const providers = new Set((await s.list<Doc & { provider?: string }>('accounts')).filter((a) => a.provider).map((a) => a.id));
    return Object.fromEntries([...balances].filter(([id]) => providers.has(id)));
  });

  app.get('/balances/parties', { schema: { querystring: z.object({ type: z.enum(['customer', 'supplier']) }) } }, async (request) => {
    const c = caller(request);
    const type = request.query.type;
    if (!c.can(type === 'customer' ? 'customers.view_balance' : 'suppliers.view_balance')) throw forbidden();
    const balances = await storeFor(request).sumByKey('partyEntries', 'amount', { k2Prefix: `${type}:` });
    return Object.fromEntries([...balances].map(([key, amount]) => [key.slice(type.length + 1), amount]));
  });

  // ------------------------------------------------------------ backup

  app.get('/export', async (request) => {
    if (!caller(request).can('data.export_all')) throw forbidden();
    const s = storeFor(request);
    const data: Record<string, unknown[]> = {};
    for (const name of COLLECTIONS) data[name] = await s.list(name);
    await audit(request.ctx.tdb, request.ctx, request, { action: 'shop.export', entityType: 'shop' });
    return { app: 'retailos', version: BACKUP_VERSION, exportedAt: new Date().toISOString(), data };
  });

  /**
   * Replace all shop records with a backup. Accepts this server's own backup and the older
   * browser-database backup (whose `users` list is ignored: people now sign in to the server).
   */
  app.post('/import', { config: { write: true, rateLimit: { max: 5, timeWindow: '1 minute' } }, bodyLimit: 80 * 1024 * 1024 }, async (request) => {
    const c = caller(request);
    if (!c.can('data.export_all') || !c.can('settings.manage')) throw forbidden();
    const body = request.body as { app?: unknown; data?: Record<string, unknown> } | null;
    if (!body || body.app !== 'retailos' || !body.data || typeof body.data !== 'object') throw new AppError(400, 'OP_REJECTED', 'This is not a RetailOS backup file');
    const idPattern = /^[A-Za-z0-9._:-]{1,64}$/;
    const plan: [CollectionName, Doc][] = [];
    const skipped: string[] = [];
    for (const [name, rows] of Object.entries(body.data)) {
      if (!isCollection(name)) {
        skipped.push(name);
        continue;
      }
      if (!Array.isArray(rows)) throw new AppError(400, 'OP_REJECTED', `${name}: expected a list of records`);
      for (const [i, doc] of rows.entries()) {
        const id = (doc as { id?: unknown } | null)?.id;
        if (typeof id !== 'string' || !idPattern.test(id) || typeof doc !== 'object') throw new AppError(400, 'OP_REJECTED', `${name} record ${i + 1} has no valid id`);
        plan.push([name, doc as Doc]);
      }
    }
    if (!plan.some(([n, d]) => n === 'settings' && d.id === 'shop')) throw new AppError(400, 'OP_REJECTED', 'The backup has no shop settings');
    await withRetry(() =>
      app.db.transaction(async (tx) => {
        await tx.delete(shopRecords).where(eq(shopRecords.tenantId, request.ctx.tenantId));
        const store = new SqlShopStore(tx, request.ctx.tenantId, request.ctx.userId);
        for (const [name, doc] of plan) await store.put(name, name === 'settings' ? { ...doc, setupDone: true } : doc);
        const have = new Set(plan.filter(([n]) => n === 'counters').map(([, d]) => d.id));
        const counts = { sale: plan.filter(([n]) => n === 'sales').length, purchase: plan.filter(([n]) => n === 'purchases').length, ghar: plan.filter(([n]) => n === 'gharOrders').length };
        for (const kind of ['sale', 'purchase', 'ghar'] as const) if (!have.has(kind)) await store.put('counters', { id: kind, value: counts[kind] });
      }),
    );
    await audit(request.ctx.tdb, request.ctx, request, { action: 'shop.import', entityType: 'shop', after: { records: plan.length, skipped } });
    return { imported: plan.length, skipped };
  });
};
