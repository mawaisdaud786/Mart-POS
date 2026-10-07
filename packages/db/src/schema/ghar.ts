import { sql } from 'drizzle-orm';
import { check, foreignKey, index, json, mysqlTable, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { docColumns, money, uuid } from './columns.js';
import { customers } from './customers.js';
import { branches } from './identity.js';
import { sales } from './sales.js';

export interface GharOrderLine {
  productId: string;
  name: string;
  unit: string;
  qty: number;
  price: number;
  regularPrice: number;
  cost: number;
}

export const gharOrders = mysqlTable(
  'ghar_orders',
  {
    ...docColumns(),
    no: varchar('no', { length: 40 }).notNull(),
    customerId: uuid('customer_id').notNull(),
    saleId: uuid('sale_id'),
    customerName: varchar('customer_name', { length: 160 }).notNull(),
    phone: varchar('phone', { length: 32 }),
    address: varchar('address', { length: 1000 }).notNull(),
    items: json('items').$type<GharOrderLine[]>().notNull(),
    subtotal: money('subtotal').notNull(),
    deliveryFee: money('delivery_fee').notNull(),
    total: money('total').notNull(),
    status: varchar('status', { length: 24 }).notNull().default('invoice_draft'),
    note: varchar('note', { length: 1000 }),
  },
  (t) => [
    index('ghar_orders_date_idx').on(t.tenantId, t.branchId, t.occurredAt),
    index('ghar_orders_customer_idx').on(t.tenantId, t.customerId, t.occurredAt),
    index('ghar_orders_status_idx').on(t.tenantId, t.status),
    uniqueIndex('ghar_orders_sale_uq').on(t.tenantId, t.saleId),
    foreignKey({ name: 'fk_ghar_orders_branch', columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }),
    foreignKey({ name: 'fk_ghar_orders_customer', columns: [t.tenantId, t.customerId], foreignColumns: [customers.tenantId, customers.id] }),
    foreignKey({ name: 'fk_ghar_orders_sale', columns: [t.tenantId, t.saleId], foreignColumns: [sales.tenantId, sales.id] }),
    check('ghar_orders_status_ck', sql`${t.status} in ('invoice_draft','invoice_sent','confirmed','packing','out_for_delivery','delivered','cancelled')`),
  ],
);