import { describe, expect, it } from 'vitest';
import { costPerPurchaseUnit, costPerSaleUnit } from './purchase-cost';

describe('purchase-unit product cost', () => {
  it('shows a pack cost from the stored sale-unit average cost', () => {
    expect(costPerPurchaseUnit(1250, 24)).toBe(30000);
  });

  it('stores an entered pack cost as the rounded cost per sale unit', () => {
    expect(costPerSaleUnit(30000, 24)).toBe(1250);
  });

  it('uses the sale unit as the purchase unit when no pack conversion is set', () => {
    expect(costPerPurchaseUnit(1250)).toBe(1250);
    expect(costPerSaleUnit(1250)).toBe(1250);
  });
});
