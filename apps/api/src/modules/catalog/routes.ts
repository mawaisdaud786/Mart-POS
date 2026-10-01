import { SessionInfo } from '@retailos/contracts';
import { schema } from '@retailos/db';
import { asc, eq, like, or } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { notFound } from '../../lib/errors.js';
import { sessionInfo } from '../../lib/session.js';
import { toWire } from '../sync/serialize.js';

const { inventoryBalances, inventoryMovements, products, users } = schema;

const Row = z.record(z.string(), z.unknown());

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
