import { describe, expect, it } from 'vitest';
import { buildShopRecommendations, type ShopAdvisorInput } from './shop-advisor';

const base: ShopAdvisorInput = {
  urgentRestockCount: 0,
  belowCostCount: 0,
  slowMovingCount: 0,
  slowMovingDays: 30,
  overstockCount: 0,
  overstockDays: 60,
  weeklySalesGrowthPct: null,
  lowMarginCount: 0,
  minimumMarginPct: 5,
};

describe('shop advisor recommendations', () => {
  it('prioritizes stock and price risks and gives evidence-based next steps', () => {
    const recommendations = buildShopRecommendations({
      ...base,
      urgentRestockCount: 2,
      belowCostCount: 1,
      overstockCount: 3,
      weeklySalesGrowthPct: -12.6,
    });

    expect(recommendations.map((item) => item.id)).toEqual(['restock', 'below-cost', 'overstock', 'sales-decline']);
    expect(recommendations[0]).toMatchObject({
      evidence: '2 products are forecast to run low before the next supplier delivery.',
      to: '/inventory?focus=order-now',
    });
    expect(recommendations[1]!.nextStep).toContain('no price is changed automatically');
  });

  it('only reports measured issues and honors configured thresholds', () => {
    const recommendations = buildShopRecommendations({
      ...base,
      slowMovingCount: 3,
      slowMovingDays: 45,
      lowMarginCount: 2,
      minimumMarginPct: 8,
      weeklySalesGrowthPct: null,
    });
    expect(recommendations.map((item) => item.evidence)).toEqual([
      '3 stocked products have no sale recorded in the last 45 days.',
      '2 products are below the configured 8% minimum margin.',
    ]);
  });

  it('returns no advice without evidence and labels positive sales movement', () => {
    expect(buildShopRecommendations(base)).toEqual([]);
    expect(buildShopRecommendations({ ...base, weeklySalesGrowthPct: 10 }).map((item) => item.id)).toEqual(['sales-growth']);
    expect(buildShopRecommendations({ ...base, weeklySalesGrowthPct: 10 })[0]?.to).toBe('/reports?focus=sales-growth');
    expect(buildShopRecommendations({ ...base, weeklySalesGrowthPct: -10 })[0]?.to).toBe('/reports?focus=sales-decline');
  });

  it('opens focused product lists for cost and margin recommendations', () => {
    const recommendations = buildShopRecommendations({
      ...base,
      urgentRestockCount: 1,
      slowMovingCount: 1,
      overstockCount: 1,
      belowCostCount: 1,
      lowMarginCount: 2,
    });
    expect(recommendations.find((item) => item.id === 'restock')?.to).toBe('/inventory?focus=order-now');
    expect(recommendations.find((item) => item.id === 'below-cost')?.to).toBe('/products?focus=below-cost');
    expect(recommendations.find((item) => item.id === 'low-margin')?.to).toBe('/products?focus=low-margin');
    expect(recommendations.find((item) => item.id === 'slow-moving')?.to).toBe('/inventory?focus=slow');
    expect(recommendations.find((item) => item.id === 'overstock')?.to).toBe('/inventory?focus=overstock');
  });
});
