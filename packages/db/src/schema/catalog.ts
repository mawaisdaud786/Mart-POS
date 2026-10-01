import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  decimal,
  foreignKey,
  index,
  int,
  json,
  mysqlTable,
  text,
  tinyint,
  uniqueIndex,
  varchar,
  bigint,
} from 'drizzle-orm/mysql-core';
import { activeKeySql, money, nowMs, qty, syncColumns, ts, uuid } from './columns.js';
import { tenants } from './platform.js';

/** System units have tenant_id NULL; tenants may add their own. */
export const units = mysqlTable(
  'units',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id'),
    code: varchar('code', { length: 20 }).notNull(),
    name: varchar('name', { length: 60 }).notNull(),
    nameUr: varchar('name_ur', { length: 60 }),
    kind: varchar('kind', { length: 10 }).notNull(),
    baseCode: varchar('base_code', { length: 20 }),
    factorToBase: decimal('factor_to_base', { precision: 12, scale: 6 }),
    serverSeq: bigint('server_seq', { mode: 'number' }).notNull().default(0),
    createdAt: ts('created_at').notNull().default(nowMs),
  },
  (t) => [
    uniqueIndex('units_code_uq').on(t.tenantId, t.code),
    check('units_kind_ck', sql`${t.kind} in ('count','weight','volume','length')`),
  ],
);

export const categories = mysqlTable(
  'categories',
  {
    ...syncColumns(),
    parentId: uuid('parent_id'),
    name: varchar('name', { length: 120 }).notNull(),
    nameUr: varchar('name_ur', { length: 120 }),
    sort: int('sort').notNull().default(0),
    color: varchar('color', { length: 9 }),
    icon: varchar('icon', { length: 40 }),
  },
  (t) => [
    uniqueIndex('categories_tenant_id_uq').on(t.tenantId, t.id),
    index('categories_seq_idx').on(t.tenantId, t.serverSeq),
    foreignKey({ name: 'fk_categories_tenant', columns: [t.tenantId], foreignColumns: [tenants.id] }),
    foreignKey({
      name: 'fk_categories_parent',
      columns: [t.tenantId, t.parentId],
      foreignColumns: [t.tenantId, t.id],
    }),
  ],
);

export const brands = mysqlTable(
  'brands',
  {
    ...syncColumns(),
    name: varchar('name', { length: 120 }).notNull(),
    nameUr: varchar('name_ur', { length: 120 }),
    manufacturer: varchar('manufacturer', { length: 120 }),
  },
  (t) => [
    uniqueIndex('brands_tenant_id_uq').on(t.tenantId, t.id),
    index('brands_seq_idx').on(t.tenantId, t.serverSeq),
    foreignKey({ name: 'fk_brands_tenant', columns: [t.tenantId], foreignColumns: [tenants.id] }),
  ],
);

