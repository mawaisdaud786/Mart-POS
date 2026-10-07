const QUANTITY_PRECISION = 1000;

/** Convert a rupee budget to the greatest allowed 0.001-unit quantity that stays within budget. */
export function quantityForAmount(amountPaisa: number, unitPricePaisa: number): number {
  if (!Number.isFinite(amountPaisa) || amountPaisa <= 0 || !Number.isFinite(unitPricePaisa) || unitPricePaisa <= 0) return 0;
  return Math.floor((amountPaisa / unitPricePaisa) * QUANTITY_PRECISION + Number.EPSILON * QUANTITY_PRECISION) / QUANTITY_PRECISION;
}
