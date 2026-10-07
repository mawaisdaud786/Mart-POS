export interface ShopAdvisorInput {
  urgentRestockCount: number;
  belowCostCount: number;
  slowMovingCount: number;
  slowMovingDays: number;
  overstockCount: number;
  overstockDays: number;
  weeklySalesGrowthPct: number | null;
  lowMarginCount: number;
  minimumMarginPct: number;
}

export interface ShopRecommendation {
  id: string;
  priority: 'high' | 'medium' | 'positive';
  title: string;
  evidence: string;
  nextStep: string;
  to: string;
}

const PRIORITY: Record<ShopRecommendation['priority'], number> = {
  high: 0,
  medium: 1,
  positive: 2,
};

export function buildShopRecommendations(input: ShopAdvisorInput): ShopRecommendation[] {
  const recommendations: ShopRecommendation[] = [];
  const add = (recommendation: ShopRecommendation) => recommendations.push(recommendation);

  if (input.urgentRestockCount > 0) {
    add({
      id: 'restock',
      priority: 'high',
      title: 'Prepare the next restock',
      evidence: `${input.urgentRestockCount} products are forecast to run low before the next supplier delivery.`,
      nextStep: 'Review the suggested quantities and confirm an order with the supplier.',
      to: '/inventory?focus=order-now',
    });
  }
  if (input.belowCostCount > 0) {
    add({
      id: 'below-cost',
      priority: 'high',
      title: 'Check cost and selling price',
      evidence: `${input.belowCostCount} products sold in the last 30 days are currently priced below average cost.`,
      nextStep: 'Verify recent purchase costs and review selling prices; no price is changed automatically.',
      to: '/products?focus=below-cost',
    });
  }
  if (input.slowMovingCount > 0) {
    add({
      id: 'slow-moving',
      priority: 'medium',
      title: 'Review stock with no recent sales',
      evidence: `${input.slowMovingCount} stocked products have no sale recorded in the last ${input.slowMovingDays} days.`,
      nextStep: 'Check shelf counts and recent demand before placing another order.',
      to: '/inventory?focus=slow',
    });
  }
  if (input.overstockCount > 0) {
    add({
      id: 'overstock',
      priority: 'medium',
      title: 'Check upcoming purchases for excess stock',
      evidence: `${input.overstockCount} products hold more than ${input.overstockDays} days of estimated demand.`,
      nextStep: 'Review these quantities before the next purchase; the suggestion does not alter stock.',
      to: '/inventory?focus=overstock',
    });
  }
  if (input.lowMarginCount > 0) {
    add({
      id: 'low-margin',
      priority: 'medium',
      title: 'Review low-margin products',
      evidence: `${input.lowMarginCount} products are below the configured ${input.minimumMarginPct}% minimum margin.`,
      nextStep: 'Review costs and prices before deciding whether to make a change.',
      to: '/products?focus=low-margin',
    });
  }
  if (input.weeklySalesGrowthPct !== null && input.weeklySalesGrowthPct < 0) {
    add({
      id: 'sales-decline',
      priority: 'medium',
      title: 'Investigate the weekly sales decline',
      evidence: `Sales are down ${Math.abs(input.weeklySalesGrowthPct).toFixed(0)}% versus the previous week.`,
      nextStep: 'Compare daily sales and product performance to find where the change came from.',
      to: '/reports?focus=sales-decline',
    });
  } else if (input.weeklySalesGrowthPct !== null && input.weeklySalesGrowthPct > 0) {
    add({
      id: 'sales-growth',
      priority: 'positive',
      title: 'Sales are above last week',
      evidence: `Sales are up ${input.weeklySalesGrowthPct.toFixed(0)}% versus the previous week.`,
      nextStep: 'Keep an eye on stock levels for the products driving this increase.',
      to: '/reports?focus=sales-growth',
    });
  }

  return recommendations.sort((a, b) => PRIORITY[a.priority] - PRIORITY[b.priority]);
}
