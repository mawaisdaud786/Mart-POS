import { schema, recordChanges, type TenantDb } from '@retailos/db';
import { calculatePricing, DEFAULT_PRICING_SETTINGS, invoiceNumberPrefix, issueStock, newId, stockValue, supportsFractionalSaleQuantity, type PricingSettings } from '@retailos/domain';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { toWire } from '../sync/serialize.js';

const { categories, customerLedgerEntries, customers, gharOrders, inventoryBalances, inventoryMovements, inventoryReservations, products, saleItems, sales, settings, units } = schema;
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const PricingConfig = z.object({
  autoDiscountEnabled: z.boolean(),
  threshold: z.number().int().nonnegative(),
  defaultPercent: z.number().min(0).max(100),
  maxPercent: z.number().min(0).max(100),
  categoryRules: z.array(z.object({ categoryId: z.uuid(), percent: z.number().min(0).max(100), enabled: z.boolean() })).max(500),
  deliveryEnabled: z.boolean(),
  deliveryCharge: z.number().int().nonnegative(),
  freeDeliveryThreshold: z.number().int().nonnegative(),
  businessPricingEnabled: z.boolean(),
});

async function readPricingSettings(tdb: TenantDb): Promise<PricingSettings> {
  const rows = await tdb.select(settings, eq(settings.scopeBranchId, ZERO_UUID));
  const row = rows.find((setting) => setting.key === 'pos.pricing');
  const parsed = PricingConfig.safeParse(row?.value);
  return parsed.success ? parsed.data : DEFAULT_PRICING_SETTINGS;
}

const SaleCreate = z.object({
  id: z.uuid(),
  reservationId: z.uuid().optional(),
  customerId: z.uuid().optional(),
  gharOrderId: z.uuid().optional(),
  deliveryFee: z.number().int().nonnegative().optional(),
  deliveryAddress: z.string().trim().max(1000).optional(),
  homeDelivery: z.boolean().default(false),
  pricingMode: z.enum(['normal', 'business']).default('normal'),
  paymentMethod: z.enum(['cash', 'credit']).default('cash'),
  discount: z.number().int().nonnegative().default(0),
  items: z.array(z.object({
    productId: z.uuid(),
    qty: z.number().positive().max(1_000_000),
    price: z.number().int().nonnegative(),
    discount: z.number().int().nonnegative().default(0),
  })).min(1).max(500),
  payments: z.array(z.object({ accountId: z.string().trim().min(1).max(64), amount: z.number().int().nonnegative() })).max(20),
  note: z.string().trim().max(1000).optional(),
});
const PAYMENT_ACCOUNT_IDS = new Set(['acc-cash', 'acc-bank', 'acc-easypaisa', 'acc-jazzcash']);

type SaleView = {
  id: string;
  no: string;
  date: string;
  customerId?: string;
  gharOrderId?: string;
  pricingMode: 'normal' | 'business';
  paymentMethod: 'cash' | 'credit';
  items: { productId: string; name: string; unit: string; qty: number; price: number; discount: number; cost: number; returnedQty: number }[];
  subtotal: number;
  discount: number;
  deliveryFee: number;
  deliveryAddress?: string;
  total: number;
  paid: number;
  change: number;
  credit: number;
  payments: { accountId: string; amount: number }[];
  userId: string;
  status: 'completed' | 'void';
  returnedTotal: number;
  note?: string;
};

