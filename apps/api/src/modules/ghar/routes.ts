import { schema, type TenantDb } from '@retailos/db';
import { calculatePricing, DEFAULT_PRICING_SETTINGS, newId, type PricingSettings } from '@retailos/domain';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import type { RequestContext } from '../../lib/context.js';

const { customers, gharOrders, inventoryBalances, products, settings, units, ZERO_UUID } = schema;
const Status = z.enum(['invoice_draft', 'invoice_sent', 'confirmed', 'packing', 'out_for_delivery', 'delivered', 'cancelled']);
const Lines = z.array(z.object({ productId: z.uuid(), qty: z.number().positive().max(1_000_000) })).min(1).max(300);
const Input = z.object({
  id: z.uuid(),
  customerId: z.uuid(),
  address: z.string().trim().max(1000),
  homeDelivery: z.boolean().default(false),
  items: Lines,
  note: z.string().trim().max(1000).optional(),
});

interface GharConfig {
  discountPct: number;
  minimumMarginPct: number;
  deliveryFee: number;
  freeDeliveryThreshold: number;
}


interface GharOrderLine {
  productId: string;
  name: string;
  unit: string;
  qty: number;
  price: number;
  regularPrice: number;
  cost: number;
}
const DEFAULT_CONFIG: GharConfig = {
  discountPct: 5,
  minimumMarginPct: 10,
  deliveryFee: 15000,
  freeDeliveryThreshold: 400000,
};

async function readConfig(ctx: { tdb: TenantDb }): Promise<GharConfig> {
  const rows = await ctx.tdb.select(settings, eq(settings.scopeBranchId, ZERO_UUID));
  const values = new Map(rows.map((row) => [row.key, Number(row.value)]));
  const pricingRow = rows.find((row) => row.key === 'pos.pricing');
  const pricing = pricingRow?.value && typeof pricingRow.value === 'object' ? pricingRow.value as Partial<PricingSettings> : undefined;
  return {
    discountPct: Math.min(99, Math.max(0, pricing?.defaultPercent ?? values.get('ghar.discount_percent') ?? DEFAULT_CONFIG.discountPct)),
    minimumMarginPct: Math.min(99, Math.max(0, values.get('ghar.minimum_margin_percent') ?? DEFAULT_CONFIG.minimumMarginPct)),
    deliveryFee: Math.max(0, Math.round(pricing?.deliveryCharge ?? values.get('ghar.delivery_fee') ?? DEFAULT_CONFIG.deliveryFee)),
    freeDeliveryThreshold: Math.max(0, Math.round(pricing?.freeDeliveryThreshold ?? values.get('ghar.free_delivery_threshold') ?? DEFAULT_CONFIG.freeDeliveryThreshold)),
  };
}