export const products = mysqlTable(
  'products',
  {
    ...syncColumns(),
    sku: varchar('sku', { length: 60 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    nameUr: varchar('name_ur', { length: 200 }),
    description: text('description'),
    categoryId: uuid('category_id'),
    brandId: uuid('brand_id'),
    /** FK to suppliers is added with the suppliers table in Phase 3. */
    defaultSupplierId: uuid('default_supplier_id'),
    baseUnitId: uuid('base_unit_id').notNull(),
    isWeighed: boolean('is_weighed').notNull().default(false),
    salePrice: money('sale_price').notNull().default(0),
    wholesalePrice: money('wholesale_price'),
    minSalePrice: money('min_sale_price'),
    taxRateId: uuid('tax_rate_id'),
    trackStock: boolean('track_stock').notNull().default(true),
    trackBatches: boolean('track_batches').notNull().default(false),
    trackExpiry: boolean('track_expiry').notNull().default(false),
    minStock: qty('min_stock'),
    safetyStock: qty('safety_stock'),
    leadTimeDays: int('lead_time_days'),
    reviewPeriodDays: int('review_period_days'),
    maxStock: qty('max_stock'),
    isFavorite: boolean('is_favorite').notNull().default(false),
    posSort: int('pos_sort').notNull().default(0),
    imageKey: varchar('image_key', { length: 255 }),
    notes: text('notes'),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    fieldVersions: json('field_versions'),
    activeKey: tinyint('active_key').generatedAlwaysAs(activeKeySql, { mode: 'stored' }),
  },
  (t) => [
    uniqueIndex('products_tenant_id_uq').on(t.tenantId, t.id),
    uniqueIndex('products_sku_uq').on(t.tenantId, t.sku, t.activeKey),
    index('products_category_idx').on(t.tenantId, t.categoryId),
    index('products_name_idx').on(t.tenantId, t.name),
    index('products_seq_idx').on(t.tenantId, t.serverSeq),
    foreignKey({ name: 'fk_products_tenant', columns: [t.tenantId], foreignColumns: [tenants.id] }),
    foreignKey({
      name: 'fk_products_category',
      columns: [t.tenantId, t.categoryId],
      foreignColumns: [categories.tenantId, categories.id],
    }),
    foreignKey({
      name: 'fk_products_brand',
      columns: [t.tenantId, t.brandId],
      foreignColumns: [brands.tenantId, brands.id],
    }),
    foreignKey({ name: 'fk_products_base_unit', columns: [t.baseUnitId], foreignColumns: [units.id] }),
    check('products_status_ck', sql`${t.status} in ('active','inactive')`),
    check('products_price_ck', sql`${t.salePrice} >= 0`),
  ],
);

export const productUnits = mysqlTable(
  'product_units',
  {
    ...syncColumns(),
    productId: uuid('product_id').notNull(),
    unitId: uuid('unit_id').notNull(),
    factorToBase: decimal('factor_to_base', { precision: 14, scale: 6 }).notNull(),
    salePrice: money('sale_price'),
    wholesalePrice: money('wholesale_price'),
    isDefaultSale: boolean('is_default_sale').notNull().default(false),
    isDefaultPurchase: boolean('is_default_purchase').notNull().default(false),
    activeKey: tinyint('active_key').generatedAlwaysAs(activeKeySql, { mode: 'stored' }),
  },
  (t) => [
    uniqueIndex('product_units_tenant_id_uq').on(t.tenantId, t.id),
    uniqueIndex('product_units_unit_uq').on(t.tenantId, t.productId, t.unitId, t.activeKey),
    index('product_units_seq_idx').on(t.tenantId, t.serverSeq),
    foreignKey({
      name: 'fk_product_units_product',
      columns: [t.tenantId, t.productId],
      foreignColumns: [products.tenantId, products.id],
    }),
    foreignKey({ name: 'fk_product_units_unit', columns: [t.unitId], foreignColumns: [units.id] }),
    check('product_units_factor_ck', sql`${t.factorToBase} > 0`),
  ],
);

export const productBarcodes = mysqlTable(
  'product_barcodes',
  {
    ...syncColumns(),
    productId: uuid('product_id').notNull(),
    productUnitId: uuid('product_unit_id'),
    barcode: varchar('barcode', { length: 64 }).notNull(),
    activeKey: tinyint('active_key').generatedAlwaysAs(activeKeySql, { mode: 'stored' }),
  },
  (t) => [
    uniqueIndex('product_barcodes_tenant_id_uq').on(t.tenantId, t.id),
    uniqueIndex('product_barcodes_barcode_uq').on(t.tenantId, t.barcode, t.activeKey),
    index('product_barcodes_seq_idx').on(t.tenantId, t.serverSeq),
    foreignKey({
      name: 'fk_product_barcodes_product',
      columns: [t.tenantId, t.productId],
      foreignColumns: [products.tenantId, products.id],
    }),
    foreignKey({
      name: 'fk_product_barcodes_unit',
      columns: [t.tenantId, t.productUnitId],
      foreignColumns: [productUnits.tenantId, productUnits.id],
    }),
  ],
);

export const priceHistory = mysqlTable(
  'price_history',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    productId: uuid('product_id').notNull(),
    productUnitId: uuid('product_unit_id'),
    field: varchar('field', { length: 20 }).notNull(),
    oldValue: money('old_value'),
    newValue: money('new_value'),
    changedBy: uuid('changed_by'),
    changedAt: ts('changed_at').notNull().default(nowMs),
    sourceType: varchar('source_type', { length: 40 }),
    sourceId: uuid('source_id'),
  },
  (t) => [
    index('price_history_product_idx').on(t.tenantId, t.productId, t.changedAt),
    foreignKey({
      name: 'fk_price_history_product',
      columns: [t.tenantId, t.productId],
      foreignColumns: [products.tenantId, products.id],
    }),
    check('price_history_field_ck', sql`${t.field} in ('sale','wholesale','min_sale','cost')`),
  ],
);
