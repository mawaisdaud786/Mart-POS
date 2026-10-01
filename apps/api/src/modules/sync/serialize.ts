/** Columns that never leave the server. */
const HIDDEN = new Set(['tenantId', 'serverSeq', 'activeKey', 'fieldVersions', 'currentKey', 'scopeBranchId']);

/** DB row (camelCase from Drizzle) → JSON-safe wire object: dates as ISO strings, internals removed. */
export function toWire(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (HIDDEN.has(key)) continue;
    out[key] = value instanceof Date ? value.toISOString() : value;
  }
  return out;
}

/** Fields of `data` that are present in the given zod shape keys (used to build partial updates). */
export function pick<T extends Record<string, unknown>>(data: T, keys: readonly string[]): Partial<T> {
  const out: Partial<T> = {};
  for (const k of keys) if (k in data) (out as Record<string, unknown>)[k] = data[k];
  return out;
}
