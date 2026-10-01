import type { Milli } from './qty.js';

export type UnitKind = 'count' | 'weight' | 'volume' | 'length';

export interface SystemUnit {
  code: string;
  name: string;
  nameUr: string;
  kind: UnitKind;
  /** For convertible units: the unit this one converts to, and how many of it one of these equals. */
  baseCode?: string;
  factorToBase?: number;
}

/**
 * Seeded for every tenant. Packaging units (box, carton, case…) have no fixed size:
 * their size is set per product in product_units (e.g. 1 carton of biscuits = 24 packets).
 */
export const SYSTEM_UNITS: readonly SystemUnit[] = [
  { code: 'pc', name: 'Piece', nameUr: 'عدد', kind: 'count' },
  { code: 'pkt', name: 'Packet', nameUr: 'پیکٹ', kind: 'count' },
  { code: 'box', name: 'Box', nameUr: 'ڈبہ', kind: 'count' },
  { code: 'ctn', name: 'Carton', nameUr: 'کارٹن', kind: 'count' },
  { code: 'case', name: 'Case', nameUr: 'کیس', kind: 'count' },
  { code: 'dozen', name: 'Dozen', nameUr: 'درجن', kind: 'count', baseCode: 'pc', factorToBase: 12 },
  { code: 'btl', name: 'Bottle', nameUr: 'بوتل', kind: 'count' },
  { code: 'sack', name: 'Sack', nameUr: 'بوری', kind: 'count' },
  { code: 'kg', name: 'Kilogram', nameUr: 'کلو', kind: 'weight' },
  { code: 'g', name: 'Gram', nameUr: 'گرام', kind: 'weight', baseCode: 'kg', factorToBase: 0.001 },
  { code: 'l', name: 'Litre', nameUr: 'لیٹر', kind: 'volume' },
  { code: 'ml', name: 'Millilitre', nameUr: 'ملی لیٹر', kind: 'volume', baseCode: 'l', factorToBase: 0.001 },
];

/**
 * Convert a quantity entered in a product unit into the product's base unit.
 * `factorToBase` = how many base units one of this unit contains (carton → 24 packets = 24).
 */
export function toBaseQty(qty: Milli, factorToBase: number): Milli {
  if (!(factorToBase > 0)) throw new RangeError(`Unit factor must be positive: ${factorToBase}`);
  return Math.round(qty * factorToBase);
}

/** Inverse of toBaseQty, e.g. 60 bottles in cartons of 12 → 5 cartons. */
export function fromBaseQty(baseQty: Milli, factorToBase: number): Milli {
  if (!(factorToBase > 0)) throw new RangeError(`Unit factor must be positive: ${factorToBase}`);
  return Math.round(baseQty / factorToBase);
}
