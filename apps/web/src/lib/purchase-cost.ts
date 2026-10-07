/** Product.cost is stored in paisa per sale unit; product forms may enter cost per buying pack. */
export function costPerPurchaseUnit(costPerSaleUnit: number, packSize?: number): number {
  return Math.round(costPerSaleUnit * (packSize && packSize > 0 ? packSize : 1));
}

export function costPerSaleUnit(purchaseUnitCost: number, packSize?: number): number {
  return Math.round(purchaseUnitCost / (packSize && packSize > 0 ? packSize : 1));
}
