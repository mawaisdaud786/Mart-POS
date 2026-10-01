import { describe, expect, it } from 'vitest';
import { issueStock, receiveStock } from '../costing.js';
import { toMilli } from '../qty.js';
import { postStockAdjustment } from './stock-adjustment.js';

const P = '0190a0b0-0000-7000-8000-00000000000a';
const B = '0190a0b0-0000-7000-8000-00000000000b';

describe('weighted average cost', () => {
  it('averages purchases at different prices', () => {
    // 10 bottles at Rs 500, then 10 at Rs 520 → avg Rs 510
    let pos = receiveStock({ qtyOnHand: 0, avgCost: 0 }, toMilli(10), 50000);
    pos = receiveStock(pos, toMilli(10), 52000);
    expect(pos).toEqual({ qtyOnHand: toMilli(20), avgCost: 51000 });
  });

  it('costs outflows at the average and allows negative stock', () => {
    const pos = { qtyOnHand: toMilli(1), avgCost: 51000 };
    const out = issueStock(pos, toMilli(3));
    expect(out.totalCost).toBe(153000);
    expect(out.position.qtyOnHand).toBe(toMilli(-2));
    // Receiving after negative stock resets the average to the new cost
    expect(receiveStock(out.position, toMilli(12), 50000).avgCost).toBe(50000);
  });

  it('keeps sub-paisa precision for loose goods', () => {
    // 50 kg sack of sugar for Rs 7,250 → Rs 145/kg; sell 0.25 kg → Rs 36.25 cost
    const pos = receiveStock({ qtyOnHand: 0, avgCost: 0 }, toMilli(50), 14500);
    expect(issueStock(pos, toMilli(0.25)).totalCost).toBe(3625);
  });
});

describe('postStockAdjustment', () => {
  const doc = {
    id: '0190a0b0-0000-7000-8000-0000000000aa',
    branchId: B,
    occurredAt: '2026-09-27T10:00:00.000Z',
    reason: 'opening' as const,
    items: [{ lineNo: 1, productId: P, qtyBase: toMilli(24), unitCost: 4000 }],
  };

  it('posts opening stock as a movement and a new balance', () => {
    const r = postStockAdjustment(doc, new Map());
    expect(r.movements).toHaveLength(1);
    expect(r.movements[0]).toMatchObject({ movementType: 'opening', qtyBase: 24000, totalCost: 96000, balanceAfter: 24000 });
    expect(r.balances[0]).toMatchObject({ position: { qtyOnHand: 24000, avgCost: 4000 }, stockValue: 96000 });
  });

  it('produces identical ids on every run (device = server)', () => {
    expect(postStockAdjustment(doc, new Map()).movements[0]!.id).toBe(postStockAdjustment(doc, new Map()).movements[0]!.id);
  });

  it('removes damaged stock at average cost', () => {
    const r = postStockAdjustment(
      { ...doc, reason: 'damage', items: [{ lineNo: 1, productId: P, qtyBase: toMilli(-2) }] },
      new Map([[P, { qtyOnHand: toMilli(24), avgCost: 4000 }]]),
    );
    expect(r.movements[0]).toMatchObject({ movementType: 'damage', qtyBase: -2000, totalCost: -8000, balanceAfter: 22000 });
  });

  it('applies several lines for the same product in order', () => {
    const r = postStockAdjustment(
      {
        ...doc,
        reason: 'correction',
        items: [
          { lineNo: 2, productId: P, qtyBase: toMilli(-5) },
          { lineNo: 1, productId: P, qtyBase: toMilli(10), unitCost: 3000 },
        ],
      },
      new Map(),
    );
    expect(r.movements.map((m) => m.balanceAfter)).toEqual([10000, 5000]);
    expect(r.balances[0]!.position.qtyOnHand).toBe(5000);
  });
});
