import type { Permission } from '@retailos/domain';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { forbidden } from '../../lib/errors.js';
import { ShopReports } from './reports.js';

/**
 * Report endpoints: `GET /shop/reports/*`. Each one checks the caller's permission on the server, then
 * runs SQL aggregates (see reports.ts) and returns only the finished figures. Cost, profit and ledger
 * numbers are never produced for a caller who may not see them.
 */

/** The browser's own range bounds (start of first day, end of last day, as ISO instants). */
const Iso = z.string().min(10).max(40).regex(/^\d{4}-\d{2}-\d{2}/);
const Range = z.object({ start: Iso, end: Iso });
const Id = z.string().min(1).max(64).regex(/^[A-Za-z0-9._:-]+$/);

export const reportRoutes: FastifyPluginAsyncZod = async (app) => {
  const ctxOf = (request: { ctx: { tenantId: string; userId: string; permissions: ReadonlySet<string> } }) => {
    const can = (p: Permission) => request.ctx.permissions.has(p);
    const need = (...any: Permission[]) => {
      if (!any.some(can)) throw forbidden();
    };
    return { can, need, userId: request.ctx.userId, reports: new ShopReports(app.db, request.ctx.tenantId) };
  };

  app.get('/profit', { schema: { querystring: Range } }, async (request) => {
    const { need, reports } = ctxOf(request);
    need('reports.profit', 'dashboard.owner');
    return reports.profit(request.query.start, request.query.end);
  });

  app.get('/products', { schema: { querystring: Range } }, async (request) => {
    const { need, reports } = ctxOf(request);
    need('reports.profit');
    return reports.productSales(request.query.start, request.query.end);
  });

  app.get('/product-performance', {
    schema: {
      querystring: Range.extend({ minimumMarginPct: z.coerce.number().min(0).max(100).default(5) }),
    },
  }, async (request) => {
    const { need, reports } = ctxOf(request);
    need('reports.profit', 'dashboard.owner');
    return reports.productPerformance(request.query.start, request.query.end, request.query.minimumMarginPct);
  });

  app.get('/product-pairs', {
    schema: {
      querystring: Range.extend({ limit: z.coerce.number().int().min(1).max(200).default(100) }),
    },
  }, async (request) => {
    const { need, reports } = ctxOf(request);
    need('sales.view_all', 'reports.sales', 'dashboard.owner');
    return reports.productPairs(request.query.start, request.query.end, request.query.limit);
  });

  app.get('/top-products', { schema: { querystring: Range.extend({ limit: z.coerce.number().int().min(1).max(50).default(5) }) } }, async (request) => {
    const { need, reports } = ctxOf(request);
    need('sales.view_all', 'dashboard.owner', 'reports.sales');
    return reports.topProducts(request.query.start, request.query.end, request.query.limit);
  });

  /** Bars for several day ranges at once. `ranges` is a JSON list of [start, end] pairs. */
  const Ranges = z
    .string()
    .max(6000)
    .transform((text, ctx) => {
      try {
        return z.array(z.tuple([Iso, Iso])).min(1).max(62).parse(JSON.parse(text));
      } catch {
        ctx.addIssue({ code: 'custom', message: 'ranges must be a list of [start, end] pairs' });
        return z.NEVER;
      }
    });
  app.get('/daily-sales', { schema: { querystring: z.object({ ranges: Ranges }) } }, async (request) => {
    const { need, reports } = ctxOf(request);
    need('sales.view_all', 'dashboard.owner', 'reports.sales');
    return reports.dailySales(request.query.ranges);
  });

  app.get('/sales-summary', { schema: { querystring: Range } }, async (request) => {
    const { can, need, userId, reports } = ctxOf(request);
    need('sales.view_all', 'sales.view_own');
    return reports.salesSummary(request.query.start, request.query.end, can('sales.view_all') ? undefined : userId);
  });

  app.get('/sales-velocity', { schema: { querystring: z.object({ since: Iso }) } }, async (request) => {
    const { need, reports } = ctxOf(request);
    need('pos.use');
    return reports.salesVelocity(request.query.since);
  });

  app.get('/expenses', { schema: { querystring: Range } }, async (request) => {
    const { need, reports } = ctxOf(request);
    need('expenses.view');
    return reports.expenses(request.query.start, request.query.end);
  });

  app.get('/purchases', { schema: { querystring: Range } }, async (request) => {
    const { need, reports } = ctxOf(request);
    need('purchasing.view', 'suppliers.view_balance');
    return reports.purchases(request.query.start, request.query.end);
  });

  app.get('/cash-breakdown', { schema: { querystring: Range.extend({ accountId: Id }) } }, async (request) => {
    const { need, reports } = ctxOf(request);
    need('accounts.view_balances');
    return reports.cashBreakdown(request.query.accountId, request.query.start, request.query.end);
  });

  app.get('/services', { schema: { querystring: Range.extend({ provider: Id }) } }, async (request) => {
    const { can, need, userId, reports } = ctxOf(request);
    need('retailer.transact', 'retailer.view_all');
    return reports.services(request.query.provider, request.query.start, request.query.end, can('retailer.view_all') ? undefined : userId);
  });

  /** Credit totals. Each half is only present when the caller may see that kind of balance. */
  app.get('/khata', async (request) => {
    const { can, need, reports } = ctxOf(request);
    need('customers.view_balance', 'suppliers.view_balance');
    const k = await reports.khata();
    return {
      ...(can('customers.view_balance') ? { customerDue: k.customerDue, customersWithDue: k.customersWithDue, overLimit: k.overLimit } : {}),
      ...(can('suppliers.view_balance') ? { supplierDue: k.supplierDue, supplierAccounts: k.supplierAccounts } : {}),
    };
  });

  /**
   * Everything the dashboard's figures need in ONE request (it used to make eleven, which is slow on a busy or distant host).
   * Each part is only computed for a caller who may see it; the others come back as null.
   */
  app.get(
    '/dashboard',
    {
      schema: {
        querystring: z.object({
          today: Range.shape.start.optional(),
          todayEnd: Range.shape.end.optional(),
          weekStart: Range.shape.start,
          weekEnd: Range.shape.end,
          prevStart: Range.shape.start,
          prevEnd: Range.shape.end,
          days: Ranges,
          now: z.coerce.number().int().min(0),
          tz: z.coerce.number().int().min(-840).max(840),
          lead: z.coerce.number().int().min(0).max(120).default(3),
          velocityDays: z.coerce.number().int().min(7).max(180).default(30),
          safetyDays: z.coerce.number().int().min(0).max(90).default(2),
          lowDays: z.coerce.number().int().min(1).max(90).default(3),
        }),
      },
    },
    async (request) => {
      const { can, reports } = ctxOf(request);
      const q = request.query;
      const profitOk = can('reports.profit') || can('dashboard.owner');
      const salesOk = can('sales.view_all') || can('dashboard.owner') || can('reports.sales');
      const stockOk = can('inventory.view') || can('reports.inventory');
      if (!profitOk && !salesOk && !stockOk && !can('customers.view_balance') && !can('suppliers.view_balance')) throw forbidden();
      const todayStart = q.today ?? q.weekEnd.slice(0, 10) + 'T00:00:00.000Z';
      const todayEnd = q.todayEnd ?? q.weekEnd;
      const { dayNumberOf } = await import('@retailos/domain');
      // Three profit reports one after another, the rest side by side: keeps the number of simultaneous database queries modest.
      const todayP = profitOk ? await reports.profit(todayStart, todayEnd) : null;
      const weekP = profitOk ? await reports.profit(q.weekStart, q.weekEnd) : null;
      const prevWeekP = profitOk ? await reports.profit(q.prevStart, q.prevEnd) : null;
      const [khata, stock, topProducts, daily] = await Promise.all([
        can('customers.view_balance') || can('suppliers.view_balance') ? reports.khata() : null,
        stockOk
          ? reports.reorder({
              today: dayNumberOf(q.now, q.tz),
              nowMs: q.now,
              defaultLeadDays: q.lead,
              coverDays: 7,
              salesVelocityDays: q.velocityDays,
              safetyStockDays: q.safetyDays,
              lowStockDaysThreshold: q.lowDays,
              includeRows: false,
              showCost: false,
            })
          : null,
        salesOk ? reports.topProducts(q.weekStart, q.weekEnd, 5) : null,
        salesOk ? reports.dailySales(q.days) : null,
      ]);
      return {
        todayP,
        weekP,
        prevWeekP,
        khata: khata && {
          ...(can('customers.view_balance') ? { customerDue: khata.customerDue, customersWithDue: khata.customersWithDue, overLimit: khata.overLimit } : {}),
          ...(can('suppliers.view_balance') ? { supplierDue: khata.supplierDue, supplierAccounts: khata.supplierAccounts } : {}),
        },
        stock: stock && { ...stock, summary: { ...stock.summary, stockValue: can('inventory.view_value') ? stock.summary.stockValue : null } },
        topProducts,
        daily,
      };
    },
  );

  app.get(
    '/reorder',
    {
      schema: {
        querystring: z.object({
          now: z.coerce.number().int().min(0),
          tz: z.coerce.number().int().min(-840).max(840),
          lead: z.coerce.number().int().min(0).max(120).default(3),
          cover: z.coerce.number().int().min(1).max(60).default(7),
          velocityDays: z.coerce.number().int().min(7).max(180).default(30),
          safetyDays: z.coerce.number().int().min(0).max(90).default(2),
          lowDays: z.coerce.number().int().min(1).max(90).default(3),
          rows: z.enum(['0', '1']).default('1'),
        }),
      },
    },
    async (request) => {
      const { can, need, reports } = ctxOf(request);
      need('inventory.view', 'reports.inventory', 'dashboard.owner');
      const { dayNumberOf } = await import('@retailos/domain');
      const q = request.query;
      const result = await reports.reorder({
        today: dayNumberOf(q.now, q.tz),
        nowMs: q.now,
        defaultLeadDays: q.lead,
        coverDays: q.cover,
        salesVelocityDays: q.velocityDays,
        safetyStockDays: q.safetyDays,
        lowStockDaysThreshold: q.lowDays,
        includeRows: q.rows === '1',
        showCost: can('products.view_cost'),
      });
      return { ...result, summary: { ...result.summary, stockValue: can('inventory.view_value') ? result.summary.stockValue : null } };
    },
  );
};
