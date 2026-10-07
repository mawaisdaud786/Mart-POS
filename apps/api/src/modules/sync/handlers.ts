import {
  BrandFields,
  CategoryFields,
  ProductBarcodeFields,
  ProductFields,
  ProductUnitFields,
  StockAdjustmentCreate,
  type PullableEntity,
  type PushableEntity,
} from '@retailos/contracts';
import { newId, postStockAdjustment, type Permission, type StockPosition } from '@retailos/domain';
import { schema, type ChangeRecord, type TenantDb, type TenantTable } from '@retailos/db';
import { and, eq, gte, inArray, isNull, or } from 'drizzle-orm';
import type { MySqlColumn } from 'drizzle-orm/mysql-core';
import type { z } from 'zod';
import type { RequestContext } from '../../lib/context.js';
import { toWire } from './serialize.js';

const {
  branches,
  brands,
  categories,
  inventoryBalances,
  inventoryMovements,
  priceHistory,
  productBarcodes,
  productUnits,
  products,
  settings,
  stockAdjustmentItems,
  stockAdjustments,
  syncConflicts,
  tenantProfiles,
  units,
  auditLogs,
  ZERO_UUID,
} = schema;

export class RejectError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export type ApplyResult =
  | { status: 'applied'; version?: number; changes: ChangeRecord[] }
  | { status: 'conflict'; conflictId: string; serverVersion: number; fields: string[] };

export interface EntityHandler {
  entity: PullableEntity;
  /** Current state of rows by id, for pull. Missing ids are simply absent. */
  load(tdb: TenantDb, ids: string[]): Promise<Map<string, Record<string, unknown>>>;
  /** Full current state for the device's branch, for snapshot. */
  loadAll?(tdb: TenantDb, branchId: string): Promise<Record<string, unknown>[]>;
  create?(tdb: TenantDb, ctx: RequestContext, id: string, data: Record<string, unknown>): Promise<ApplyResult>;
  update?(
    tdb: TenantDb,
    ctx: RequestContext,
    id: string,
    baseVersion: number,
    changes: Record<string, unknown>,
    mutationId: string,
  ): Promise<ApplyResult>;
  remove?(tdb: TenantDb, ctx: RequestContext, id: string, baseVersion: number, mutationId: string): Promise<ApplyResult>;
}

type SyncTable = TenantTable & {
  id: MySqlColumn;
  version: MySqlColumn;
  deletedAt: MySqlColumn;
  updatedAt: MySqlColumn;
};

function requirePermission(ctx: RequestContext, permission: Permission): void {
  if (!ctx.permissions.has(permission)) {
    throw new RejectError('PERMISSION_DENIED', `Permission required: ${permission}`);
  }
}

function parseOrReject<T extends z.ZodType>(schemaDef: T, data: unknown): z.infer<T> {
  const parsed = schemaDef.safeParse(data);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    throw new RejectError('VALIDATION_FAILED', detail);
  }
  return parsed.data;
}

async function loadByIds(tdb: TenantDb, table: SyncTable, ids: string[]) {
  if (ids.length === 0) return new Map<string, Record<string, unknown>>();
  const rows = (await tdb.select(table, inArray(table.id, ids))) as Record<string, unknown>[];
  return new Map(rows.map((r) => [r.id as string, toWire(r)]));
}

interface MasterOptions {
  entity: PushableEntity & PullableEntity;
  table: SyncTable & { fieldVersions?: MySqlColumn };
  fields: z.ZodObject;
  permissions: { create: Permission; update: Permission; delete: Permission };
  /** Extra permission needed when any of these fields change. */
  guardedFields?: { fields: readonly string[]; permission: Permission };
  hasFieldVersions: boolean;
  afterUpdate?: (tdb: TenantDb, ctx: RequestContext, before: Record<string, unknown>, after: Record<string, unknown>) => Promise<void>;
}

/**
 * Generic handler for mutable master data (categories, brands, products, units, barcodes).
 * Updates use optimistic concurrency with a per-field merge (docs/phase-1/02 §4).
 */
