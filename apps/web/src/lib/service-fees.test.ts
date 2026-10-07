import { describe, expect, it } from 'vitest';
import { defaultServiceFee } from './service-fees';

describe('default retailer service fees', () => {
  it.each([
    [0, 0],
    [1, 1_000],
    [100_000, 1_000],
    [100_001, 2_000],
    [200_000, 2_000],
    [200_001, 3_000],
  ])('charges the cash-in rate by started Rs 1,000 for %i paisa', (amount, expectedFee) => {
    expect(defaultServiceFee('cash_in', amount)).toBe(expectedFee);
  });

  it.each([
    [0, 0],
    [1, 1_000],
    [50_000, 1_000],
    [50_001, 2_000],
    [100_000, 2_000],
    [100_001, 3_000],
  ])('charges the cash-out rate by started Rs 500 for %i paisa', (amount, expectedFee) => {
    expect(defaultServiceFee('cash_out', amount)).toBe(expectedFee);
  });

  it('does not apply cash-in or cash-out defaults to other services', () => {
    expect(defaultServiceFee('send_money', 100_000)).toBe(0);
  });

  it('uses configurable amount steps for both fee schedules', () => {
    expect(defaultServiceFee('cash_in', 250_000, 500, 1_000, 50_000, 25_000)).toBe(2_500);
    expect(defaultServiceFee('cash_out', 125_000, 500, 1_000, 50_000, 25_000)).toBe(5_000);
  });
});
