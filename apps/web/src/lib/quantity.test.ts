import { describe, expect, it } from 'vitest';
import { quantityForAmount } from './quantity';

describe('quantityForAmount', () => {
  it('converts a rupee budget using the active per-unit rate', () => {
    expect(quantityForAmount(10_000, 10_000)).toBe(1);
  });

  it('rounds down to 0.001 units so the requested amount is never exceeded', () => {
    const quantity = quantityForAmount(10_000, 30_000);
    expect(quantity).toBe(0.333);
    expect(Math.round(quantity * 30_000)).toBeLessThanOrEqual(10_000);
  });

  it('returns zero for invalid budgets, invalid rates, or budgets too small for quantity precision', () => {
    expect(quantityForAmount(0, 10_000)).toBe(0);
    expect(quantityForAmount(10_000, 0)).toBe(0);
    expect(quantityForAmount(1, 10_000)).toBe(0);
  });
});