function masterEntity(opts: MasterOptions): EntityHandler {
  const { table } = opts;
  const partial = opts.fields.partial();

  async function lockRow(tdb: TenantDb, id: string) {
    const rows = (await tdb.db
      .select()
      .from(table)
      .where(tdb.scope(table, eq(table.id, id)))
      .for('update')) as Record<string, unknown>[];
    return rows[0];
  }

  async function recordConflict(
    tdb: TenantDb,
    mutationId: string,
    id: string,
    baseVersion: number,
    row: Record<string, unknown>,
    changes: Record<string, unknown>,
    fields: string[],
  ): Promise<ApplyResult> {
    const conflictId = newId();
    await tdb.insert(syncConflicts, {
      id: conflictId,
      tenantId: tdb.tenantId,
      mutationId,
      entityType: opts.entity,
      entityId: id,
      baseVersion,
      serverVersion: row.version as number,
      clientChanges: changes,
      serverState: toWire(row),
    });
    return { status: 'conflict', conflictId, serverVersion: row.version as number, fields };
  }

  return {
    entity: opts.entity,
    load: (tdb, ids) => loadByIds(tdb, table, ids),
    loadAll: async (tdb) =>
      ((await tdb.select(table, isNull(table.deletedAt))) as Record<string, unknown>[]).map(toWire),

    async create(tdb, ctx, id, data) {
      requirePermission(ctx, opts.permissions.create);
      const fields = parseOrReject(opts.fields, data) as Record<string, unknown>;
      const existing = await lockRow(tdb, id);
      if (existing) return { status: 'applied', version: existing.version as number, changes: [] };
      await tdb.insert(table, {
        ...fields,
        id,
        tenantId: tdb.tenantId,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
        originDeviceId: ctx.device?.id ?? null,
        version: 1,
        ...(opts.hasFieldVersions ? { fieldVersions: {} } : {}),
      } as never);
      return { status: 'applied', version: 1, changes: [{ entityType: opts.entity, entityId: id, op: 'upsert', version: 1 }] };
    },

    async update(tdb, ctx, id, baseVersion, rawChanges, mutationId) {
      requirePermission(ctx, opts.permissions.update);
      const changes = parseOrReject(partial, rawChanges) as Record<string, unknown>;
      const keys = Object.keys(rawChanges).filter((k) => k in changes);
      if (keys.length === 0) throw new RejectError('VALIDATION_FAILED', 'No known fields to update');
      if (opts.guardedFields && keys.some((k) => opts.guardedFields!.fields.includes(k))) {
        requirePermission(ctx, opts.guardedFields.permission);
      }
      const row = await lockRow(tdb, id);
      if (!row || row.deletedAt) throw new RejectError('NOT_FOUND', `${opts.entity} not found`);
      const version = row.version as number;
      const fieldVersions = (row.fieldVersions as Record<string, number> | null) ?? {};

      const conflicting = opts.hasFieldVersions
        ? keys.filter((k) => (fieldVersions[k] ?? 1) > baseVersion && row[k] !== changes[k])
        : version !== baseVersion
          ? keys
          : [];
      if (conflicting.length > 0) return recordConflict(tdb, mutationId, id, baseVersion, row, rawChanges, conflicting);

      const newVersion = version + 1;
      const set: Record<string, unknown> = { ...changes, version: newVersion, updatedBy: ctx.userId, updatedAt: new Date() };
      if (opts.hasFieldVersions) {
        set.fieldVersions = { ...fieldVersions, ...Object.fromEntries(keys.map((k) => [k, newVersion])) };
      }
      await tdb.update(table, set as never, eq(table.id, id));
      if (opts.afterUpdate) await opts.afterUpdate(tdb, ctx, row, { ...row, ...changes });
      return { status: 'applied', version: newVersion, changes: [{ entityType: opts.entity, entityId: id, op: 'upsert', version: newVersion }] };
    },

    async remove(tdb, ctx, id, baseVersion, mutationId) {
      requirePermission(ctx, opts.permissions.delete);
      const row = await lockRow(tdb, id);
      if (!row || row.deletedAt) return { status: 'applied', changes: [] };
      if ((row.version as number) !== baseVersion) {
        return recordConflict(tdb, mutationId, id, baseVersion, row, { deleted: true }, ['deletedAt']);
      }
      const newVersion = (row.version as number) + 1;
      await tdb.update(table, { deletedAt: new Date(), version: newVersion, updatedBy: ctx.userId, updatedAt: new Date() } as never, eq(table.id, id));
      return { status: 'applied', version: newVersion, changes: [{ entityType: opts.entity, entityId: id, op: 'delete', version: newVersion }] };
    },
  };
}

