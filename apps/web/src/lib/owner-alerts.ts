export type OwnerAlertSeverity = 'urgent' | 'attention' | 'positive';

export interface OwnerAlert {
  id: string;
  severity: OwnerAlertSeverity;
  title: string;
  detail: string;
  to: string;
}

export interface OwnerAlertInput {
  orderNow: number;
  reorderSoon: number;
  slowMoving: number;
  slowMovingDays: number;
  overstock: number;
  overstockDays: number;
  negativeStock: number;
  customersOverLimit: number;
  supplierPayables: number;
  cashDifference: number | null;
  cashDifferenceLimit: number;
  cashClosingMissing: boolean;
  weeklySalesGrowth: number | null;
  belowCost: number;
  lowMargin: number;
  minimumMarginPct: number;
}

const SEVERITY_ORDER: Record<OwnerAlertSeverity, number> = {
  urgent: 0,
  attention: 1,
  positive: 2,
};

export function buildOwnerAlerts(input: OwnerAlertInput): OwnerAlert[] {
  const alerts: OwnerAlert[] = [];
  const add = (alert: OwnerAlert) => alerts.push(alert);

  if (input.cashDifference !== null && Math.abs(input.cashDifference) >= input.cashDifferenceLimit) {
    add({
      id: 'cash-difference',
      severity: 'urgent',
      title: 'Cash difference needs review',
      detail: `Cash difference of Rs ${input.cashDifference.toLocaleString()} at today's closing.`,
      to: '/cash?focus=difference',
    });
  }
  if (input.negativeStock > 0) {
    add({
      id: 'negative-stock',
      severity: 'urgent',
      title: 'Check negative stock',
      detail: `${input.negativeStock} products show negative stock.`,
      to: '/inventory?focus=negative-stock',
    });
  }
  if (input.orderNow > 0) {
    add({
      id: 'stock-order-now',
      severity: 'urgent',
      title: 'Products may run out soon',
      detail: `${input.orderNow} products need ordering now based on stock and recent sales.`,
      to: '/inventory?focus=order-now',
    });
  }
  if (input.belowCost > 0) {
    add({
      id: 'products-below-cost',
      severity: 'urgent',
      title: 'Review products priced below cost',
      detail: `${input.belowCost} products have a sale price below current average cost.`,
      to: '/products?focus=below-cost',
    });
  }
  if (input.reorderSoon > 0) {
    add({
      id: 'stock-reorder-soon',
      severity: 'attention',
      title: 'Plan upcoming restocks',
      detail: `${input.reorderSoon} products are below their reorder point.`,
      to: '/inventory?focus=reorder-soon',
    });
  }
  if (input.slowMoving > 0) {
    add({
      id: 'slow-moving-stock',
      severity: 'attention',
      title: 'Review slow-moving stock',
      detail: `${input.slowMoving} stocked products have had no sale for ${input.slowMovingDays}+ days.`,
      to: '/inventory?focus=slow',
    });
  }
  if (input.overstock > 0) {
    add({
      id: 'overstock',
      severity: 'attention',
      title: 'Review excess stock',
      detail: `${input.overstock} products hold more than ${input.overstockDays} days of estimated demand.`,
      to: '/inventory?focus=overstock',
    });
  }
  if (input.customersOverLimit > 0) {
    add({
      id: 'customer-credit-limit',
      severity: 'attention',
      title: 'Customer credit limits exceeded',
      detail: `${input.customersOverLimit} customers are over their credit limit.`,
      to: '/customers?focus=over-limit',
    });
  }
  if (input.supplierPayables > 0) {
    add({
      id: 'supplier-payables',
      severity: 'attention',
      title: 'Supplier balances are due',
      detail: `You owe suppliers Rs ${input.supplierPayables.toLocaleString()} in total.`,
      to: '/suppliers?focus=payables',
    });
  }
  if (input.cashClosingMissing) {
    add({
      id: 'cash-closing',
      severity: 'attention',
      title: 'Complete today’s cash closing',
      detail: 'Daily cash closing has not been recorded yet.',
      to: '/cash?focus=closing',
    });
  }
  if (input.lowMargin > 0) {
    add({
      id: 'low-margin',
      severity: 'attention',
      title: 'Review low-margin products',
      detail: `${input.lowMargin} products are below your ${input.minimumMarginPct}% minimum margin.`,
      to: '/products?focus=low-margin',
    });
  }
  if (input.weeklySalesGrowth !== null && input.weeklySalesGrowth > 0) {
    add({
      id: 'sales-growth',
      severity: 'positive',
      title: 'Sales are growing',
      detail: `Sales are up ${input.weeklySalesGrowth.toFixed(0)}% this week versus last week.`,
      to: '/reports?focus=sales-growth',
    });
  }

  return alerts.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
