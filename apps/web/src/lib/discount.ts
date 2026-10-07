import { isKaryanaCategoryName } from '@retailos/domain';

export { isKaryanaCategoryName } from '@retailos/domain';

export interface AutoDiscountConfig {
  minOrder: number;
  percent: number;
  maxPercent: number;
  karyanaOnly: boolean;
  categoryName?: string;
  orderTotal?: number;
}

export function computeAutoDiscountForLine(
  line: { price: number; qty: number; discount?: number; productId?: string; name?: string; unit?: string },
  config: AutoDiscountConfig,
): number {
  const minOrder = Number(config.minOrder ?? 0);
  const percent = Math.min(Math.max(Number(config.percent ?? 0), 0), 100);
  const maxPercent = Math.min(Math.max(Number(config.maxPercent ?? 70), 0), 100);
  const orderTotal = config.orderTotal === undefined ? undefined : Number(config.orderTotal);

  if (!Number.isFinite(minOrder) || minOrder <= 0 || !Number.isFinite(percent) || percent <= 0) return 0;
  if (orderTotal !== undefined && (!Number.isFinite(orderTotal) || orderTotal < minOrder)) return 0;
  if (config.karyanaOnly && !isKaryanaCategoryName(config.categoryName)) return 0;

  const effectivePercent = Math.min(percent, maxPercent);
  const base = Math.round(line.price * line.qty);
  const discount = Math.min(Math.round((base * effectivePercent) / 100), base);
  return Math.max(0, discount);
}
