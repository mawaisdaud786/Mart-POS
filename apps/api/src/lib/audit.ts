import { schema, type TenantDb } from '@retailos/db';
import type { FastifyRequest } from 'fastify';
import type { RequestContext } from './context.js';

export interface AuditEntry {
  action: string;
  entityType?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
}

/** Append to the tenant's audit log (append-only; the owner can read it). */
export async function audit(
  tdb: TenantDb,
  ctx: Pick<RequestContext, 'userId' | 'device'>,
  request: FastifyRequest | null,
  entry: AuditEntry,
): Promise<void> {
  await tdb.insert(schema.auditLogs, {
    tenantId: tdb.tenantId,
    userId: ctx.userId,
    deviceId: ctx.device?.id ?? null,
    ip: request?.ip ?? null,
    userAgent: request?.headers['user-agent']?.slice(0, 255) ?? null,
    action: entry.action,
    entityType: entry.entityType ?? null,
    entityId: entry.entityId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    reason: entry.reason ?? null,
  });
}
