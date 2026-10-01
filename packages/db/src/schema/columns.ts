import { bytesToUuid, milliToDecimal, uuidToBytes, type Milli } from '@retailos/domain';
import { sql } from 'drizzle-orm';
import { bigint, customType, datetime, int } from 'drizzle-orm/mysql-core';

/** UUID stored as BINARY(16). Application code always sees the canonical string form. */
export const uuid = customType<{ data: string; driverData: Buffer }>({
  dataType() {
    return 'binary(16)';
  },
  toDriver(value) {
    return Buffer.from(uuidToBytes(value));
  },
  fromDriver(value) {
    return bytesToUuid(new Uint8Array(value));
  },
});

/** Quantity as decimal(14,3) in the database, integer thousandths (Milli) in code. */
export const qty = customType<{ data: Milli; driverData: string }>({
  dataType() {
    return 'decimal(14,3)';
  },
  toDriver(value) {
    return milliToDecimal(value);
  },
  fromDriver(value) {
    return Math.round(Number(value) * 1000);
  },
});

/** Money in paisa (bigint). */
export const money = (name: string) => bigint(name, { mode: 'number' });

/** UTC timestamp with milliseconds. */
export const ts = (name: string) => datetime(name, { fsp: 3, mode: 'date' });

export const nowMs = sql`(CURRENT_TIMESTAMP(3))`;

/**
 * Columns every synced, tenant-owned table carries (docs/phase-1/03 ⟨sync⟩).
 * `server_seq` is assigned by the server's change-log writer.
 */
export const syncColumns = () => ({
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  createdAt: ts('created_at').notNull().default(nowMs),
  updatedAt: ts('updated_at').notNull().default(nowMs),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  originDeviceId: uuid('origin_device_id'),
  version: int('version').notNull().default(1),
  deletedAt: ts('deleted_at'),
  serverSeq: bigint('server_seq', { mode: 'number' }).notNull().default(0),
});

/** Immutable business documents (docs/phase-1/03 ⟨doc⟩): no soft delete, always branch + occurred_at. */
export const docColumns = () => {
  const { deletedAt: _omit, ...rest } = syncColumns();
  return {
    ...rest,
    branchId: uuid('branch_id').notNull(),
    occurredAt: ts('occurred_at').notNull(),
    receivedAt: ts('received_at'),
  };
};

/** "Unique while not deleted" helper: NULL when deleted so deleted rows never collide. */
export const activeKeySql = sql`(if(\`deleted_at\` is null, 1, null))`;
