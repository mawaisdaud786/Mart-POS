import { divRound, type Paisa } from './money.js';

/**
 * Quantities are held in code as integer thousandths ("milli") of a unit, matching the
 * database column type decimal(14,3). 1.5 kg → 1500, 24 packets → 24000.
 * This keeps loose goods (0.25 kg) exact and avoids float drift when summing stock.
 */
export type Milli = number;

export const QTY_SCALE = 1000;

export function toMilli(qty: number | string): Milli {
  const n = typeof qty === 'string' ? Number(qty) : qty;
  if (!Number.isFinite(n)) throw new RangeError(`Invalid quantity: ${qty}`);
  return Math.round(n * QTY_SCALE);
}

export function fromMilli(milli: Milli): number {
  return milli / QTY_SCALE;
}

/** Milli → exact decimal string for MySQL decimal(14,3) columns. */
export function milliToDecimal(milli: Milli): string {
  const sign = milli < 0 ? '-' : '';
  const abs = Math.abs(milli);
  const whole = Math.floor(abs / QTY_SCALE);
  const frac = String(abs % QTY_SCALE).padStart(3, '0');
  return `${sign}${whole}.${frac}`;
}

/** Line amount = unit price (paisa per unit) × quantity, rounded to the paisa. */
export function lineAmount(unitPrice: Paisa, qty: Milli): Paisa {
  return divRound(unitPrice * qty, QTY_SCALE);
}

export function formatQty(milli: Milli, locale = 'en-PK'): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(fromMilli(milli));
}
