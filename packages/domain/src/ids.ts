import { v5 as uuidv5, v7 as uuidv7, validate, version } from 'uuid';

/** New record id. UUIDv7 is time-ordered, so InnoDB primary-key inserts stay sequential. */
export function newId(): string {
  return uuidv7();
}

/** Namespace for deterministic posting ids (never change this value). */
export const POSTING_NAMESPACE = '6f1c2f0e-5a4b-4c7e-9a51-2d0b8c3e7a10';

/**
 * Deterministic id for a ledger row derived from a document, so the device and the server
 * produce the same id for the same posting and a synced row replaces the provisional one.
 */
export function postingId(sourceType: string, sourceId: string, lineNo: number, kind: string): string {
  return uuidv5(`${sourceType}:${sourceId}:${lineNo}:${kind}`, POSTING_NAMESPACE);
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && validate(value);
}

export function isUuidV7(value: unknown): value is string {
  return isUuid(value) && version(value) === 7;
}

/** UUID string → 16 raw bytes for MySQL BINARY(16). */
export function uuidToBytes(id: string): Uint8Array {
  const hex = id.replace(/-/g, '');
  if (hex.length !== 32) throw new RangeError(`Not a UUID: ${id}`);
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/** 16 raw bytes from MySQL BINARY(16) → canonical UUID string. */
export function bytesToUuid(bytes: Uint8Array): string {
  if (bytes.length !== 16) throw new RangeError(`Expected 16 bytes, got ${bytes.length}`);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
