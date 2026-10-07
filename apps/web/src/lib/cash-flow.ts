import type { AccountTxn } from '@retailos/domain';

export interface CashFlowPeriod {
  revenue: number;
  grossProfit: number;
  netProfit: number;
  expenses: number;
  expensesByCategory: Record<string, number>;
}

export interface CashFlowInsights {
  inflows: number;
  outflows: number;
  netAccountMovement: number;
  expenseRatioPercent: number | null;
  netProfitChange: number;
  largestExpense: { category: string; amount: number; change: number } | null;
  largestExpenseIncrease: { category: string; change: number } | null;
}

const NON_OPERATING_TYPES = new Set<AccountTxn['type']>(['transfer', 'opening', 'adjustment']);

export function previousDateRange(from: string, to: string): [string, string] {
  const ordinal = (key: string) => {
    const [year, month, day] = key.split('-').map(Number);
    return Math.floor(Date.UTC(year!, month! - 1, day!) / 86_400_000);
  };
  const fromDay = ordinal(from);
  const span = ordinal(to) - fromDay + 1;
  const previousEnd = fromDay - 1;
  const previousStart = previousEnd - span + 1;
  const key = (day: number) => {
    const date = new Date(day * 86_400_000);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
  };
  return [key(previousStart), key(previousEnd)];
}

export function buildCashFlowInsights(
  current: CashFlowPeriod,
  previous: CashFlowPeriod,
  transactions: AccountTxn[],
): CashFlowInsights {
  const operatingMovements = transactions.filter((transaction) => !NON_OPERATING_TYPES.has(transaction.type));
  const inflows = operatingMovements.reduce((sum, transaction) => sum + Math.max(0, transaction.amount), 0);
  const outflows = operatingMovements.reduce((sum, transaction) => sum + Math.max(0, -transaction.amount), 0);
  const largestExpenseEntry = Object.entries(current.expensesByCategory).sort((a, b) => b[1] - a[1])[0];
  const categories = new Set([...Object.keys(current.expensesByCategory), ...Object.keys(previous.expensesByCategory)]);
  const largestIncrease = [...categories]
    .map((category) => ({ category, change: (current.expensesByCategory[category] ?? 0) - (previous.expensesByCategory[category] ?? 0) }))
    .filter((item) => item.change > 0)
    .sort((a, b) => b.change - a.change)[0];

  return {
    inflows,
    outflows,
    netAccountMovement: inflows - outflows,
    expenseRatioPercent: current.revenue > 0 ? (current.expenses / current.revenue) * 100 : null,
    netProfitChange: current.netProfit - previous.netProfit,
    largestExpense: largestExpenseEntry
      ? {
          category: largestExpenseEntry[0],
          amount: largestExpenseEntry[1],
          change: largestExpenseEntry[1] - (previous.expensesByCategory[largestExpenseEntry[0]] ?? 0),
        }
      : null,
    largestExpenseIncrease: largestIncrease ?? null,
  };
}
