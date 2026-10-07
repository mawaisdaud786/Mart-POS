export interface PurchasePriceChange {
  previous: number;
  current: number;
  difference: number;
  percent: number;
  direction: 'increase' | 'decrease' | 'unchanged';
}

export function comparePurchasePrice(previous: number, current: number): PurchasePriceChange {
  const difference = current - previous;
  return {
    previous,
    current,
    difference,
    percent: previous > 0 ? Math.abs(difference) * 100 / previous : 0,
    direction: difference > 0 ? 'increase' : difference < 0 ? 'decrease' : 'unchanged',
  };
}

export function suggestedSellingPrice(currentSellingPrice: number, previousCost: number, newCost: number): number {
  const existingMarkup = Math.max(0, currentSellingPrice - previousCost);
  return Math.max(currentSellingPrice, newCost + existingMarkup);
}

export interface PurchasePaymentSummary {
  paid: number;
  credit: number;
  overpayment: number;
}

export function summarizePurchasePayments(total: number, amounts: number[]): PurchasePaymentSummary {
  const paid = amounts.reduce((sum, amount) => sum + (Number.isFinite(amount) && amount > 0 ? amount : 0), 0);
  return { paid, credit: Math.max(0, total - paid), overpayment: Math.max(0, paid - total) };
}