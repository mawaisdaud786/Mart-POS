import { sql } from 'drizzle-orm';
import { check, foreignKey, index, int, json, mysqlTable, text, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { docColumns, money, qty, uuid } from './columns.js';
import { products } from './catalog.js';
import { branches } from './identity.js';

export interface SalePaymentRecord {
  accountId: string;
  amount: number;
}

export const sales = mysqlTable(
  'sales',
  {
    ...docColumns(),
    no: varchar('no', { length: 40 }).notNull(),
    customerId: uuid('customer_id'),
    gharOrderId: uuid('ghar_order_id'),
    deliveryAddress: text('delivery_address'),
    pricingMode: varchar('pricing_mode', { length: 20 }).notNull().default('normal'),
    paymentMethod: varchar('payment_method', { length: 20 }).notNull().default('cash'),
    subtotal: money('subtotal').notNull(),
    discount: money('discount').notNull().default(0),
    deliveryFee: money('delivery_fee').notNull().default(0),
    total: money('total').notNull(),
    paid: money('paid').notNull(),
    change: money('change_amount').notNull().default(0),
    credit: money('credit').notNull().default(0),
    payments: json('payments').$type<SalePaymentRecord[]>().notNull(),
    status: varchar('status', { length: 20 }).notNull().default('completed'),
    returnedTotal: money('returned_total').notNull().default(0),
    note: text('note'),
  },
  (t) => [
    uniqueIndex('sales_tenant_id_uq').on(t.tenantId, t.id),
    uniqueIndex('sales_no_uq').on(t.tenantId, t.no),
    index('sales_date_idx').on(t.tenantId, t.branchId, t.occurredAt),
    foreignKey({ name: 'fk_sales_branch', columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }),
    check('sales_status_ck', sql`${t.status} in ('completed','void')`),
    check('sales_totals_ck', sql`${t.subtotal} >= 0 and ${t.discount} >= 0 and ${t.total} >= 0 and ${t.paid} >= 0 and ${t.credit} >= 0`),
  ],
);

export const saleItems = mysqlTable(
  'sale_items',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    saleId: uuid('sale_id').notNull(),
    lineNo: int('line_no').notNull(),
    productId: uuid('product_id').notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    unit: varchar('unit', { length: 60 }).notNull(),
    qty: qty('qty').notNull(),
    price: money('price').notNull(),
    discount: money('discount').notNull().default(0),
    cost: money('cost').notNull(),
    returnedQty: qty('returned_qty').notNull().default(0),
  },
  (t) => [
    uniqueIndex('sale_items_line_uq').on(t.tenantId, t.saleId, t.lineNo),
    index('sale_items_product_idx').on(t.tenantId, t.productId),
    foreignKey({ name: 'fk_sale_items_sale', columns: [t.tenantId, t.saleId], foreignColumns: [sales.tenantId, sales.id] }),
    foreignKey({ name: 'fk_sale_items_product', columns: [t.tenantId, t.productId], foreignColumns: [products.tenantId, products.id] }),
  ],
);