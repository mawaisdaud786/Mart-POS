import { describe, expect, it } from 'vitest';
import { buildOwnerAlerts, type OwnerAlertInput } from './owner-alerts';

const base: OwnerAlertInput = {
  orderNow: 0,
  reorderSoon: 0,
  slowMoving: 0,
  slowMovingDays: 30,
  overstock: 0,
  overstockDays: 60,
  negativeStock: 0,
  customersOverLimit: 0,
  supplierPayables: 0,
  cashDifference: null,
  cashDifferenceLimit: 50_000,
  cashClosingMissing: false,
  weeklySalesGrowth: null,
  belowCost: 0,
  lowMargin: 0,
  minimumMarginPct: 5,
};

describe('prioritized owner alerts', () => {
  it('orders urgent risks before attention and positive signals', () => {
    const alerts = buildOwnerAlerts({
      ...base,
      weeklySalesGrowth: 12.4,
      reorderSoon: 2,
      belowCost: 1,
      orderNow: 3,
      negativeStock: 1,
    });

    expect(alerts.map(({ id, severity }) => [id, severity])).toEqual([
      ['negative-stock', 'urgent'],
      ['stock-order-now', 'urgent'],
      ['products-below-cost', 'urgent'],
      ['stock-reorder-soon', 'attention'],
      ['sales-growth', 'positive'],
    ]);
  });

  it('omits alerts when measured conditions do not cross their thresholds', () => {
    const alerts = buildOwnerAlerts({ ...base, cashDifference: 49_999, weeklySalesGrowth: 0 });
    expect(alerts).toEqual([]);
  });

  it('includes measured values and configured thresholds in alert detail', () => {
    const alerts = buildOwnerAlerts({
      ...base,
      cashDifference: -50_000,
      slowMoving: 4,
      customersOverLimit: 2,
      minimumMarginPct: 8,
      lowMargin: 3,
    });

    expect(alerts.map((alert) => alert.detail)).toEqual([
      "Cash difference of Rs -50,000 at today's closing.",
      '4 stocked products have had no sale for 30+ days.',
      '2 customers are over their credit limit.',
      '3 products are below your 8% minimum margin.',
    ]);
  });

  it('routes each alert to its corresponding focused workflow', () => {
    const alerts = buildOwnerAlerts({
      ...base,
      cashDifference: 50_000,
      negativeStock: 1,
      orderNow: 1,
      belowCost: 1,
      reorderSoon: 1,
      slowMoving: 1,
      overstock: 1,
      customersOverLimit: 1,
      supplierPayables: 1,
      cashClosingMissing: true,
      lowMargin: 1,
      weeklySalesGrowth: 10,
    });
    expect(Object.fromEntries(alerts.map(({ id, to }) => [id, to]))).toMatchObject({
      'cash-difference': '/cash?focus=difference',
      'negative-stock': '/inventory?focus=negative-stock',
      'stock-order-now': '/inventory?focus=order-now',
      'products-below-cost': '/products?focus=below-cost',
      'stock-reorder-soon': '/inventory?focus=reorder-soon',
      'slow-moving-stock': '/inventory?focus=slow',
      overstock: '/inventory?focus=overstock',
      'customer-credit-limit': '/customers?focus=over-limit',
      'supplier-payables': '/suppliers?focus=payables',
      'cash-closing': '/cash?focus=closing',
      'low-margin': '/products?focus=low-margin',
      'sales-growth': '/reports?focus=sales-growth',
    });
  });
});
