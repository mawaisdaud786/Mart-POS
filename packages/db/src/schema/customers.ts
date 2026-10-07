import { sql } from 'drizzle-orm';
import { check, foreignKey, index, mysqlTable, text, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { docColumns, money, ts, uuid } from './columns.js';
import { sales } from './sales.js';

export const customers = mysqlTable(
  'customers',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    name: varchar('name', { length: 160 }).notNull(),
    phone: varchar('phone', { length: 32 }),
    address: text('address'),
    creditLimit: money('credit_limit').notNull().default(0),
    createdAt: ts('created_at').notNull(),
    createdBy: uuid('created_by'),
    updatedAt: ts('updated_at').notNull(),
    updatedBy: uuid('updated_by'),
    deletedAt: ts('deleted_at'),
  },
  (t) => [
    uniqueIndex('customers_tenant_id_uq').on(t.tenantId, t.id),
    index('customers_name_idx').on(t.tenantId, t.name),
    index('customers_phone_idx').on(t.tenantId, t.phone),
    check('customers_credit_limit_ck', sql`${t.creditLimit} >= 0`),
  ],
);

export const customerLedgerEntries = mysqlTable(
  'customer_ledger_entries',
  {
    ...docColumns(),
    customerId: uuid('customer_id').notNull(),
    saleId: uuid('sale_id'),
    amount: money('amount').notNull(),
    type: varchar('type', { length: 20 }).notNull(),
    accountId: varchar('account_id', { length: 64 }),
    note: varchar('note', { length: 500 }),
  },
  (t) => [
    index('customer_ledger_customer_idx').on(t.tenantId, t.customerId, t.occurredAt),
    uniqueIndex('customer_ledger_sale_uq').on(t.tenantId, t.saleId),
    foreignKey({ name: 'fk_customer_ledger_customer', columns: [t.tenantId, t.customerId], foreignColumns: [customers.tenantId, customers.id] }),
    foreignKey({ name: 'fk_customer_ledger_sale', columns: [t.tenantId, t.saleId], foreignColumns: [sales.tenantId, sales.id] }),
    check('customer_ledger_type_ck', sql`${t.type} in ('sale','payment','adjustment')`),
  ],
);