export const salesRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/pricing-settings', { config: { permission: 'pos.use' } }, async (request) => readPricingSettings(request.ctx.tdb));

  app.put('/pricing-settings', {
    schema: { body: PricingConfig },
    config: { permission: 'settings.manage', write: true },
  }, async (request) => {
    const entries: [string, unknown][] = [
      ['pos.pricing', request.body],
      ['ghar.delivery_fee', request.body.deliveryCharge],
      ['ghar.free_delivery_threshold', request.body.freeDeliveryThreshold],
    ];
    for (const [key, value] of entries) {
      await request.ctx.tdb.db.insert(settings).values({
        tenantId: request.ctx.tenantId,
        scopeBranchId: ZERO_UUID,
        key,
        value,
        updatedBy: request.ctx.userId,
      }).onDuplicateKeyUpdate({ set: { value, updatedBy: request.ctx.userId, updatedAt: new Date() } });
    }
    return request.body;
  });

  app.get(
    '/',
    {
      schema: {
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(500).default(200) }),
        response: { 200: z.object({ items: z.array(z.record(z.string(), z.unknown())) }) },
      },
    },
    async (request) => {
      const { ctx } = request;
      const viewAll = ctx.permissions.has('sales.view_all');
      if (!viewAll && !ctx.permissions.has('sales.view_own')) throw new AppError(403, 'PERMISSION_DENIED', 'You do not have permission to view sales');
      const where = viewAll ? undefined : eq(sales.createdBy, ctx.userId);
      const documents = await ctx.tdb.select(sales, where).orderBy(desc(sales.occurredAt)).limit(request.query.limit);
      if (documents.length === 0) return { items: [] };
      const lines = await ctx.tdb.select(saleItems, inArray(saleItems.saleId, documents.map((sale) => sale.id)));
      const bySale = new Map<string, typeof lines>();
      for (const line of lines) bySale.set(line.saleId, [...(bySale.get(line.saleId) ?? []), line]);
      const showCost = ctx.permissions.has('products.view_cost');
      return { items: documents.map((sale) => formatSale(sale, bySale.get(sale.id) ?? [], showCost)) };
    },
  );

  app.post(
    '/',
    { schema: { body: SaleCreate }, config: { permission: 'pos.use', write: true } },
    async (request) => {
      const input = request.body;
      const { ctx } = request;
      if (!ctx.device) throw new AppError(403, 'DEVICE_REQUIRED', 'Register this device before completing sales');
      if (new Set(input.items.map((item) => item.productId)).size !== input.items.length) {
        throw new AppError(400, 'DUPLICATE_PRODUCT', 'Combine quantities for each product before completing the sale');
      }

      if (input.discount > 0 && !ctx.permissions.has('sales.discount.order')) {
        throw new AppError(403, 'PERMISSION_DENIED', 'You do not have permission to discount the bill');
      }
      if (input.customerId && !ctx.permissions.has('customers.view')) {
        throw new AppError(403, 'PERMISSION_DENIED', 'You do not have permission to attach a customer to this sale');
      }
      if (input.items.some((item) => item.price < 0)) throw new AppError(400, 'INVALID_PRICE', 'Price cannot be negative');
      if (input.paymentMethod === 'credit' && !input.customerId) throw new AppError(400, 'CUSTOMER_REQUIRED', 'Select a customer for udhaar');

      const sale = await ctx.tdb.transaction(async (tdb) => {
        const existing = (await tdb.select(sales, eq(sales.id, input.id)))[0];
        if (existing) {
          if (input.gharOrderId && existing.gharOrderId !== input.gharOrderId) {
            throw new AppError(409, 'SALE_ID_REUSED', 'This sale ID is already used by another order');
          }
          const existingItems = await tdb.select(saleItems, eq(saleItems.saleId, input.id));
          if (input.gharOrderId) await tdb.update(gharOrders, { saleId: existing.id, status: 'delivered', updatedAt: new Date(), updatedBy: ctx.userId }, eq(gharOrders.id, input.gharOrderId));
          return formatSale(existing, existingItems, ctx.permissions.has('products.view_cost'));
        }

        let gharOrder: typeof gharOrders.$inferSelect | undefined;
        if (input.gharOrderId) {
          if (!ctx.permissions.has('customers.manage')) throw new AppError(403, 'PERMISSION_DENIED', 'You do not have permission to complete a delivery order');
          gharOrder = (await tdb.select(gharOrders, eq(gharOrders.id, input.gharOrderId)))[0];
          if (!gharOrder || gharOrder.status !== 'out_for_delivery' || gharOrder.saleId) {
            throw new AppError(409, 'GHAR_ORDER_NOT_READY', 'This delivery order is not ready for POS checkout');
          }
          if (input.customerId !== gharOrder.customerId || input.deliveryFee !== gharOrder.deliveryFee || input.discount !== 0) {
            throw new AppError(400, 'GHAR_QUOTE_MISMATCH', 'Customer, delivery fee or discount no longer matches the confirmed quote');
          }
          const savedLines = [...gharOrder.items].sort((a, b) => a.productId.localeCompare(b.productId));
          const submittedLines = [...input.items].sort((a, b) => a.productId.localeCompare(b.productId));
          if (savedLines.length !== submittedLines.length || savedLines.some((line, index) =>
            line.productId !== submittedLines[index]?.productId ||
            Math.round(line.qty * 1000) !== Math.round((submittedLines[index]?.qty ?? 0) * 1000) ||
            line.price !== submittedLines[index]?.price || submittedLines[index]?.discount !== 0
          )) throw new AppError(400, 'GHAR_ITEMS_MISMATCH', 'Cart items must match the confirmed delivery order');
        }

        const productIds = input.items.map((item) => item.productId);
        const productRows = await tdb.select(products, and(inArray(products.id, productIds), eq(products.status, 'active')));
        if (productRows.length !== productIds.length) throw new AppError(400, 'PRODUCT_UNAVAILABLE', 'A product is missing or inactive');
        const productById = new Map(productRows.map((product) => [product.id, product]));
        const categoryIds = [...new Set(productRows.map((product) => product.categoryId).filter((id): id is string => !!id))];
        const categoryRows = categoryIds.length ? await tdb.select(categories, inArray(categories.id, categoryIds)) : [];
        const categoryNameById = new Map(categoryRows.map((category) => [category.id, category.name]));
        for (const item of input.items) {
          const product = productById.get(item.productId)!;
          if (!supportsFractionalSaleQuantity(categoryNameById.get(product.categoryId ?? '')) && !Number.isInteger(item.qty)) {
            throw new AppError(400, 'FRACTIONAL_QUANTITY_NOT_ALLOWED', `Use a whole-number quantity for ${product.name}`);
          }
        }
        const unitIds = [...new Set(productRows.map((product) => product.baseUnitId))];
        const unitRows = await tdb.db.select().from(units).where(inArray(units.id, unitIds));
        const unitNames = new Map(unitRows.map((unit) => [unit.id, unit.name]));

        const reservedByProduct = new Map<string, number>();
        let reservation: typeof inventoryReservations.$inferSelect | undefined;
        if (input.reservationId) {
          reservation = (await tdb.db.select().from(inventoryReservations)
            .where(tdb.scope(inventoryReservations, eq(inventoryReservations.reservationId, input.reservationId)))
            .for('update'))[0];
          if (!reservation || reservation.status !== 'active' || reservation.expiresAt <= new Date() || reservation.deviceId !== ctx.device!.id || reservation.branchId !== ctx.device!.branchId) {
            throw new AppError(409, 'STOCK_RESERVATION_EXPIRED', 'Stock reservation expired. Refresh the cart and try again.');
          }
          for (const line of reservation.lines) reservedByProduct.set(line.productId, line.qty);
          const expected = input.items.filter((item) => productById.get(item.productId)?.trackStock)
            .map((item) => ({ productId: item.productId, qty: Math.round(item.qty * 1000) / 1000 })).sort((a, b) => a.productId.localeCompare(b.productId));
          const claimed = reservation.lines.map((item) => ({ productId: item.productId, qty: Math.round(item.qty * 1000) / 1000 })).sort((a, b) => a.productId.localeCompare(b.productId));
          if (expected.length !== claimed.length || expected.some((item, index) => item.productId !== claimed[index]?.productId || item.qty !== claimed[index]?.qty)) {
            throw new AppError(409, 'STOCK_RESERVATION_MISMATCH', 'Cart quantities changed. Refresh the stock reservation before completing the sale.');
          }
        }

        const tenantPricing = gharOrder ? undefined : await readPricingSettings(tdb);
        if (!gharOrder && input.pricingMode === 'business' && !tenantPricing?.businessPricingEnabled) {
          throw new AppError(400, 'BUSINESS_PRICING_DISABLED', 'Shopkeeper pricing is disabled in Settings');
        }
        const calculateSalePricing = (paymentMethod: 'cash' | 'credit') => gharOrder ? undefined : calculatePricing({
          lines: input.items.map((item) => ({ productId: item.productId, qty: item.qty, price: ctx.permissions.has('sales.price_override') ? item.price : Number(productById.get(item.productId)!.salePrice) })),
          products: productRows.map((product) => ({
            id: product.id,
            salePrice: Number(product.salePrice),
            thresholdPrice: product.thresholdPrice == null ? null : Number(product.thresholdPrice),
            wholesalePrice: product.wholesalePrice == null ? null : Number(product.wholesalePrice),
            categoryId: product.categoryId,
          })),
          settings: tenantPricing!,
          pricingMode: input.pricingMode,
          paymentMethod,
          homeDelivery: input.homeDelivery,
        });
        let pricing = calculateSalePricing(input.paymentMethod);
        const submittedTender = input.payments.reduce((sum, payment) => sum + payment.amount, 0);
        if (pricing && input.paymentMethod !== 'credit' && submittedTender < pricing.total - input.discount) {
          pricing = calculateSalePricing('credit');
        }
        if (!gharOrder && input.homeDelivery && !input.deliveryAddress?.trim()) {
          throw new AppError(400, 'DELIVERY_ADDRESS_REQUIRED', 'Enter a delivery address');
        }
        if (!gharOrder && input.homeDelivery && !input.customerId) {
          throw new AppError(400, 'DELIVERY_CUSTOMER_REQUIRED', 'Select a customer for home delivery');
        }
        if (!gharOrder && input.homeDelivery && input.customerId) {
          const deliveryCustomer = (await tdb.select(customers, eq(customers.id, input.customerId)))[0];
          if (!deliveryCustomer || deliveryCustomer.deletedAt) throw new AppError(400, 'CUSTOMER_NOT_FOUND', 'Delivery customer is not available');
        }
        if (!gharOrder && input.homeDelivery && !tenantPricing?.deliveryEnabled) {
          throw new AppError(400, 'DELIVERY_DISABLED', 'Home delivery is disabled in Settings');
        }

        for (const item of input.items) {
          const product = productById.get(item.productId)!;
          const calculatedLine = pricing?.lines.find((line) => line.productId === item.productId);
          const effectiveUnitPrice = calculatedLine ? calculatedLine.price - calculatedLine.discount / calculatedLine.qty : item.price;
          if (!gharOrder && input.pricingMode !== 'business' && item.price !== product.salePrice && !ctx.permissions.has('sales.price_override')) {
            throw new AppError(403, 'PRICE_OVERRIDE_FORBIDDEN', `Price override is not allowed for ${product.name}`);
          }
          if (input.pricingMode !== 'business' && product.minSalePrice != null && effectiveUnitPrice < Number(product.minSalePrice) && !ctx.permissions.has('sales.below_min_price')) {
            throw new AppError(403, 'BELOW_MINIMUM_PRICE', `Price is below the minimum for ${product.name}`);
          }
          const gross = Math.round((item.price * Math.round(item.qty * 1000)) / 1000);
          if (item.discount > gross) throw new AppError(400, 'INVALID_DISCOUNT', `Discount exceeds the line value for ${product.name}`);
        }

        await tdb.db
          .insert(inventoryBalances)
          .values(productRows.filter((product) => product.trackStock).map((product) => ({
            tenantId: ctx.tenantId,
            branchId: ctx.device!.branchId,
            productId: product.id,
            qtyOnHand: 0,
            avgCost: '0',
            stockValue: 0,
          })))
          .onDuplicateKeyUpdate({ set: { productId: sql`product_id` } });

        const balanceRows = await tdb.db
          .select()
          .from(inventoryBalances)
          .where(tdb.scope(inventoryBalances, eq(inventoryBalances.branchId, ctx.device!.branchId), inArray(inventoryBalances.productId, productIds)))
          .for('update');
        const balanceByProduct = new Map(balanceRows.map((row) => [row.productId, row]));
        const date = new Date();
        const id = input.id;
        const no = `${invoiceNumberPrefix(date)}-${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
        const lines: SaleView['items'] = [];
        const changeRecords: { entityType: string; entityId: string; op: 'upsert'; branchId: string }[] = [];
        const movements: Array<typeof inventoryMovements.$inferInsert> = [];
        const balanceUpdates: Array<{ productId: string; qtyOnHand: number; qtyReserved: number; avgCost: number; stockValue: number }> = [];
        let subtotal = 0;
        let automaticDiscount = 0;

        for (const [index, item] of input.items.entries()) {
          const product = productById.get(item.productId)!;
          const calculatedLine = pricing?.lines.find((line) => line.productId === item.productId);
          const appliedPrice = calculatedLine?.price ?? item.price;
          const appliedDiscount = calculatedLine?.discount ?? item.discount;
          const quantity = Math.round(item.qty * 1000);
          const gross = Math.round((appliedPrice * quantity) / 1000);
          subtotal += gross;
          automaticDiscount += appliedDiscount;
          const before = balanceByProduct.get(product.id);
          const position = { qtyOnHand: before?.qtyOnHand ?? 0, avgCost: Number(before?.avgCost ?? 0) };
          const cost = Math.round(position.avgCost);

          lines.push({
            productId: product.id,
            name: product.name,
            unit: unitNames.get(product.baseUnitId) ?? 'Piece',
            qty: quantity / 1000,
            price: appliedPrice,
            discount: appliedDiscount,
            cost,
            returnedQty: 0,
          });

          if (product.trackStock) {
            const availableWithoutThisReservation = Number(before?.qtyOnHand ?? 0) - Number(before?.qtyReserved ?? 0) + (reservedByProduct.get(product.id) ?? 0);
            if (quantity / 1000 > availableWithoutThisReservation) {
              throw new AppError(409, 'INSUFFICIENT_STOCK', `${product.name} no longer has enough available stock`);
            }
            const posting = issueStock(position, quantity);
            const lineId = newId();
            const totalCost = posting.totalCost;
            movements.push({
              id: lineId,
              tenantId: ctx.tenantId,
              branchId: ctx.device!.branchId,
              occurredAt: date,
              sourceType: 'sale',
              sourceId: id,
              sourceLineId: null,
              productId: product.id,
              batchId: null,
              movementType: 'sale',
              qtyBase: -quantity,
              unitCost: posting.unitCost.toFixed(4),
              totalCost: -totalCost,
              balanceAfter: posting.position.qtyOnHand,
              reasonCode: 'sale',
              memo: no,
              createdBy: ctx.userId,
            });
            balanceUpdates.push({
              productId: product.id,
              qtyOnHand: posting.position.qtyOnHand,
              qtyReserved: Math.max(0, Number(before?.qtyReserved ?? 0) - (reservedByProduct.get(product.id) ?? 0)),
              avgCost: posting.position.avgCost,
              stockValue: stockValue(posting.position),
            });
            changeRecords.push(
              { entityType: 'inventory_movement', entityId: lineId, op: 'upsert', branchId: ctx.device!.branchId },
              { entityType: 'inventory_balance', entityId: `${ctx.device!.branchId}:${product.id}`, op: 'upsert', branchId: ctx.device!.branchId },
            );
          }

          await tdb.insert(saleItems, {
            id: newId(),
            tenantId: ctx.tenantId,
            saleId: id,
            lineNo: index + 1,
            productId: product.id,
            name: product.name,
            unit: unitNames.get(product.baseUnitId) ?? 'Piece',
            qty: quantity,
            price: appliedPrice,
            discount: appliedDiscount,
            cost,
            returnedQty: 0,
          });
        }

        const deliveryFee = gharOrder?.deliveryFee ?? pricing?.deliveryCharge ?? input.deliveryFee ?? 0;
        const total = subtotal - automaticDiscount - input.discount + deliveryFee;
        if (total < 0) throw new AppError(400, 'INVALID_DISCOUNT', 'Bill discount exceeds the subtotal');
        const payments = input.payments.filter((payment) => payment.amount > 0);
        if (payments.some((payment) => !PAYMENT_ACCOUNT_IDS.has(payment.accountId))) {
          throw new AppError(400, 'INVALID_PAYMENT_ACCOUNT', 'Choose a supported payment account');
        }
        const tendered = payments.reduce((sum, payment) => sum + payment.amount, 0);
        const cashTendered = payments.filter((payment) => payment.accountId === 'acc-cash').reduce((sum, payment) => sum + payment.amount, 0);
        const nonCashTendered = tendered - cashTendered;
        if (nonCashTendered > total) throw new AppError(400, 'INVALID_PAYMENT', 'Non-cash payments cannot exceed the bill');
        const change = Math.max(0, tendered - total);
        if (change > cashTendered) throw new AppError(400, 'INVALID_PAYMENT', 'Change can only be returned from cash');
        const credit = Math.max(0, total - tendered);
        let customer: typeof customers.$inferSelect | undefined;
        if (credit > 0) {
          if (!input.customerId) throw new AppError(400, 'CUSTOMER_REQUIRED', 'Select a customer for udhaar');
          if (!ctx.permissions.has('sales.credit')) throw new AppError(403, 'PERMISSION_DENIED', 'You do not have permission to make credit sales');
          customer = (await tdb.db.select().from(customers).where(tdb.active(customers, eq(customers.id, input.customerId))).for('update'))[0];
          if (!customer) throw new AppError(400, 'CUSTOMER_NOT_FOUND', 'Customer not found or inactive');
          const ledger = await tdb.select(customerLedgerEntries, eq(customerLedgerEntries.customerId, customer.id));
          const balance = ledger.reduce((sum, entry) => sum + entry.amount, 0);
          if (customer.creditLimit > 0 && balance + credit > customer.creditLimit && !ctx.permissions.has('customers.set_credit_limit')) {
            throw new AppError(403, 'CREDIT_LIMIT_EXCEEDED', 'This sale would exceed the customer credit limit');
          }
        }

        await tdb.insert(sales, {
          id,
          tenantId: ctx.tenantId,
          branchId: ctx.device!.branchId,
          occurredAt: date,
          receivedAt: date,
          no,
          customerId: input.customerId ?? null,
          gharOrderId: gharOrder?.id ?? null,
          subtotal,
          discount: input.discount,
          deliveryFee,
          deliveryAddress: gharOrder?.address || (input.homeDelivery ? input.deliveryAddress?.trim() : null) || null,
          pricingMode: gharOrder ? 'normal' : input.pricingMode,
          paymentMethod: credit > 0 ? 'credit' : input.paymentMethod,
          total,
          paid: total - credit,
          change,
          credit,
          payments,
          status: 'completed',
          returnedTotal: 0,
          note: input.note ?? null,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
          originDeviceId: ctx.device!.id,
        });

        if (credit > 0) {
          await tdb.insert(customerLedgerEntries, {
            id: newId(),
            tenantId: ctx.tenantId,
            branchId: ctx.device!.branchId,
            occurredAt: date,
            receivedAt: date,
            customerId: customer!.id,
            saleId: id,
            amount: credit,
            type: 'sale',
            note: no,
            createdBy: ctx.userId,
            updatedBy: ctx.userId,
          });
        }

        if (gharOrder) {
          await tdb.update(gharOrders, { saleId: id, status: 'delivered', updatedAt: date, updatedBy: ctx.userId }, eq(gharOrders.id, gharOrder.id));
        }

        if (movements.length > 0) await tdb.db.insert(inventoryMovements).values(movements);
        for (const balance of balanceUpdates) {
          await tdb.db
            .insert(inventoryBalances)
            .values({
              tenantId: ctx.tenantId,
              branchId: ctx.device!.branchId,
              productId: balance.productId,
              qtyOnHand: balance.qtyOnHand,
              qtyReserved: balance.qtyReserved,
              avgCost: balance.avgCost.toFixed(4),
              stockValue: balance.stockValue,
              lastMovementAt: date,
              lastSaleAt: date,
            })
            .onDuplicateKeyUpdate({
              set: {
                qtyOnHand: balance.qtyOnHand,
                qtyReserved: balance.qtyReserved,
                avgCost: balance.avgCost.toFixed(4),
                stockValue: balance.stockValue,
                lastMovementAt: date,
                lastSaleAt: date,
              },
            });
        }
        if (reservation) {
          await tdb.update(inventoryReservations, { status: 'completed', updatedAt: date }, eq(inventoryReservations.reservationId, reservation.reservationId));
        }
        await recordChanges(tdb.db, ctx.tenantId, changeRecords);

        return {
          id,
          no,
          date: date.toISOString(),
          ...(input.customerId ? { customerId: input.customerId } : {}),
          ...(gharOrder ? { gharOrderId: gharOrder.id } : {}),
          items: lines.map((line) => ({ ...line, cost: ctx.permissions.has('products.view_cost') ? line.cost : 0 })),
          subtotal,
          discount: input.discount,
          deliveryFee,
          ...(gharOrder?.address || (input.homeDelivery ? input.deliveryAddress?.trim() : undefined) ? { deliveryAddress: gharOrder?.address || input.deliveryAddress?.trim() } : {}),
          pricingMode: gharOrder ? 'normal' : input.pricingMode,
          paymentMethod: credit > 0 ? 'credit' : input.paymentMethod,
          total,
          paid: total - credit,
          change,
          credit,
          payments,
          userId: ctx.userId,
          status: 'completed' as const,
          returnedTotal: 0,
          ...(input.note ? { note: input.note } : {}),
        };
      });

      return sale;
    },
  );
};

function formatSale(sale: typeof sales.$inferSelect, rows: (typeof saleItems.$inferSelect)[], showCost: boolean): SaleView {
  return {
    id: sale.id,
    no: sale.no,
    date: sale.occurredAt.toISOString(),
    ...(sale.customerId ? { customerId: sale.customerId } : {}),
    ...(sale.gharOrderId ? { gharOrderId: sale.gharOrderId } : {}),
    ...(sale.deliveryAddress ? { deliveryAddress: sale.deliveryAddress } : {}),
    pricingMode: sale.pricingMode as 'normal' | 'business',
    paymentMethod: sale.paymentMethod as 'cash' | 'credit',
    items: rows.map((row) => ({
      productId: row.productId,
      name: row.name,
      unit: row.unit,
      qty: row.qty / 1000,
      price: row.price,
      discount: row.discount,
      cost: showCost ? row.cost : 0,
      returnedQty: row.returnedQty / 1000,
    })),
    subtotal: sale.subtotal,
    discount: sale.discount,
    deliveryFee: sale.deliveryFee,
    total: sale.total,
    paid: sale.paid,
    change: sale.change,
    credit: sale.credit,
    payments: sale.payments,
    userId: sale.createdBy ?? '',
    status: sale.status as 'completed' | 'void',
    returnedTotal: sale.returnedTotal,
    ...(sale.note ? { note: sale.note } : {}),
  };
}