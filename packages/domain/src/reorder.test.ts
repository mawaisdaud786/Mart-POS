import { describe, expect, it } from 'vitest';
import { computeReorder, dayKeyOf, dayNumberFromKey, dayNumberOf, stockValueOf, weekdayOf } from './reorder.js';
import type { Product, Supplier } from './shop-types.js';

const product = (over: Partial<Product>): Product => ({ id: 'p', name: 'P', stock: 10, minStock: 0, cost: 100, price: 150, active: true, ...over }) as Product;

describe('shop calendar days', () => {
  it('weekday of 1970-01-01 is Thursday, and day keys round-trip', () => {
    expect(weekdayOf(0)).toBe(4);
    expect(weekdayOf(dayNumberFromKey('2026-10-05'))).toBe(1); // Monday
    expect(dayKeyOf(dayNumberFromKey('2026-02-28') + 1)).toBe('2026-03-01');
  });

  it('the shop day depends on the shop time zone, not the server', () => {
    const instant = Date.UTC(2026, 9, 4, 20, 0); // 20:00 UTC on the 4th = 01:00 on the 5th in Pakistan (UTC+5)
    expect(dayKeyOf(dayNumberOf(instant, -300))).toBe('2026-10-05');
    expect(dayKeyOf(dayNumberOf(instant, 0))).toBe('2026-10-04');
    expect(dayKeyOf(dayNumberOf(instant, 300))).toBe('2026-10-04'); // UTC-5
  });
});

describe('stock value', () => {
  it('counts active products with stock, rounding each product half up', () => {
    expect(stockValueOf([{ stock: 1.5, cost: 101, active: true }])).toBe(152); // 151.5 -> 152
    expect(stockValueOf([{ stock: 5, cost: 10, active: false }, { stock: -2, cost: 10, active: true }, { stock: 0, cost: 10, active: true }])).toBe(0);
  });
});

describe('reorder planning', () => {
  const today = dayNumberFromKey('2026-10-05'); // Monday

  it('an empty shelf is always "order now", with at least one unit', () => {
    const [row] = computeReorder({ products: [product({ stock: 0 })], suppliers: [], sold: new Map(), today, defaultLeadDays: 2 });
    expect(row!.status).toBe('order_now');
    expect(row!.suggestedQty).toBeGreaterThanOrEqual(1);
    expect(row!.reorderBy).toBe('2026-10-05');
  });

  it('inactive products are left out and unsold, unlimited products need nothing', () => {
    const rows = computeReorder({ products: [product({ id: 'a', active: false }), product({ id: 'b' })], suppliers: [], sold: new Map(), today, defaultLeadDays: 2 });
    expect(rows.map((r) => r.product.id)).toEqual(['b']);
    expect(rows[0]!.status).toBe('no_sales');
    expect(rows[0]!.suggestedQty).toBe(0);
  });

  it('does not include billable services or other untracked items in reorder planning', () => {
    const rows = computeReorder({
      products: [product({ id: 'service', isService: true }), product({ id: 'untracked', trackStock: false }), product({ id: 'stocked' })],
      suppliers: [],
      sold: new Map(),
      today,
      defaultLeadDays: 2,
    });
    expect(rows.map((row) => row.product.id)).toEqual(['stocked']);
  });

  it('rounds the quantity up to whole cartons', () => {
    const [row] = computeReorder({ products: [product({ stock: 1, packSize: 12 })], suppliers: [], sold: new Map([['p', 60]]), today, defaultLeadDays: 2 });
    expect(row!.status).toBe('order_now');
    expect(row!.suggestedQty % 12).toBe(0);
    expect(row!.suggestedPacks).toBe(row!.suggestedQty / 12);
  });

  it('uses configured velocity, safety, low-stock, and cover days', () => {
    const [row] = computeReorder({
      products: [product({ stock: 2 })],
      suppliers: [],
      sold: new Map([['p', 60]]),
      today,
      defaultLeadDays: 2,
      salesVelocityDays: 60,
      safetyStockDays: 4,
      lowStockDaysThreshold: 3,
      coverDays: 10,
    });
    expect(row!.avgDaily).toBe(1);
    expect(row!.reorderPoint).toBe(6);
    expect(row!.status).toBe('order_now');
    expect(row!.suggestedQty).toBe(14);
  });

  it('plans for the supplier’s weekly order day', () => {
    const suppliers = [{ id: 's', name: 'S', leadDays: 2, orderDay: 5 } as Supplier]; // Friday
    const [row] = computeReorder({ products: [product({ stock: 10, supplierId: 's' })], suppliers, sold: new Map([['p', 30]]), today, defaultLeadDays: 3 });
    expect(row!.reorderBy).toBe('2026-10-09');
    expect(row!.deliveryOn).toBe('2026-10-11');
  });
});
