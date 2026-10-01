import type { Paisa } from './money.js';
import { QTY_SCALE, type Milli } from './qty.js';

/**
 * Stock position of one product in one branch. `avgCost` is the weighted average cost per
 * base unit in paisa, kept fractional (e.g. 0.25 paisa per gram) so it doesn't drift.
 */
export interface StockPosition {
  qtyOnHand: Milli;
  avgCost: number;
}

export const EMPTY_POSITION: StockPosition = { qtyOnHand: 0, avgCost: 0 };

/** Round a fractional average cost to 4 decimals (matches decimal(18,4) in MySQL). */
export function roundCost(cost: number): number {
  return Math.round(cost * 10_000) / 10_000;
}

/** Cost of `qty` base units at `unitCost` paisa each, rounded to the paisa. */
export function costOf(qty: Milli, unitCost: number): Paisa {
  const value = (qty * unitCost) / QTY_SCALE;
  return Math.sign(value) * Math.round(Math.abs(value));
}

/**
 * Stock coming in at a known cost (purchase, opening stock, found stock).
 * Moving weighted average: (old qty × old avg + new qty × new cost) / total qty.
 * If stock was zero or negative (sold before it was received), the new cost becomes the average.
 */
export function receiveStock(position: StockPosition, qty: Milli, unitCost: number): StockPosition {
  if (qty <= 0) throw new RangeError('receiveStock needs a positive quantity');
  if (unitCost < 0) throw new RangeError('Unit cost cannot be negative');
  const newQty = position.qtyOnHand + qty;
  if (position.qtyOnHand <= 0 || newQty <= 0) {
    return { qtyOnHand: newQty, avgCost: roundCost(unitCost) };
  }
  const avg = (position.qtyOnHand * position.avgCost + qty * unitCost) / newQty;
  return { qtyOnHand: newQty, avgCost: roundCost(avg) };
}

/**
 * Stock going out (sale, damage, expiry, adjustment). Out-flows are always costed at the
 * current average, and the average does not change. Stock may go negative (docs/phase-1/02 §4).
 */
export function issueStock(position: StockPosition, qty: Milli): { position: StockPosition; unitCost: number; totalCost: Paisa } {
  if (qty <= 0) throw new RangeError('issueStock needs a positive quantity');
  return {
    position: { qtyOnHand: position.qtyOnHand - qty, avgCost: position.avgCost },
    unitCost: position.avgCost,
    totalCost: costOf(qty, position.avgCost),
  };
}

export function stockValue(position: StockPosition): Paisa {
  return position.qtyOnHand > 0 ? costOf(position.qtyOnHand, position.avgCost) : 0;
}