async function quote(ctx: Pick<RequestContext, 'tdb' | 'device' | 'permissions'>, items: z.infer<typeof Lines>, homeDelivery = false) {
  if (!ctx.device) throw new AppError(403, 'DEVICE_REQUIRED', 'Register this device before creating delivery orders');
  if (new Set(items.map((item) => item.productId)).size !== items.length) throw new AppError(400, 'DUPLICATE_PRODUCT', 'Combine quantities for each product');
  const config = await readConfig(ctx);
  const ids = items.map((item) => item.productId);
  const productRows = await ctx.tdb.select(products, and(inArray(products.id, ids), eq(products.status, 'active')));
  if (productRows.length !== ids.length) throw new AppError(400, 'PRODUCT_UNAVAILABLE', 'A product is missing or inactive');
  const balances = await ctx.tdb.select(inventoryBalances, and(eq(inventoryBalances.branchId, ctx.device.branchId), inArray(inventoryBalances.productId, ids)));
  const unitIds = [...new Set(productRows.map((product) => product.baseUnitId))];
  const unitRows = await ctx.tdb.db.select().from(units).where(inArray(units.id, unitIds));
  const costByProduct = new Map(balances.map((balance) => [balance.productId, Number(balance.avgCost)]));
  const unitById = new Map(unitRows.map((unit) => [unit.id, unit.name]));
  const pricingRow = (await ctx.tdb.select(settings, eq(settings.scopeBranchId, ZERO_UUID))).find((row) => row.key === 'pos.pricing');
  const savedPricing = pricingRow?.value as Partial<PricingSettings> | undefined;
  const pricingSettings: PricingSettings = {
    ...DEFAULT_PRICING_SETTINGS,
    threshold: config.freeDeliveryThreshold,
    defaultPercent: config.discountPct,
    deliveryCharge: config.deliveryFee,
    freeDeliveryThreshold: config.freeDeliveryThreshold,
    ...savedPricing,
    categoryRules: savedPricing?.categoryRules ?? [],
  };
  const calculation = calculatePricing({
    lines: items.map((item) => ({ productId: item.productId, qty: item.qty })),
    products: productRows.map((product) => ({
      id: product.id,
      salePrice: Number(product.salePrice),
      thresholdPrice: product.thresholdPrice == null ? null : Number(product.thresholdPrice),
      wholesalePrice: product.wholesalePrice == null ? null : Number(product.wholesalePrice),
      categoryId: product.categoryId,
    })),
    settings: pricingSettings,
    homeDelivery,
  });
  const regularSubtotal = items.reduce((sum, item) => sum + Math.round(Number(productRows.find((row) => row.id === item.productId)!.salePrice) * item.qty), 0);
  const lines: GharOrderLine[] = items.map((item) => {
    const product = productRows.find((row) => row.id === item.productId)!;
    const quantity = Math.round(item.qty * 1000) / 1000;
    const cost = costByProduct.get(product.id) ?? 0;
    const marginFloor = cost > 0 ? Math.ceil((cost * 100) / (100 - config.minimumMarginPct)) : 0;
    const calculated = calculation.lines.find((line) => line.productId === product.id)!;
    const discountedUnitPrice = Number(product.salePrice) - calculated.discount / quantity;
    const price = Math.min(Number(product.salePrice), Math.max(Math.round(discountedUnitPrice), marginFloor));
    return {
      productId: product.id,
      name: product.name,
      unit: unitById.get(product.baseUnitId) ?? 'Piece',
      qty: quantity,
      price,
      regularPrice: product.salePrice,
      cost: Math.round(cost),
    };
  });
  const subtotal = lines.reduce((sum, line) => sum + Math.round(line.price * Math.round(line.qty * 1000) / 1000), 0);
  const deliveryFee = homeDelivery && regularSubtotal < pricingSettings.freeDeliveryThreshold ? pricingSettings.deliveryCharge : 0;
  return { config, lines, subtotal, deliveryFee, total: subtotal + deliveryFee };
}

function response(order: typeof gharOrders.$inferSelect, showCost: boolean) {
  return {
    id: order.id,
    no: order.no,
    date: order.occurredAt.toISOString(),
    customerId: order.customerId,
    customerName: order.customerName,
    phone: order.phone ?? undefined,
    address: order.address,
    items: order.items.map((line) => ({ ...line, cost: showCost ? line.cost : 0 })),
    subtotal: order.subtotal,
    deliveryFee: order.deliveryFee,
    total: order.total,
    status: order.status,
    ...(order.note ? { note: order.note } : {}),
    userId: order.createdBy ?? '',
  };
}

