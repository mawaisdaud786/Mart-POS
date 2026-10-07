import { index, json, mysqlTable, primaryKey, varchar } from 'drizzle-orm/mysql-core';
import { nowMs, ts, uuid } from './columns.js';

/**
 * The shop's working records (products, sales, ledgers, settings …). One row per record: the whole record
 * is the JSON `data`, and k1/k2/k3 are short lookup keys filled from it (see `KEYS` in @retailos/contracts)
 * so date ranges, "this product" and "this customer" are index lookups. Every row belongs to one tenant and
 * is only reached through TenantDb, so one shop can never read another shop's records.
 */
export const shopRecords = mysqlTable(
  'shop_records',
  {
    tenantId: uuid('tenant_id').notNull(),
    collection: varchar('collection', { length: 24 }).notNull(),
    id: varchar('id', { length: 64 }).notNull(),
    k1: varchar('k1', { length: 80 }),
    k2: varchar('k2', { length: 80 }),
    k3: varchar('k3', { length: 80 }),
    k4: varchar('k4', { length: 80 }),
    data: json('data').notNull(),
    createdAt: ts('created_at').notNull().default(nowMs),
    updatedAt: ts('updated_at').notNull().default(nowMs),
    createdBy: uuid('created_by'),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.collection, t.id] }),
    index('shop_records_k1_idx').on(t.tenantId, t.collection, t.k1),
    index('shop_records_k2_idx').on(t.tenantId, t.collection, t.k2, t.k1),
    index('shop_records_k3_idx').on(t.tenantId, t.collection, t.k3, t.k1),
    index('shop_records_k4_idx').on(t.tenantId, t.collection, t.k4),
  ],
);
