import type { Product, Supplier } from './shop-types.js';

/**
 * Smart low-stock check, shared by the server (which runs it) and the tests.
 *
 * Average daily sale comes from the last 30 days. Suppliers with a weekly order day are planned for
 * their next order day. Quantities cover sales until the next delivery plus one full ordering cycle,
 * with safety stock, rounded up to whole cartons.
 *
 * All dates are whole calendar days in the shop's own time zone, so the answer does not depend on the
 * server's clock zone: the caller says which local day it is today.
 */

export type ReorderStatus = 'order_now' | 'reorder_soon' | 'ok' | 'no_sales';

export interface ReorderRow {
  product: Product;
  avgDaily: number;
  daysLeft: number | null;
  reorderBy: string | null;
  deliveryOn: string | null;
  reorderPoint: number;
  suggestedQty: number;
  suggestedPacks: number | null;
  status: ReorderStatus;
  lastSaleDays?: number | null;
}

/** A calendar day as a whole number of days since 1970-01-01 (no time of day, so no clock-zone surprises). */
export type DayNumber = number;

const DAY_MS = 86_400_000;

/** Today's calendar day for a shop whose clock is `tzOffsetMinutes` behind UTC (JavaScript's getTimezoneOffset). */
export function dayNumberOf(instantMs: number, tzOffsetMinutes: number): DayNumber {
  return Math.floor((instantMs - tzOffsetMinutes * 60_000) / DAY_MS);
}

/** 0 = Sunday … 6 = Saturday. 1970-01-01 was a Thursday. */
export const weekdayOf = (day: DayNumber) => (((day + 4) % 7) + 7) % 7;

export function dayKeyOf(day: DayNumber): string {
  const d = new Date(day * DAY_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function dayNumberFromKey(key: string): DayNumber {
  const [y, m, d] = key.split('-').map(Number);
  return Math.round(Date.UTC(y!, m! - 1, d!) / DAY_MS);
}

export function computeReorder(input: {
  products: Product[];
  suppliers: Supplier[];
  /** Units sold per product over the last 30 days (sales plus returns, as a positive number). */
  sold: Map<string, number>;
  today: DayNumber;
  defaultLeadDays: number;
  coverDays?: number;
  salesVelocityDays?: number;
  safetyStockDays?: number;
  lowStockDaysThreshold?: number;
}): ReorderRow[] {
  const coverDays = input.coverDays ?? 7;
  const salesVelocityDays = input.salesVelocityDays ?? 30;
  const safetyStockDays = input.safetyStockDays ?? 2;
  const lowStockDaysThreshold = input.lowStockDaysThreshold ?? 3;
  const suppliers = new Map(input.suppliers.map((s) => [s.id, s]));
  const today = input.today;
  return input.products
    .filter((p) => p.active && !p.isService && p.trackStock !== false)
    .map((product) => {
      const avgDaily = Math.max(0, (input.sold.get(product.id) ?? 0) / salesVelocityDays);
      const supplier = product.supplierId ? suppliers.get(product.supplierId) : undefined;
      const lead = supplier?.leadDays ?? input.defaultLeadDays;
      const scheduledDate = supplier?.orderDay === undefined ? null : today + ((supplier.orderDay - weekdayOf(today) + 7) % 7);
      const daysUntilScheduled = scheduledDate === null ? 0 : scheduledDate - today;
      const safety = Math.max(product.minStock, avgDaily * safetyStockDays);
      const reorderPoint = avgDaily * (lead + daysUntilScheduled) + safety;
      const daysLeft = avgDaily > 0 ? product.stock / avgDaily : null;
      let status: ReorderStatus;
      if (product.stock <= 0) status = 'order_now';
      else if (avgDaily === 0 && product.minStock === 0) status = 'no_sales';
      else if (
        product.stock <= avgDaily * (lead + daysUntilScheduled) ||
        (product.minStock > 0 && product.stock <= product.minStock / 2) ||
        (daysLeft !== null && daysLeft <= lowStockDaysThreshold)
      ) status = 'order_now';
      else if (product.stock <= reorderPoint) status = 'reorder_soon';
      else status = 'ok';
      const orderRequired = status === 'order_now' || status === 'reorder_soon';
      const scheduledOrderIsTooLate =
        scheduledDate !== null &&
        (product.stock <= 0 ||
          (product.minStock > 0 && product.stock <= product.minStock / 2) ||
          (daysLeft !== null && daysLeft <= lowStockDaysThreshold) ||
          (avgDaily > 0 && product.stock <= avgDaily * (daysUntilScheduled + lead)));
      const orderOn = scheduledDate !== null ? (scheduledOrderIsTooLate ? today : scheduledDate) : null;
      const daysUntilOrder = orderOn === null ? 0 : orderOn - today;
      const target = avgDaily * (daysUntilOrder + lead + coverDays) + safety;
      let suggestedQty =
        scheduledDate !== null ? Math.max(product.stock <= 0 ? 1 : 0, Math.ceil(target - product.stock)) : orderRequired ? Math.max(1, Math.ceil(target - product.stock)) : 0;
      let suggestedPacks: number | null = null;
      if (suggestedQty > 0 && product.packSize && product.packSize > 1) {
        suggestedPacks = Math.ceil(suggestedQty / product.packSize);
        suggestedQty = suggestedPacks * product.packSize;
      }
      const daysUntilReorder = avgDaily > 0 ? Math.max(0, Math.ceil((product.stock - reorderPoint) / avgDaily)) : null;
      const reorderDay: DayNumber | null = orderOn ?? (orderRequired ? today : daysUntilReorder === null ? null : today + daysUntilReorder);
      const reorderBy = scheduledDate !== null && suggestedQty === 0 ? null : reorderDay !== null ? dayKeyOf(reorderDay) : null;
      const deliveryOn = reorderBy ? dayKeyOf(dayNumberFromKey(reorderBy) + lead) : null;
      return {
        product,
        avgDaily,
        daysLeft,
        reorderBy,
        deliveryOn,
        reorderPoint,
        suggestedQty,
        suggestedPacks: suggestedQty > 0 ? suggestedPacks : null,
        status,
      };
    });
}

/** Total stock value at cost (active products with stock on the shelf), rounded per product to whole paisa. */
export function stockValueOf(products: Pick<Product, 'stock' | 'cost' | 'active'>[]): number {
  return products.reduce((sum, p) => sum + (p.active && p.stock > 0 ? Math.round(p.cost * p.stock) : 0), 0);
}