export const gharRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/', { schema: { querystring: z.object({ limit: z.coerce.number().int().min(1).max(500).default(200) }) }, config: { permission: 'customers.manage' } }, async (request) => {
    const rows = await request.ctx.tdb.select(gharOrders).orderBy(asc(gharOrders.occurredAt)).limit(request.query.limit);
    return { items: rows.reverse().map((order) => response(order, request.ctx.permissions.has('products.view_cost'))) };
  });

  app.get('/config', { config: { permission: 'customers.manage' } }, async (request) => readConfig(request.ctx));

  app.put('/config', {
    schema: { body: z.object({ discountPct: z.number().min(0).max(99), minimumMarginPct: z.number().min(0).max(99), deliveryFee: z.number().int().nonnegative(), freeDeliveryThreshold: z.number().int().nonnegative() }) },
    config: { permission: 'settings.manage', write: true },
  }, async (request) => {
    const { ctx } = request;
    const config = request.body;
    const entries = [
      ['ghar.discount_percent', config.discountPct],
      ['ghar.minimum_margin_percent', config.minimumMarginPct],
      ['ghar.delivery_fee', config.deliveryFee],
      ['ghar.free_delivery_threshold', config.freeDeliveryThreshold],
    ] as const;
    for (const [key, value] of entries) {
      await ctx.tdb.db.insert(settings).values({ tenantId: ctx.tenantId, scopeBranchId: ZERO_UUID, key, value, updatedBy: ctx.userId }).onDuplicateKeyUpdate({ set: { value, updatedBy: ctx.userId, updatedAt: new Date() } });
    }
    const pricingRow = (await ctx.tdb.select(settings, eq(settings.scopeBranchId, ZERO_UUID))).find((row) => row.key === 'pos.pricing');
    if (pricingRow && typeof pricingRow.value === 'object' && pricingRow.value !== null) {
      const pricing = pricingRow.value as Record<string, unknown>;
      const synchronized = { ...pricing, defaultPercent: config.discountPct, deliveryCharge: config.deliveryFee, freeDeliveryThreshold: config.freeDeliveryThreshold };
      await ctx.tdb.db.insert(settings).values({ tenantId: ctx.tenantId, scopeBranchId: ZERO_UUID, key: 'pos.pricing', value: synchronized, updatedBy: ctx.userId }).onDuplicateKeyUpdate({ set: { value: synchronized, updatedBy: ctx.userId, updatedAt: new Date() } });
    }
    return config;
  });

  app.post('/quote', { schema: { body: z.object({ items: Lines, homeDelivery: z.boolean().default(false) }) }, config: { permission: 'customers.manage' } }, async (request) => {
    const result = await quote(request.ctx, request.body.items, request.body.homeDelivery);
    return { items: result.lines.map((line) => ({ ...line, cost: request.ctx.permissions.has('products.view_cost') ? line.cost : 0 })), subtotal: result.subtotal, deliveryFee: result.deliveryFee, total: result.total, config: result.config };
  });

  app.post('/', { schema: { body: Input }, config: { permission: 'customers.manage', write: true } }, async (request) => {
    const { ctx } = request;
    if (!ctx.device) throw new AppError(403, 'DEVICE_REQUIRED', 'Register this device before creating delivery orders');
    return ctx.tdb.transaction(async (tdb) => {
      const existing = (await tdb.select(gharOrders, eq(gharOrders.id, request.body.id)))[0];
      if (existing) return response(existing, ctx.permissions.has('products.view_cost'));
      const customer = (await tdb.select(customers, and(eq(customers.id, request.body.customerId), isNull(customers.deletedAt))))[0];
      if (!customer) throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found');
      if (request.body.homeDelivery && !request.body.address) throw new AppError(400, 'DELIVERY_ADDRESS_REQUIRED', 'Enter a delivery address');
      const pricing = await quote({ ...ctx, tdb }, request.body.items, request.body.homeDelivery);
      const date = new Date();
      const no = `GH-${request.body.id.slice(0, 8).toUpperCase()}`;
      const order = {
        id: request.body.id,
        tenantId: ctx.tenantId,
        branchId: ctx.device!.branchId,
        occurredAt: date,
        receivedAt: date,
        no,
        customerId: customer.id,
        customerName: customer.name,
        phone: customer.phone,
        address: request.body.address,
        items: pricing.lines,
        subtotal: pricing.subtotal,
        deliveryFee: pricing.deliveryFee,
        total: pricing.total,
        status: 'invoice_draft',
        note: request.body.note ?? null,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
        originDeviceId: ctx.device!.id,
      } satisfies typeof gharOrders.$inferInsert;
      await tdb.insert(gharOrders, order);
      const created = (await tdb.select(gharOrders, eq(gharOrders.id, order.id)))[0]!;
      return response(created, ctx.permissions.has('products.view_cost'));
    });
  });

  app.post('/:id/status', {
    schema: { params: z.object({ id: z.uuid() }), body: z.object({ status: Status }) },
    config: { permission: 'customers.manage', write: true },
  }, async (request) => {
    const order = (await request.ctx.tdb.select(gharOrders, eq(gharOrders.id, request.params.id)))[0];
    if (!order) throw new AppError(404, 'NOT_FOUND', 'Delivery order not found');
    const allowed: Record<string, string[]> = {
      invoice_draft: ['invoice_sent', 'cancelled'],
      invoice_sent: ['confirmed', 'cancelled'],
      confirmed: ['packing', 'cancelled'],
      packing: ['out_for_delivery', 'cancelled'],
      out_for_delivery: ['delivered'],
      delivered: [],
      cancelled: [],
    };
    if (request.body.status !== order.status && !allowed[order.status]?.includes(request.body.status)) {
      throw new AppError(409, 'INVALID_ORDER_TRANSITION', `Cannot move an order from ${order.status} to ${request.body.status}`);
    }
    if (order.status !== request.body.status) {
      await request.ctx.tdb.update(gharOrders, { status: request.body.status, updatedAt: new Date(), updatedBy: request.ctx.userId }, eq(gharOrders.id, order.id));
    }
    return { ...response({ ...order, status: request.body.status }, request.ctx.permissions.has('products.view_cost')), updatedAt: new Date().toISOString() };
  });
};