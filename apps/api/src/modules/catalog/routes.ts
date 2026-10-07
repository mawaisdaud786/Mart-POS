import { SessionInfo } from '@retailos/contracts';
import { recordChanges, schema, type TenantDb } from '@retailos/db';
import { supportsFractionalSaleQuantity } from '@retailos/domain';
import { and, asc, eq, inArray, like, lte, or, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError, notFound } from '../../lib/errors.js';
import { sessionInfo } from '../../lib/session.js';
import { toWire } from '../sync/serialize.js';

const { categories, inventoryBalances, inventoryMovements, inventoryReservations, products, users } = schema;

const Row = z.record(z.string(), z.unknown());

async function expireInventoryReservations(tdb: TenantDb, branchId: string, now: Date): Promise<void> {
  const expired = await tdb.db.select().from(inventoryReservations)
    .where(tdb.scope(inventoryReservations, and(eq(inventoryReservations.branchId, branchId), eq(inventoryReservations.status, 'active'), lte(inventoryReservations.expiresAt, now))))
    .for('update');
  if (expired.length === 0) return;
  const released = new Map<string, number>();
  for (const reservation of expired) {
    for (const line of reservation.lines) released.set(line.productId, (released.get(line.productId) ?? 0) + line.qty);
  }
  const productIds = [...released.keys()].sort();
  const balances = productIds.length ? await tdb.db.select().from(inventoryBalances)
    .where(tdb.scope(inventoryBalances, and(eq(inventoryBalances.branchId, branchId), inArray(inventoryBalances.productId, productIds))))
    .for('update') : [];
  for (const balance of balances) {
    await tdb.update(inventoryBalances, { qtyReserved: Math.max(0, Number(balance.qtyReserved) - (released.get(balance.productId) ?? 0)) }, and(eq(inventoryBalances.branchId, branchId), eq(inventoryBalances.productId, balance.productId))!);
  }
  for (const reservation of expired) {
    await tdb.update(inventoryReservations, { status: 'expired', updatedAt: now }, eq(inventoryReservations.reservationId, reservation.reservationId));
  }
}

/**
 * Online read endpoints. Devices normally read from their local database; these serve the
 * back office, imports and integrations. Writes go through /sync/push.
 */
