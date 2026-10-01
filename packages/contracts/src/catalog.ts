import { z } from 'zod';
import { IsoDateTime, Name, NonNegativeMoney, OptionalText, Qty, Uuid } from './common.js';

/** Fields every synced record carries on the wire. */
export const SyncMeta = z.object({
  id: Uuid,
  version: z.number().int().positive(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  deletedAt: IsoDateTime.nullable(),
});

export const CategoryFields = z.object({
  parentId: Uuid.nullish(),
  name: Name,
  nameUr: OptionalText(120),
  sort: z.number().int().default(0),
  color: OptionalText(9),
  icon: OptionalText(40),
});
export const Category = SyncMeta.extend(CategoryFields.shape);
export type Category = z.infer<typeof Category>;

export const BrandFields = z.object({
  name: Name,
  nameUr: OptionalText(120),
  manufacturer: OptionalText(120),
});
export const Brand = SyncMeta.extend(BrandFields.shape);
export type Brand = z.infer<typeof Brand>;

export const ProductFields = z.object({
  sku: z.string().trim().min(1).max(60),
  name: Name,
  nameUr: OptionalText(200),
  description: OptionalText(2000),
  categoryId: Uuid.nullish(),
  brandId: Uuid.nullish(),
  defaultSupplierId: Uuid.nullish(),
  baseUnitId: Uuid,
  isWeighed: z.boolean().default(false),
  salePrice: NonNegativeMoney,
  wholesalePrice: NonNegativeMoney.nullish(),
  minSalePrice: NonNegativeMoney.nullish(),
  trackStock: z.boolean().default(true),
  trackBatches: z.boolean().default(false),
  trackExpiry: z.boolean().default(false),
  minStock: Qty.nonnegative().nullish(),
  safetyStock: Qty.nonnegative().nullish(),
  leadTimeDays: z.number().int().min(0).max(365).nullish(),
  reviewPeriodDays: z.number().int().min(1).max(365).nullish(),
  maxStock: Qty.nonnegative().nullish(),
  isFavorite: z.boolean().default(false),
  posSort: z.number().int().default(0),
  notes: OptionalText(2000),
  status: z.enum(['active', 'inactive']).default('active'),
});
export const Product = SyncMeta.extend(ProductFields.shape);
export type Product = z.infer<typeof Product>;

export const ProductUnitFields = z.object({
  productId: Uuid,
  unitId: Uuid,
  /** Base units per one of this unit (carton of 24 packets → 24). Sent as a decimal string. */
  factorToBase: z.string().regex(/^\d{1,8}(\.\d{1,6})?$/).refine((v) => Number(v) > 0, 'Must be greater than 0'),
  salePrice: NonNegativeMoney.nullish(),
  wholesalePrice: NonNegativeMoney.nullish(),
  isDefaultSale: z.boolean().default(false),
  isDefaultPurchase: z.boolean().default(false),
});
export const ProductUnit = SyncMeta.extend(ProductUnitFields.shape);
export type ProductUnit = z.infer<typeof ProductUnit>;

export const ProductBarcodeFields = z.object({
  productId: Uuid,
  productUnitId: Uuid.nullish(),
  barcode: z.string().trim().min(3).max(64),
});
export const ProductBarcode = SyncMeta.extend(ProductBarcodeFields.shape);
export type ProductBarcode = z.infer<typeof ProductBarcode>;

export const Unit = z.object({
  id: Uuid,
  tenantId: Uuid.nullable(),
  code: z.string(),
  name: z.string(),
  nameUr: z.string().nullable(),
  kind: z.enum(['count', 'weight', 'volume', 'length']),
  baseCode: z.string().nullable(),
  factorToBase: z.string().nullable(),
});
export type Unit = z.infer<typeof Unit>;

export const StockAdjustmentCreate = z.object({
  id: Uuid,
  branchId: Uuid,
  occurredAt: IsoDateTime,
  reason: z.enum(['damage', 'expiry', 'theft', 'correction', 'opening', 'other']),
  memo: OptionalText(1000),
  items: z
    .array(
      z.object({
        lineNo: z.number().int().positive(),
        productId: Uuid,
        productUnitId: Uuid.nullish(),
        qty: Qty,
        qtyBase: Qty.refine((q) => q !== 0, 'Quantity cannot be zero'),
        unitCost: NonNegativeMoney.nullish(),
        memo: OptionalText(255),
      }),
    )
    .min(1)
    .max(500),
});
export type StockAdjustmentCreate = z.infer<typeof StockAdjustmentCreate>;

export const InventoryBalance = z.object({
  branchId: Uuid,
  productId: Uuid,
  qtyOnHand: Qty,
  qtyReserved: Qty,
  avgCost: z.number(),
  stockValue: z.number().int(),
  lastMovementAt: IsoDateTime.nullable(),
});
export type InventoryBalance = z.infer<typeof InventoryBalance>;
