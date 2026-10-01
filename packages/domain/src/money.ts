/**
 * Money is always an integer number of paisa (Rs 1 = 100 paisa).
 * Never store or add rupee floats. Convert at the edges (input fields, display).
 */
export type Paisa = number;

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

export function assertPaisa(value: number): asserts value is Paisa {
  if (!Number.isInteger(value) || Math.abs(value) > MAX_SAFE) {
    throw new RangeError(`Invalid money amount (paisa must be a safe integer): ${value}`);
  }
}

/** Integer division rounding half away from zero (commercial rounding). */
export function divRound(numerator: number, denominator: number): number {
  if (denominator === 0) throw new RangeError('Division by zero');
  const sign = Math.sign(numerator) * Math.sign(denominator);
  const n = Math.abs(numerator);
  const d = Math.abs(denominator);
  return sign * Math.floor((n * 2 + d) / (2 * d));
}

/** Parse user input like "1,250.5" or "Rs. 99" into paisa. Throws on garbage. */
export function parseRupees(input: string | number): Paisa {
  const text = typeof input === 'number' ? input.toFixed(2) : input.replace(/rs\.?|pkr|,|\s/gi, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(text)) throw new RangeError(`Not a valid rupee amount: ${input}`);
  const negative = text.startsWith('-');
  const [whole = '0', fraction = ''] = text.replace('-', '').split('.');
  const paisa = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  assertPaisa(paisa);
  return negative ? -paisa : paisa;
}

/** Paisa → rupees as a plain number (for charts/inputs only, never for arithmetic). */
export function toRupees(paisa: Paisa): number {
  return paisa / 100;
}

export interface FormatMoneyOptions {
  locale?: string;
  /** Show paisa decimals. Defaults to only when non-zero. */
  decimals?: 'auto' | 'always' | 'never';
  symbol?: boolean;
}

/** Format paisa as "Rs 1,250" / "Rs 1,250.50" using Pakistani digit grouping by default. */
export function formatMoney(paisa: Paisa, options: FormatMoneyOptions = {}): string {
  const { locale = 'en-PK', decimals = 'auto', symbol = true } = options;
  const hasFraction = paisa % 100 !== 0;
  const digits = decimals === 'always' || (decimals === 'auto' && hasFraction) ? 2 : 0;
  const value = decimals === 'never' ? divRound(paisa, 100) : paisa / 100;
  const text = new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Math.abs(value));
  const sign = paisa < 0 ? '-' : '';
  return symbol ? `${sign}Rs ${text}` : `${sign}${text}`;
}

export function sumMoney(values: readonly Paisa[]): Paisa {
  let total = 0;
  for (const v of values) total += v;
  assertPaisa(total);
  return total;
}

/** Percentage of an amount, e.g. discount 5% of Rs 250 → 1250 paisa. `percent` may be fractional (2.5). */
export function percentOf(amount: Paisa, percent: number): Paisa {
  // Scale percent to basis points ×100 to keep integer math for typical inputs (up to 4 decimals).
  const scaled = Math.round(percent * 10_000);
  return divRound(amount * scaled, 1_000_000);
}

/**
 * Split an amount into parts proportional to weights without losing a paisa
 * (largest-remainder method). Used for spreading order discounts / freight over lines.
 */
export function allocate(amount: Paisa, weights: readonly number[]): Paisa[] {
  if (weights.length === 0) return [];
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight === 0) {
    const result = weights.map(() => 0);
    result[0] = amount;
    return result;
  }
  const raw = weights.map((w) => (amount * w) / totalWeight);
  const floored = raw.map((r) => Math.trunc(r));
  let remainder = amount - floored.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: Math.abs(r - Math.trunc(r)) }))
    .sort((a, b) => b.frac - a.frac);
  const step = Math.sign(remainder);
  for (let k = 0; remainder !== 0; k = (k + 1) % order.length) {
    const idx = order[k]!.i;
    floored[idx] = floored[idx]! + step;
    remainder -= step;
  }
  return floored;
}
