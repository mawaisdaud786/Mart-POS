import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  decimal,
  foreignKey,
  index,
  int,
  json,
  mysqlTable,
  primaryKey,
  uniqueIndex,
  varchar,
  text,
} from 'drizzle-orm/mysql-core';
import { docColumns, money, nowMs, qty, ts, uuid } from './columns.js';
import { productUnits, products } from './catalog.js';
import { branches, devices } from './identity.js';

/** Stock-on-hand projection per branch. Rebuilt from inventory_movements; never edited by hand. */
export const inventoryBalances = mysqlTable(
  'inventory_balances',
  {
    tenantId: uuid('tenant_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    productId: uuid('product_id').notNull(),
    qtyOnHand: qty('qty_on_hand').notNull().default(0),
    qtyReserved: qty('qty_reserved').notNull().default(0),
    /** Weighted average cost per base unit, in paisa (fractional to avoid drift). */
    avgCost: decimal('avg_cost', { precision: 18, scale: 4 }).notNull().default('0'),
    stockValue: money('stock_value').notNull().default(0),
    lastMovementAt: ts('last_movement_at'),
    lastSaleAt: ts('last_sale_at'),
    lastReceiptAt: ts('last_receipt_at'),
    serverSeq: bigint('server_seq', { mode: 'number' }).notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.branchId, t.productId] }),
    index('inventory_balances_seq_idx').on(t.tenantId, t.serverSeq),
    foreignKey({
      name: 'fk_inventory_balances_product',
      columns: [t.tenantId, t.productId],
      foreignColumns: [products.tenantId, products.id],
    }),
    foreignKey({
      name: 'fk_inventory_balances_branch',
      columns: [t.tenantId, t.branchId],
      foreignColumns: [branches.tenantId, branches.id],
    }),
  ],
);

export interface InventoryReservationLine {
  productId: string;
  qty: number;
}

export const inventoryReservations = mysqlTable(
  'inventory_reservations',
  {
    tenantId: uuid('tenant_id').notNull(),
    reservationId: uuid('reservation_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    deviceId: uuid('device_id').notNull(),
    userId: uuid('user_id').notNull(),
    lines: json('lines').$type<InventoryReservationLine[]>().notNull(),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    expiresAt: ts('expires_at').notNull(),
    createdAt: ts('created_at').notNull().default(nowMs),
    updatedAt: ts('updated_at').notNull().default(nowMs),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.reservationId] }),
    index('inventory_reservations_expiry_idx').on(t.tenantId, t.branchId, t.status, t.expiresAt),
    index('inventory_reservations_device_idx').on(t.tenantId, t.deviceId, t.status),
    foreignKey({ name: 'fk_inventory_reservations_branch', columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }),
    foreignKey({ name: 'fk_inventory_reservations_device', columns: [t.tenantId, t.deviceId], foreignColumns: [devices.tenantId, devices.id] }),
    check('inventory_reservations_status_ck', sql`${t.status} in ('active','expired','released','completed')`),
  ],
);

export const MOVEMENT_TYPES = [
  'opening',
  'purchase',
  'sale',
  'sale_return',
  'purchase_return',
  'adjustment_in',
  'adjustment_out',
  'damage',
  'expiry',
  'transfer_in',
  'transfer_out',
  'count_correction',
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

/** Append-only stock ledger. Every stock change has a movement with a reason and a source document. */
export const inventoryMovements = mysqlTable(
  'inventory_movements',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    occurredAt: ts('occurred_at').notNull(),
    sourceType: varchar('source_type', { length: 40 }).notNull(),
    sourceId: uuid('source_id').notNull(),
    sourceLineId: uuid('source_line_id'),
    productId: uuid('product_id').notNull(),
    batchId: uuid('batch_id'),
    movementType: varchar('movement_type', { length: 20 }).notNull(),
    qtyBase: qty('qty_base').notNull(),
    unitCost: decimal('unit_cost', { precision: 18, scale: 4 }).notNull(),
    totalCost: money('total_cost').notNull(),
    balanceAfter: qty('balance_after'),
    reasonCode: varchar('reason_code', { length: 40 }),
    memo: varchar('memo', { length: 255 }),
    createdBy: uuid('created_by'),
    createdAt: ts('created_at').notNull().default(nowMs),
    serverSeq: bigint('server_seq', { mode: 'number' }).notNull().default(0),
  },
  (t) => [
    index('inventory_movements_product_idx').on(t.tenantId, t.branchId, t.productId, t.occurredAt),
    index('inventory_movements_source_idx').on(t.tenantId, t.sourceType, t.sourceId),
    index('inventory_movements_seq_idx').on(t.tenantId, t.serverSeq),
    foreignKey({
      name: 'fk_inventory_movements_product',
      columns: [t.tenantId, t.productId],
      foreignColumns: [products.tenantId, products.id],
    }),
    check(
      'inventory_movements_type_ck',
      sql.raw(`movement_type in (${MOVEMENT_TYPES.map((m) => `'${m}'`).join(',')})`),
    ),
  ],
);

export const stockAdjustments = mysqlTable(
  'stock_adjustments',
  {
    ...docColumns(),
    reason: varchar('reason', { length: 20 }).notNull(),
    memo: text('memo'),
    status: varchar('status', { length: 20 }).notNull().default('completed'),
    approvedBy: uuid('approved_by'),
  },
  (t) => [
    uniqueIndex('stock_adjustments_tenant_id_uq').on(t.tenantId, t.id),
    index('stock_adjustments_seq_idx').on(t.tenantId, t.serverSeq),
    index('stock_adjustments_date_idx').on(t.tenantId, t.branchId, t.occurredAt),
    foreignKey({
      name: 'fk_stock_adjustments_branch',
      columns: [t.tenantId, t.branchId],
      foreignColumns: [branches.tenantId, branches.id],
    }),
    check(
      'stock_adjustments_reason_ck',
      sql`${t.reason} in ('damage','expiry','theft','correction','opening','other')`,
    ),
    check('stock_adjustments_status_ck', sql`${t.status} in ('completed','voided')`),
  ],
);

export const stockAdjustmentItems = mysqlTable(
  'stock_adjustment_items',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    adjustmentId: uuid('adjustment_id').notNull(),
    lineNo: int('line_no').notNull(),
    productId: uuid('product_id').notNull(),
    batchId: uuid('batch_id'),
    productUnitId: uuid('product_unit_id'),
    qty: qty('qty').notNull(),
    /** Signed quantity in the base unit: + adds stock, − removes it. */
    qtyBase: qty('qty_base').notNull(),
    /** Cost per base unit for stock added (opening stock); ignored for removals (WAC is used). */
    unitCost: money('unit_cost'),
    memo: varchar('memo', { length: 255 }),
  },
  (t) => [
    uniqueIndex('stock_adjustment_items_line_uq').on(t.tenantId, t.adjustmentId, t.lineNo),
    foreignKey({
      name: 'fk_stock_adjustment_items_adjustment',
      columns: [t.tenantId, t.adjustmentId],
      foreignColumns: [stockAdjustments.tenantId, stockAdjustments.id],
    }),
    foreignKey({
      name: 'fk_stock_adjustment_items_product',
      columns: [t.tenantId, t.productId],
      foreignColumns: [products.tenantId, products.id],
    }),
    foreignKey({
      name: 'fk_stock_adjustment_items_unit',
      columns: [t.tenantId, t.productUnitId],
      foreignColumns: [productUnits.tenantId, productUnits.id],
    }),
  ],
);
