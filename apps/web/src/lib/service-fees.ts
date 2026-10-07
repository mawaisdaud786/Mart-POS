import type { ServiceType } from './db';

export const DEFAULT_RETAILER_CASH_IN_FEE = 1_000;
export const DEFAULT_RETAILER_CASH_OUT_FEE = 1_000;

export function defaultServiceFee(
  type: ServiceType,
  amount: number,
  cashInFeePerThousand = DEFAULT_RETAILER_CASH_IN_FEE,
  cashOutFeePerThousand = DEFAULT_RETAILER_CASH_OUT_FEE,
  cashInStep = 100_000,
  cashOutStep = 50_000,
): number {
  if (type === 'cash_in' && amount > 0 && cashInStep > 0) return Math.ceil(amount / cashInStep) * cashInFeePerThousand;
  if (type === 'cash_out' && amount > 0 && cashOutStep > 0) return Math.ceil(amount / cashOutStep) * cashOutFeePerThousand;
  return 0;
}
