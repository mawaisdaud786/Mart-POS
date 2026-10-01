import { uuidToBytes } from '@retailos/domain';
import { sql } from 'drizzle-orm';
import type { DbOrTx } from './client.js';
import { syncChanges } from './schema/system.js';

export interface ChangeRecord {
  entityType: string;
  entityId: string;
  op: 'upsert' | 'delete';
  version?: number;
  branchId?: string | null;
}

/**
 * Reserve the next change-log sequence number for a tenant.
 *
 * `LAST_INSERT_ID(expr)` makes the increment atomic and returns the new value on this
 * connection. The row lock on tenant_sync_counters is held until the transaction commits, so
 * transactions for one tenant commit in sequence order: once a device has seen seq N, no
 * transaction can later commit a seq ≤ N (gap-free pull, docs/phase-1/02 §3.2).
 * Must be called inside a transaction.
 */
export async function nextServerSeq(tx: DbOrTx, tenantId: string, count = 1): Promise<number> {
  await tx.execute(
    sql`insert ignore into tenant_sync_counters (tenant_id, last_seq) values (${uuidParam(tenantId)}, 0)`,
  );
  await tx.execute(
    sql`update tenant_sync_counters set last_seq = last_insert_id(last_seq + ${count}) where tenant_id = ${uuidParam(tenantId)}`,
  );
  const [rows] = (await tx.execute(sql`select last_insert_id() as seq`)) as unknown as [
    Array<{ seq: number | string }>,
  ];
  const last = Number(rows[0]?.seq);
  if (!Number.isFinite(last) || last <= 0) throw new Error('Failed to reserve server sequence');
  return last - count + 1;
}

/** Record changes in the change log. Returns the seq assigned to each change, in order. */
export async function recordChanges(tx: DbOrTx, tenantId: string, changes: ChangeRecord[]): Promise<number[]> {
  if (changes.length === 0) return [];
  const first = await nextServerSeq(tx, tenantId, changes.length);
  const seqs = changes.map((_, i) => first + i);
  await tx.insert(syncChanges).values(
    changes.map((c, i) => ({
      tenantId,
      serverSeq: seqs[i]!,
      entityType: c.entityType,
      entityId: c.entityId,
      op: c.op,
      version: c.version ?? 1,
      branchId: c.branchId ?? null,
    })),
  );
  return seqs;
}

function uuidParam(id: string): Buffer {
  return Buffer.from(uuidToBytes(id));
}
