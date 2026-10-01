import { EMPTY_POSITION, costOf, issueStock, receiveStock, stockValue, type StockPosition } from '../costing.js';
import { postingId } from '../ids.js';
import type { Paisa } from '../money.js';
import type { Milli } from '../qty.js';

export type AdjustmentReason = 'damage' | 'expiry' | 'theft' | 'correction' | 'opening' | 'other';

export interface StockAdjustmentDoc {
  id: string;
  branchId: string;
  occurredAt: string;
  reason: AdjustmentReason;
  createdBy?: string | null;
  items: Array<{
    lineNo: number;
    productId: string;
    /** Signed base-unit quantity: + adds stock, − removes it. */
    qtyBase: Milli;
    /** Cost per base unit (paisa) for stock being added. Required for opening stock. */
    unitCost?: Paisa | null;
  }>;
}

export type MovementType =
  | 'opening'
  | 'adjustment_in'
  | 'adjustment_out'
  | 'damage'
  | 'expiry'
  | 'count_correction';

export interface MovementPosting {
  id: string;
  branchId: string;
  occurredAt: string;
  sourceType: string;
  sourceId: string;
  sourceLineId: string | null;
  productId: string;
  movementType: MovementType;
  qtyBase: Milli;
  unitCost: number;
  totalCost: Paisa;
  balanceAfter: Milli;
  reasonCode: string;
  createdBy: string | null;
}

export interface BalanceUpdate {
  productId: string;
  branchId: string;
  position: StockPosition;
  stockValue: Paisa;
}

export interface PostingResult {
  movements: MovementPosting[];
  balances: BalanceUpdate[];
}

function movementTypeFor(reason: AdjustmentReason, qtyBase: Milli): MovementType {
  if (reason === 'opening') return 'opening';
  if (qtyBase > 0) return 'adjustment_in';
  if (reason === 'damage') return 'damage';
  if (reason === 'expiry') return 'expiry';
  return 'adjustment_out';
}

/**
 * Turn a stock adjustment into stock movements and new balances.
 * Pure function: the device and the server run the same code, and movement ids are
 * deterministic, so a synced movement replaces the provisional one on the device.
 * `positions` is the current stock per product in the adjustment's branch.
 */
export function postStockAdjustment(
  doc: StockAdjustmentDoc,
  positions: ReadonlyMap<string, StockPosition>,
): PostingResult {
  const working = new Map<string, StockPosition>();
  const movements: MovementPosting[] = [];

  for (const item of [...doc.items].sort((a, b) => a.lineNo - b.lineNo)) {
    if (item.qtyBase === 0) continue;
    const before = working.get(item.productId) ?? positions.get(item.productId) ?? EMPTY_POSITION;
    let after: StockPosition;
    let unitCost: number;
    let totalCost: Paisa;

    if (item.qtyBase > 0) {
      // Stock found or opening stock: use the given cost, or the current average if none given.
      unitCost = item.unitCost ?? before.avgCost;
      after = receiveStock(before, item.qtyBase, unitCost);
      totalCost = costOf(item.qtyBase, unitCost);
    } else {
      const issued = issueStock(before, -item.qtyBase);
      after = issued.position;
      unitCost = issued.unitCost;
      totalCost = -issued.totalCost;
    }
    working.set(item.productId, after);

    movements.push({
      id: postingId('stock_adjustment', doc.id, item.lineNo, 'stock'),
      branchId: doc.branchId,
      occurredAt: doc.occurredAt,
      sourceType: 'stock_adjustment',
      sourceId: doc.id,
      sourceLineId: null,
      productId: item.productId,
      movementType: movementTypeFor(doc.reason, item.qtyBase),
      qtyBase: item.qtyBase,
      unitCost,
      totalCost,
      balanceAfter: after.qtyOnHand,
      reasonCode: doc.reason,
      createdBy: doc.createdBy ?? null,
    });
  }

  const balances = [...working.entries()].map(([productId, position]) => ({
    productId,
    branchId: doc.branchId,
    position,
    stockValue: stockValue(position),
  }));
  return { movements, balances };
}
