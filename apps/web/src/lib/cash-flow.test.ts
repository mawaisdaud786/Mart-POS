import { describe, expect, it } from 'vitest';
import type { AccountTxn } from '@retailos/domain';
import { buildCashFlowInsights, previousDateRange, type CashFlowPeriod } from './cash-flow';

const period = (overrides: Partial<CashFlowPeriod> = {}): CashFlowPeriod => ({
  revenue: 100_000,
  grossProfit: 40_000,
  netProfit: 20_000,
  expenses: 10_000,
  expensesByCategory: { Rent: 6_000, Utilities: 4_000 },
  ...overrides,
});

describe('cash-flow intelligence calculations', () => {
  it('compares inclusive periods with an equally long preceding range', () => {
    expect(previousDateRange('2026-10-01', '2026-10-07')).toEqual(['2026-09-24', '2026-09-30']);
    expect(previousDateRange('2026-01-01', '2026-01-01')).toEqual(['2025-12-31', '2025-12-31']);
  });

  it('sums ledger inflows and outflows while excluding transfers and adjustments', () => {
    const txns = [
      { amount: 10_000, type: 'sale' },
      { amount: 3_000, type: 'customer_payment' },
      { amount: -5_000, type: 'purchase' },
      { amount: -2_000, type: 'expense' },
      { amount: 8_000, type: 'transfer' },
      { amount: -8_000, type: 'transfer' },
      { amount: -500, type: 'adjustment' },
    ] as AccountTxn[];
    const result = buildCashFlowInsights(
      period({ expenses: 13_000, expensesByCategory: { Rent: 6_000, Utilities: 7_000 } }),
      period({ expensesByCategory: { Rent: 5_000, Utilities: 2_000 } }),
      txns,
    );
    expect(result).toMatchObject({
      inflows: 13_000,
      outflows: 7_000,
      netAccountMovement: 6_000,
      expenseRatioPercent: 13,
      netProfitChange: 0,
      largestExpense: { category: 'Utilities', amount: 7_000, change: 5_000 },
      largestExpenseIncrease: { category: 'Utilities', change: 5_000 },
    });
  });

  it('does not invent expense ratios when net sales are zero', () => {
    const result = buildCashFlowInsights(period({ revenue: 0, expensesByCategory: {} }), period(), []);
    expect(result.expenseRatioPercent).toBeNull();
    expect(result.largestExpense).toBeNull();
    expect(result.largestExpenseIncrease).toBeNull();
  });
});