export const catalogRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/me', { schema: { response: { 200: SessionInfo.omit({ accessToken: true, expiresIn: true }) } } }, async (request) => {
    const user = (await app.db.select().from(users).where(eq(users.id, request.ctx.userId)))[0];
    if (!user) throw notFound('User');
    const { accessToken: _a, expiresIn: _e, ...info } = sessionInfo(request.ctx, '', 0, user);
    return info;
  });

  app.get(
    '/products',
    {
      schema: {
        querystring: z.object({
          q: z.string().trim().max(100).optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
          offset: z.coerce.number().int().min(0).default(0),
        }),
        response: { 200: z.object({ items: z.array(Row) }) },
      },
      config: { permission: 'products.view' },
    },
    async (request) => {
      const { tdb } = request.ctx;
      const { q, limit, offset } = request.query;
      const search = q ? or(like(products.name, `%${q}%`), like(products.sku, `${q}%`), like(products.nameUr, `%${q}%`)) : undefined;
      const rows = await tdb.db
        .select()
        .from(products)
        .where(tdb.active(products, search))
        .orderBy(asc(products.name))
        .limit(limit)
        .offset(offset);
      return { items: rows.map((r) => toWire(r)) };
    },
  );

  app.put('/products/:productId/pricing', {
    schema: {
      params: z.object({ productId: z.uuid() }),
      body: z.object({ thresholdPrice: z.number().int().nonnegative().nullable(), wholesalePrice: z.number().int().nonnegative().nullable() }),
    },
    config: { permission: 'products.edit_price', write: true },
  }, async (request) => request.ctx.tdb.transaction(async (tdb) => {
    const product = (await tdb.db.select().from(products).where(tdb.scope(products, eq(products.id, request.params.productId))).for('update'))[0];
    if (!product || product.deletedAt) throw notFound('Product');
    if (request.body.thresholdPrice != null && request.body.thresholdPrice > Number(product.salePrice)) {
      throw new AppError(400, 'INVALID_THRESHOLD_PRICE', 'Threshold price cannot exceed the normal sale price');
    }
    if (request.body.thresholdPrice != null && product.minSalePrice != null && request.body.thresholdPrice < Number(product.minSalePrice)) {
      throw new AppError(400, 'BELOW_MINIMUM_PRICE', 'Threshold price cannot be below the product minimum sale price');
    }
    const version = product.version + 1;
    await tdb.update(products, {
      thresholdPrice: request.body.thresholdPrice,
      wholesalePrice: request.body.wholesalePrice,
      version,
      updatedBy: request.ctx.userId,
      updatedAt: new Date(),
    }, eq(products.id, product.id));
    await recordChanges(tdb.db, tdb.tenantId, [{ entityType: 'product', entityId: product.id, op: 'upsert', version }]);
    return { thresholdPrice: request.body.thresholdPrice, wholesalePrice: request.body.wholesalePrice, version };
  }));

  app.get('/inventory/pos-stock', { config: { permission: 'pos.use' } }, async (request) => {
    const { tdb, device } = request.ctx;
    if (!device) throw new AppError(403, 'DEVICE_REQUIRED', 'Register this device to load live POS stock');
    return tdb.transaction(async (tx) => {
      await expireInventoryReservations(tx, device.branchId, new Date());
      const rows = await tx.select(inventoryBalances, eq(inventoryBalances.branchId, device.branchId));
      return { items: rows.map((row) => ({
        productId: row.productId,
        stock: Number(row.qtyOnHand),
        reserved: Number(row.qtyReserved),
        available: Math.max(0, Number(row.qtyOnHand) - Number(row.qtyReserved)),
      })) };
    });
  });

  app.put('/inventory/reservations/:reservationId', {
    schema: {
      params: z.object({ reservationId: z.uuid() }),
      body: z.object({ items: z.array(z.object({ productId: z.uuid(), qty: z.number().positive().max(1_000_000) })).max(500) }),
    },
    config: { permission: 'pos.use', write: true },
  }, async (request) => {
    const { ctx } = request;
    if (!ctx.device) throw new AppError(403, 'DEVICE_REQUIRED', 'Register this device to reserve stock');
    const device = ctx.device;
    if (new Set(request.body.items.map((item) => item.productId)).size !== request.body.items.length) {
      throw new AppError(400, 'DUPLICATE_PRODUCT', 'Cart reservation contains duplicate products');
    }
    return ctx.tdb.transaction(async (tdb) => {
      const now = new Date();
      await expireInventoryReservations(tdb, device.branchId, now);

      const existing = (await tdb.db.select().from(inventoryReservations)
        .where(tdb.scope(inventoryReservations, eq(inventoryReservations.reservationId, request.params.reservationId)))
        .for('update'))[0];
      if (existing && (existing.deviceId !== device.id || existing.branchId !== device.branchId)) {
        throw new AppError(409, 'RESERVATION_CONFLICT', 'This cart reservation is no longer available');
      }
      if (existing && existing.status !== 'active' && existing.status !== 'expired') {
        if (request.body.items.length === 0) return { reservationId: request.params.reservationId, expiresAt: null };
        throw new AppError(409, 'RESERVATION_CONFLICT', 'This cart reservation is no longer available');
      }
      const oldQuantities = new Map<string, number>();
      if (existing?.status === 'active' && existing.expiresAt > now) {
        for (const line of existing.lines) oldQuantities.set(line.productId, (oldQuantities.get(line.productId) ?? 0) + line.qty);
      }
      const requested = new Map(request.body.items.map((item) => [item.productId, item.qty]));
      const productIds = [...new Set([...oldQuantities.keys(), ...requested.keys()])].sort();
      const productRows = productIds.length ? await tdb.select(products, inArray(products.id, productIds)) : [];
      if (productRows.length !== productIds.length) throw new AppError(400, 'PRODUCT_UNAVAILABLE', 'A cart product is missing or inactive');
      const categoryIds = [...new Set(productRows.map((product) => product.categoryId).filter((id): id is string => !!id))];
      const categoryRows = categoryIds.length ? await tdb.select(categories, inArray(categories.id, categoryIds)) : [];
      const categoryNameById = new Map(categoryRows.map((category) => [category.id, category.name]));
      for (const item of request.body.items) {
        const product = productRows.find((entry) => entry.id === item.productId)!;
        if (!supportsFractionalSaleQuantity(categoryNameById.get(product.categoryId ?? '')) && !Number.isInteger(item.qty)) {
          throw new AppError(400, 'FRACTIONAL_QUANTITY_NOT_ALLOWED', `Use a whole-number quantity for ${product.name}`);
        }
      }
      const trackedIds = new Set(productRows.filter((product) => product.trackStock).map((product) => product.id));
      const reservationLines = [...requested].filter(([productId]) => trackedIds.has(productId)).map(([productId, qty]) => ({ productId, qty }));
      const trackedProductIds = [...new Set([...oldQuantities.keys(), ...reservationLines.map((line) => line.productId)])].filter((id) => trackedIds.has(id)).sort();

      if (trackedProductIds.length) {
        const trackedProducts = productRows.filter((product) => trackedProductIds.includes(product.id));
        await tdb.db.insert(inventoryBalances).values(trackedProducts.map((product) => ({
          tenantId: ctx.tenantId,
          branchId: ctx.device!.branchId,
          productId: product.id,
          qtyOnHand: 0,
          qtyReserved: 0,
          avgCost: '0',
          stockValue: 0,
        }))).onDuplicateKeyUpdate({ set: { productId: sql`product_id` } });
        const balanceRows = await tdb.db.select().from(inventoryBalances)
          .where(tdb.scope(inventoryBalances, and(eq(inventoryBalances.branchId, ctx.device!.branchId), inArray(inventoryBalances.productId, trackedProductIds))))
          .for('update');
        const balanceByProduct = new Map(balanceRows.map((row) => [row.productId, row]));
        for (const productId of trackedProductIds) {
          const balance = balanceByProduct.get(productId)!;
          const ownQty = oldQuantities.get(productId) ?? 0;
          const wanted = requested.get(productId) ?? 0;
          const reservedWithoutOwn = Math.max(0, Number(balance.qtyReserved) - ownQty);
          if (wanted > 0 && Number(balance.qtyOnHand) - reservedWithoutOwn < wanted) {
            throw new AppError(409, 'INSUFFICIENT_AVAILABLE_STOCK', `Only ${Math.max(0, Number(balance.qtyOnHand) - reservedWithoutOwn)} units are available`);
          }
          await tdb.update(inventoryBalances, { qtyReserved: reservedWithoutOwn + wanted }, and(eq(inventoryBalances.branchId, device.branchId), eq(inventoryBalances.productId, productId))!);
        }
      }

      const expiresAt = new Date(now.getTime() + 120_000);
      if (existing) {
        await tdb.update(inventoryReservations, { lines: reservationLines, status: reservationLines.length ? 'active' : 'released', expiresAt, updatedAt: now }, eq(inventoryReservations.reservationId, request.params.reservationId));
      } else if (reservationLines.length) {
        await tdb.insert(inventoryReservations, {
          tenantId: ctx.tenantId,
          reservationId: request.params.reservationId,
          branchId: device.branchId,
          deviceId: device.id,
          userId: ctx.userId,
          lines: reservationLines,
          status: 'active',
          expiresAt,
          createdAt: now,
          updatedAt: now,
        });
      }
      return { reservationId: request.params.reservationId, expiresAt: reservationLines.length ? expiresAt.toISOString() : null };
    });
  });

  app.get(
    '/inventory',
    {
      schema: {
        querystring: z.object({ branchId: z.uuid().optional() }),
        response: { 200: z.object({ items: z.array(Row) }) },
      },
      config: { permission: 'inventory.view' },
    },
    async (request) => {
      const { tdb, permissions, device } = request.ctx;
      const branchId = request.query.branchId ?? device?.branchId;
      const rows = await tdb.select(inventoryBalances, branchId ? eq(inventoryBalances.branchId, branchId) : undefined);
      // Stock value and average cost are hidden from roles that can't see cost (e.g. cashier).
      const showCost = permissions.has('products.view_cost') || permissions.has('inventory.view_value');
      return {
        items: rows.map((r) => {
          const w = toWire(r);
          if (!showCost) {
            delete w.avgCost;
            delete w.stockValue;
          }
          return w;
        }),
      };
    },
  );

  app.get(
    '/inventory/:productId/movements',
    {
      schema: {
        params: z.object({ productId: z.uuid() }),
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }),
        response: { 200: z.object({ items: z.array(Row) }) },
      },
      config: { permission: 'inventory.view' },
    },
    async (request) => {
      const { tdb, permissions } = request.ctx;
      const rows = await tdb.db
        .select()
        .from(inventoryMovements)
        .where(tdb.scope(inventoryMovements, eq(inventoryMovements.productId, request.params.productId)))
        .orderBy(asc(inventoryMovements.occurredAt))
        .limit(request.query.limit);
      const showCost = permissions.has('products.view_cost');
      return {
        items: rows.map((r) => {
          const w = toWire(r);
          if (!showCost) {
            delete w.unitCost;
            delete w.totalCost;
          }
          return w;
        }),
      };
    },
  );
};
