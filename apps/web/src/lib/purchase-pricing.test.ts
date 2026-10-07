import { describe, expect, it } from 'vitest';
import { comparePurchasePrice, summarizePurchasePayments, suggestedSellingPrice } from './purchase-pricing';

describe('purchase price review', () => {
  it('reports price increase and percentage', () => {
    expect(comparePurchasePrice(30_000, 35_000)).toEqual({
      previous: 30_000,
      current: 35_000,
      difference: 5_000,
      percent: 16.666666666666668,
      direction: 'increase',
    });
  });

  it('reports decreases without a negative percentage', () => {
    expect(comparePurchasePrice(35_000, 30_000)).toMatchObject({ difference: -5_000, percent: 14.285714285714286, direction: 'decrease' });
  });

  it('keeps the prior absolute markup in a suggested selling price', () => {
    expect(suggestedSellingPrice(35_000, 30_000, 35_000)).toBe(40_000);
  });

  it('summarizes split payments and remaining supplier credit', () => {
    expect(summarizePurchasePayments(2_000_000, [1_000_000, 500_000])).toEqual({ paid: 1_500_000, credit: 500_000, overpayment: 0 });
    expect(summarizePurchasePayments(2_000_000, [1_000_000, 500_000, 500_000])).toEqual({ paid: 2_000_000, credit: 0, overpayment: 0 });
    expect(summarizePurchasePayments(2_000_000, [])).toEqual({ paid: 0, credit: 2_000_000, overpayment: 0 });
    expect(summarizePurchasePayments(2_000_000, [2_100_000])).toEqual({ paid: 2_100_000, credit: 0, overpayment: 100_000 });
  });
});