import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  SYSTEM_ROLES,
  allocate,
  bytesToUuid,
  divRound,
  formatMoney,
  fromBaseQty,
  isUuidV7,
  lineAmount,
  milliToDecimal,
  newId,
  parseRupees,
  percentOf,
  postingId,
  resolveEntitlements,
  toBaseQty,
  toMilli,
  uuidToBytes,
  DEFAULT_PLANS,
} from './index.js';

describe('money', () => {
  it('parses rupee input into integer paisa', () => {
    expect(parseRupees('1,250.5')).toBe(125050);
    expect(parseRupees('Rs. 99')).toBe(9900);
    expect(parseRupees('-12.05')).toBe(-1205);
    expect(parseRupees(0.1 + 0.2)).toBe(30);
    expect(() => parseRupees('12.345')).toThrow();
    expect(() => parseRupees('abc')).toThrow();
  });

  it('rounds half away from zero', () => {
    expect(divRound(5, 2)).toBe(3);
    expect(divRound(-5, 2)).toBe(-3);
    expect(divRound(4, 3)).toBe(1);
  });

  it('formats PKR', () => {
    expect(formatMoney(125000)).toBe('Rs 1,250');
    expect(formatMoney(125050)).toBe('Rs 1,250.50');
    expect(formatMoney(-70000)).toBe('-Rs 700');
  });

  it('computes percentages in integer paisa', () => {
    expect(percentOf(25000, 5)).toBe(1250);
    expect(percentOf(10000, 2.5)).toBe(250);
    expect(percentOf(333, 10)).toBe(33);
  });

  it('allocates without losing a paisa', () => {
    const parts = allocate(1000, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(parts).toEqual([334, 333, 333]);
    expect(allocate(-100, [1, 2]).reduce((a, b) => a + b, 0)).toBe(-100);
  });
});

describe('quantities and units', () => {
  it('stores quantity as exact thousandths', () => {
    expect(toMilli(0.25)).toBe(250);
    expect(toMilli('1.5')).toBe(1500);
    expect(milliToDecimal(250)).toBe('0.250');
    expect(milliToDecimal(-24000)).toBe('-24.000');
  });

  it('prices loose goods to the paisa', () => {
    // 0.25 kg of daal at Rs 320/kg = Rs 80
    expect(lineAmount(32000, toMilli(0.25))).toBe(8000);
    // 3 packets at Rs 45.50
    expect(lineAmount(4550, toMilli(3))).toBe(13650);
  });

  it('converts carton ↔ packets (spec §11: 1 carton = 24 packets)', () => {
    expect(toBaseQty(toMilli(1), 24)).toBe(toMilli(24));
    expect(fromBaseQty(toMilli(60), 12)).toBe(toMilli(5));
    // 250 g in a kg-based product
    expect(toBaseQty(toMilli(250), 0.001)).toBe(toMilli(0.25));
  });
});

describe('ids', () => {
  it('generates UUIDv7 and round-trips BINARY(16)', () => {
    const id = newId();
    expect(isUuidV7(id)).toBe(true);
    expect(bytesToUuid(uuidToBytes(id))).toBe(id);
  });

  it('gives the device and server the same posting id', () => {
    const a = postingId('sale', '0190a0b0-0000-7000-8000-000000000001', 1, 'stock');
    const b = postingId('sale', '0190a0b0-0000-7000-8000-000000000001', 1, 'stock');
    const c = postingId('sale', '0190a0b0-0000-7000-8000-000000000001', 2, 'stock');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('permissions and plans', () => {
  it('only uses catalog permissions in role templates', () => {
    for (const role of Object.values(SYSTEM_ROLES)) {
      for (const p of role.permissions) expect(ALL_PERMISSIONS).toContain(p);
    }
  });

  it('keeps cashier away from cost, profit, voids, expense edits and supplier balances (spec §36)', () => {
    const cashier = new Set(SYSTEM_ROLES.cashier.permissions);
    for (const p of [
      'products.edit_cost',
      'products.view_cost',
      'sales.void',
      'reports.profit',
      'dashboard.owner',
      'expenses.edit_void',
      'suppliers.view_balance',
    ] as const) {
      expect(cashier.has(p)).toBe(false);
    }
  });

  it('applies tenant overrides to plan entitlements', () => {
    const starter = DEFAULT_PLANS[0]!;
    const e = resolveEntitlements(starter.features, starter.limits, {
      features: { retailer_services: true, expenses: false, bogus: true },
      limits: { users: 3 },
    });
    expect(e.features.has('retailer_services')).toBe(true);
    expect(e.features.has('expenses')).toBe(false);
    expect(e.limits.users).toBe(3);
    expect(e.limits.branches).toBe(1);
  });
});