const PRICE_FIELDS = ['salePrice', 'thresholdPrice', 'wholesalePrice', 'minSalePrice'] as const;
const PRICE_HISTORY_FIELD: Record<(typeof PRICE_FIELDS)[number], string> = {
  salePrice: 'sale',
  thresholdPrice: 'threshold',
  wholesalePrice: 'wholesale',
  minSalePrice: 'min_sale',
};

async function recordPriceChanges(
  tdb: TenantDb,
  ctx: RequestContext,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Promise<void> {
  for (const field of PRICE_FIELDS) {
    if (before[field] === after[field]) continue;
    await tdb.insert(priceHistory, {
      id: newId(),
      tenantId: tdb.tenantId,
      productId: before.id as string,
      field: PRICE_HISTORY_FIELD[field],
      oldValue: (before[field] as number | null) ?? null,
      newValue: (after[field] as number | null) ?? null,
      changedBy: ctx.userId,
    });
    await tdb.insert(auditLogs, {
      tenantId: tdb.tenantId,
      userId: ctx.userId,
      deviceId: ctx.device?.id ?? null,
      action: 'product.price_changed',
      entityType: 'product',
      entityId: before.id as string,
      before: { [field]: before[field] },
      after: { [field]: after[field] },
    });
  }
}

/** Stock adjustments (including opening stock): immutable documents posted to the stock ledger. */
const stockAdjustmentHandler: EntityHandler = {
  entity: 'stock_adjustment',
  async load(tdb, ids) {
    if (ids.length === 0) return new Map();
    const docs = await tdb.select(stockAdjustments, inArray(stockAdjustments.id, ids));
    const items = await tdb.select(stockAdjustmentItems, inArray(stockAdjustmentItems.adjustmentId, ids));
    return new Map(
      docs.map((d) => [
        d.id,
        { ...toWire(d), items: items.filter((i) => i.adjustmentId === d.id).map((i) => toWire(i)) },
      ]),
    );
  },

  async create(tdb, ctx, id, data) {
    requirePermission(ctx, 'inventory.adjust');
    const doc = parseOrReject(StockAdjustmentCreate, { ...data, id });
    if (!ctx.device) throw new RejectError('DEVICE_REQUIRED', 'Stock can only be adjusted from a registered device');
    // A device only posts to its own branch.
    if (doc.branchId !== ctx.device.branchId) throw new RejectError('WRONG_BRANCH', 'Device is registered to another branch');
    const existing = await tdb.select(stockAdjustments, eq(stockAdjustments.id, id));
    if (existing[0]) return { status: 'applied', changes: [] };

    const productIds = [...new Set(doc.items.map((i) => i.productId))];
    const found = await tdb.select(products, and(inArray(products.id, productIds), isNull(products.deletedAt)));
    if (found.length !== productIds.length) throw new RejectError('INVALID_REFERENCE', 'Unknown product in adjustment');

    // Lock current balances so concurrent postings for the same products serialise.
    const balanceRows = await tdb.db
      .select()
      .from(inventoryBalances)
      .where(tdb.scope(inventoryBalances, eq(inventoryBalances.branchId, doc.branchId), inArray(inventoryBalances.productId, productIds)))
      .for('update');
    const positions = new Map<string, StockPosition>(
      balanceRows.map((b) => [b.productId, { qtyOnHand: b.qtyOnHand, avgCost: Number(b.avgCost) }]),
    );

    const posting = postStockAdjustment(
      { id, branchId: doc.branchId, occurredAt: doc.occurredAt, reason: doc.reason, createdBy: ctx.userId, items: doc.items },
      positions,
    );

    const occurredAt = new Date(doc.occurredAt);
    await tdb.insert(stockAdjustments, {
      id,
      tenantId: tdb.tenantId,
      branchId: doc.branchId,
      occurredAt,
      receivedAt: new Date(),
      reason: doc.reason,
      memo: doc.memo ?? null,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
      originDeviceId: ctx.device.id,
    });
    await tdb.insert(
      stockAdjustmentItems,
      doc.items.map((i) => ({
        id: newId(),
        tenantId: tdb.tenantId,
        adjustmentId: id,
        lineNo: i.lineNo,
        productId: i.productId,
        productUnitId: i.productUnitId ?? null,
        qty: i.qty,
        qtyBase: i.qtyBase,
        unitCost: i.unitCost ?? null,
        memo: i.memo ?? null,
      })),
    );
    if (posting.movements.length > 0) {
      await tdb.insert(
        inventoryMovements,
        posting.movements.map((m) => ({
          id: m.id,
          tenantId: tdb.tenantId,
          branchId: m.branchId,
          occurredAt,
          sourceType: m.sourceType,
          sourceId: m.sourceId,
          sourceLineId: m.sourceLineId,
          productId: m.productId,
          movementType: m.movementType,
          qtyBase: m.qtyBase,
          unitCost: m.unitCost.toFixed(4),
          totalCost: m.totalCost,
          balanceAfter: m.balanceAfter,
          reasonCode: m.reasonCode,
          createdBy: m.createdBy,
        })),
      );
    }
    for (const b of posting.balances) {
      await tdb.db
        .insert(inventoryBalances)
        .values({
          tenantId: tdb.tenantId,
          branchId: b.branchId,
          productId: b.productId,
          qtyOnHand: b.position.qtyOnHand,
          avgCost: b.position.avgCost.toFixed(4),
          stockValue: b.stockValue,
          lastMovementAt: occurredAt,
        })
        .onDuplicateKeyUpdate({
          set: {
            qtyOnHand: b.position.qtyOnHand,
            avgCost: b.position.avgCost.toFixed(4),
            stockValue: b.stockValue,
            lastMovementAt: occurredAt,
          },
        });
    }

    return {
      status: 'applied',
      changes: [
        { entityType: 'stock_adjustment', entityId: id, op: 'upsert', branchId: doc.branchId },
        ...posting.movements.map((m) => ({ entityType: 'inventory_movement', entityId: m.id, op: 'upsert' as const, branchId: m.branchId })),
        ...posting.balances.map((b) => ({
          entityType: 'inventory_balance',
          entityId: `${b.branchId}:${b.productId}`,
          op: 'upsert' as const,
          branchId: b.branchId,
        })),
      ],
    };
  },
};

const inventoryBalanceHandler: EntityHandler = {
  entity: 'inventory_balance',
  async load(tdb, ids) {
    const pairs = ids.map((id) => id.split(':') as [string, string]);
    if (pairs.length === 0) return new Map();
    const rows = await tdb.select(
      inventoryBalances,
      or(...pairs.map(([b, p]) => and(eq(inventoryBalances.branchId, b), eq(inventoryBalances.productId, p)))),
    );
    return new Map(rows.map((r) => [`${r.branchId}:${r.productId}`, { id: `${r.branchId}:${r.productId}`, ...toWire(r) }]));
  },
  async loadAll(tdb, branchId) {
    const rows = await tdb.select(inventoryBalances, eq(inventoryBalances.branchId, branchId));
    return rows.map((r) => ({ id: `${r.branchId}:${r.productId}`, ...toWire(r) }));
  },
};

const inventoryMovementHandler: EntityHandler = {
  entity: 'inventory_movement',
  async load(tdb, ids) {
    if (ids.length === 0) return new Map();
    const rows = await tdb.select(inventoryMovements, inArray(inventoryMovements.id, ids));
    return new Map(rows.map((r) => [r.id, toWire(r)]));
  },
  async loadAll(tdb, branchId) {
    const since = new Date(Date.now() - 90 * 86_400_000);
    const rows = await tdb.select(inventoryMovements, and(eq(inventoryMovements.branchId, branchId), gte(inventoryMovements.occurredAt, since)));
    return rows.map((r) => toWire(r));
  },
};

const branchHandler: EntityHandler = {
  entity: 'branch',
  load: (tdb, ids) => loadByIds(tdb, branches as SyncTable, ids),
  loadAll: async (tdb) => (await tdb.select(branches, isNull(branches.deletedAt))).map((r) => toWire(r)),
};

const settingHandler: EntityHandler = {
  entity: 'setting',
  async load(tdb, ids) {
    if (ids.length === 0) return new Map();
    const rows = await tdb.select(settings, and(eq(settings.scopeBranchId, ZERO_UUID), inArray(settings.key, ids)));
    return new Map(rows.map((r) => [r.key, { id: r.key, key: r.key, value: r.value, version: r.version }]));
  },
  async loadAll(tdb) {
    const rows = await tdb.select(settings, eq(settings.scopeBranchId, ZERO_UUID));
    return rows.map((r) => ({ id: r.key, key: r.key, value: r.value, version: r.version }));
  },
};

const tenantProfileHandler: EntityHandler = {
  entity: 'tenant_profile',
  async load(tdb) {
    const row = (await tdb.select(tenantProfiles))[0];
    return new Map(row ? [[tdb.tenantId, { id: tdb.tenantId, ...toWire(row) }]] : []);
  },
  async loadAll(tdb) {
    const row = (await tdb.select(tenantProfiles))[0];
    return row ? [{ id: tdb.tenantId, ...toWire(row) }] : [];
  },
};

const unitHandler: EntityHandler = {
  entity: 'unit',
  async load(tdb, ids) {
    if (ids.length === 0) return new Map();
    const rows = await tdb.db.select().from(units).where(and(inArray(units.id, ids), or(isNull(units.tenantId), eq(units.tenantId, tdb.tenantId))));
    return new Map(rows.map((r) => [r.id, toWire(r)]));
  },
  async loadAll(tdb) {
    // System units (tenant_id NULL) plus this tenant's own units.
    const rows = await tdb.db.select().from(units).where(or(isNull(units.tenantId), eq(units.tenantId, tdb.tenantId)));
    return rows.map((r) => ({ ...toWire(r), tenantId: r.tenantId }));
  },
};

export const HANDLERS: Record<PullableEntity, EntityHandler> = {
  category: masterEntity({
    entity: 'category',
    table: categories,
    fields: CategoryFields,
    permissions: { create: 'products.create', update: 'products.edit', delete: 'products.delete' },
    hasFieldVersions: false,
  }),
  brand: masterEntity({
    entity: 'brand',
    table: brands,
    fields: BrandFields,
    permissions: { create: 'products.create', update: 'products.edit', delete: 'products.delete' },
    hasFieldVersions: false,
  }),
  product: masterEntity({
    entity: 'product',
    table: products,
    fields: ProductFields,
    permissions: { create: 'products.create', update: 'products.edit', delete: 'products.delete' },
    guardedFields: { fields: PRICE_FIELDS, permission: 'products.edit_price' },
    hasFieldVersions: true,
    afterUpdate: recordPriceChanges,
  }),
  product_unit: masterEntity({
    entity: 'product_unit',
    table: productUnits,
    fields: ProductUnitFields,
    permissions: { create: 'products.edit', update: 'products.edit', delete: 'products.edit' },
    guardedFields: { fields: ['salePrice', 'wholesalePrice'], permission: 'products.edit_price' },
    hasFieldVersions: false,
  }),
  product_barcode: masterEntity({
    entity: 'product_barcode',
    table: productBarcodes,
    fields: ProductBarcodeFields,
    permissions: { create: 'products.edit', update: 'products.edit', delete: 'products.edit' },
    hasFieldVersions: false,
  }),
  stock_adjustment: stockAdjustmentHandler,
  inventory_balance: inventoryBalanceHandler,
  inventory_movement: inventoryMovementHandler,
  branch: branchHandler,
  setting: settingHandler,
  tenant_profile: tenantProfileHandler,
  unit: unitHandler,
};

/** Entities included in a device snapshot, in the order a device should apply them. */
export const SNAPSHOT_ORDER: PullableEntity[] = [
  'tenant_profile',
  'branch',
  'setting',
  'unit',
  'category',
  'brand',
  'product',
  'product_unit',
  'product_barcode',
  'inventory_balance',
];

