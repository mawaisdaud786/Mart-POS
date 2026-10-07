import {
  PullQuery,
  PullResponse,
  PushBody,
  PushResponse,
  SnapshotResponse,
  type Change,
  type Mutation,
  type MutationResult,
  type PullableEntity,
} from '@retailos/contracts';
import { recordChanges, schema, TenantDb } from '@retailos/db';
import { and, asc, eq, gt } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { RequestContext } from '../../lib/context.js';
import { HANDLERS, RejectError, SNAPSHOT_ORDER, type ApplyResult } from './handlers.js';

const { devices, syncChanges, syncMutations, tenantSyncCounters } = schema;

/** MySQL error codes that mean "the data is wrong", not "try again later". */
const DATA_ERRORS: Record<string, { code: string; message: string }> = {
  ER_DUP_ENTRY: { code: 'DUPLICATE', message: 'A record with the same unique value already exists (for example the same SKU or barcode)' },
  ER_NO_REFERENCED_ROW_2: { code: 'INVALID_REFERENCE', message: 'Refers to a record that does not exist' },
  ER_CHECK_CONSTRAINT_VIOLATED: { code: 'VALIDATION_FAILED', message: 'A value is outside the allowed range' },
  ER_DATA_TOO_LONG: { code: 'VALIDATION_FAILED', message: 'A value is too long' },
  ER_WARN_DATA_OUT_OF_RANGE: { code: 'VALIDATION_FAILED', message: 'A number is out of range' },
};

function mysqlCode(err: unknown): string | undefined {
  let e: unknown = err;
  for (let i = 0; i < 3 && e; i++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && code.startsWith('ER_')) return code;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

async function applyMutation(tdb: TenantDb, ctx: RequestContext, m: Mutation): Promise<ApplyResult> {
  const handler = HANDLERS[m.entity];
  if (m.op === 'create') {
    if (!handler.create) throw new RejectError('UNSUPPORTED', `${m.entity} cannot be created by sync`);
    return handler.create(tdb, ctx, m.id, m.data);
  }
  if (m.op === 'update') {
    if (!handler.update) throw new RejectError('UNSUPPORTED', `${m.entity} cannot be updated`);
    return handler.update(tdb, ctx, m.id, m.baseVersion, m.changes, m.mutationId);
  }
  if (!handler.remove) throw new RejectError('UNSUPPORTED', `${m.entity} cannot be deleted`);
  return handler.remove(tdb, ctx, m.id, m.baseVersion, m.mutationId);
}

function toResult(mutationId: string, r: ApplyResult): MutationResult {
  return r.status === 'applied'
    ? { mutationId, status: 'applied', ...(r.version !== undefined ? { version: r.version } : {}) }
    : { mutationId, status: 'conflict', conflictId: r.conflictId, serverVersion: r.serverVersion, fields: r.fields };
}

export const syncRoutes: FastifyPluginAsyncZod = async (app) => {
  /**
   * Apply device mutations in order. Each mutation runs in its own transaction and is
   * recorded in sync_mutations, so a retried push returns the stored result instead of
   * applying twice (docs/phase-1/02 §3.1).
   */
  app.post(
    '/push',
    {
      schema: { body: PushBody, response: { 200: PushResponse } },
      config: { device: true, write: true, rateLimit: { max: 120, timeWindow: '1 minute' } },
    },
    async (request) => {
      const { ctx } = request;
      const results: MutationResult[] = [];

      for (const m of request.body.mutations) {
        const stored = (
          await ctx.tdb.select(syncMutations, eq(syncMutations.mutationId, m.mutationId))
        )[0];
        if (stored) {
          results.push(stored.result as MutationResult);
          continue;
        }

        const record = async (tdb: TenantDb, result: MutationResult) => {
          await tdb.insert(syncMutations, {
            tenantId: tdb.tenantId,
            mutationId: m.mutationId,
            deviceId: ctx.device!.id,
            userId: ctx.userId,
            entityType: m.entity,
            entityId: m.id,
            op: m.op,
            status: result.status === 'retry' ? 'rejected' : result.status,
            result,
            clientCreatedAt: new Date(m.clientCreatedAt),
          });
        };

        try {
          const result = await ctx.tdb.transaction(async (tx) => {
            const applied = await applyMutation(tx, ctx, m);
            if (applied.status === 'applied' && applied.changes.length > 0) {
              await recordChanges(tx.db, tx.tenantId, applied.changes);
            }
            const r = toResult(m.mutationId, applied);
            await record(tx, r);
            return r;
          });
          results.push(result);
        } catch (err) {
          const dbCode = mysqlCode(err);
          const known = err instanceof RejectError ? { code: err.code, message: err.message } : dbCode ? DATA_ERRORS[dbCode] : undefined;
          if (!known) {
            // Unknown failure (lock timeout, lost connection…): not stored, the device retries.
            request.log.error({ err, mutationId: m.mutationId }, 'sync mutation failed');
            results.push({ mutationId: m.mutationId, status: 'retry', message: 'Temporary server problem' });
            continue;
          }
          const rejected: MutationResult = { mutationId: m.mutationId, status: 'rejected', code: known.code, message: known.message };
          try {
            await record(ctx.tdb, rejected);
          } catch (recordErr) {
            // A concurrent push already stored a result for this mutation; the next retry returns it.
            if (mysqlCode(recordErr) !== 'ER_DUP_ENTRY') throw recordErr;
          }
          results.push(rejected);
        }
      }

      await ctx.tdb.update(devices, { lastPushAt: new Date(), lastSeenAt: new Date() }, eq(devices.id, ctx.device!.id));
      return { results, serverTime: new Date().toISOString() };
    },
  );

  /** Changes since the device's cursor, with the current state of each changed record. */
  app.get(
    '/pull',
    { schema: { querystring: PullQuery, response: { 200: PullResponse } }, config: { device: true } },
    async (request) => {
      const { ctx } = request;
      const { cursor, limit } = request.query;
      const rows = await ctx.tdb.db
        .select()
        .from(syncChanges)
        .where(and(eq(syncChanges.tenantId, ctx.tenantId), gt(syncChanges.serverSeq, cursor)))
        .orderBy(asc(syncChanges.serverSeq))
        .limit(limit + 1);
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const nextCursor = page.length > 0 ? page[page.length - 1]!.serverSeq : cursor;

      // Keep only the latest change per record, and only what this device's branch may see.
      const latest = new Map<string, (typeof page)[number]>();
      for (const row of page) {
        if (row.branchId && row.branchId !== ctx.device!.branchId) continue;
        if (!(row.entityType in HANDLERS)) continue;
        latest.set(`${row.entityType}|${row.entityId}`, row);
      }
      const byEntity = new Map<PullableEntity, string[]>();
      for (const row of latest.values()) {
        const entity = row.entityType as PullableEntity;
        byEntity.set(entity, [...(byEntity.get(entity) ?? []), row.entityId]);
      }
      const loaded = new Map<string, Record<string, unknown>>();
      for (const [entity, ids] of byEntity) {
        const data = await HANDLERS[entity].load(ctx.tdb, ids);
        for (const [id, value] of data) loaded.set(`${entity}|${id}`, value);
      }

      const changes: Change[] = [...latest.values()]
        .sort((a, b) => a.serverSeq - b.serverSeq)
        .map((row) => {
          const data = loaded.get(`${row.entityType}|${row.entityId}`) ?? null;
          if (data && row.entityType === 'inventory_balance' && !canViewInventoryCost(ctx)) {
            delete data.avgCost;
            delete data.stockValue;
          }
          return {
            seq: row.serverSeq,
            entity: row.entityType as PullableEntity,
            op: row.op === 'delete' || !data ? ('delete' as const) : ('upsert' as const),
            id: row.entityId,
            data,
          };
        });

      await ctx.tdb.update(devices, { lastPulledSeq: nextCursor, lastSeenAt: new Date() }, eq(devices.id, ctx.device!.id));
      return { changes, nextCursor, hasMore, serverTime: new Date().toISOString() };
    },
  );

  /**
   * Full current state for a new device, read in one consistent snapshot together with the
   * cursor, so pulling from that cursor afterwards misses nothing.
   */
  app.get('/snapshot', { schema: { response: { 200: SnapshotResponse } }, config: { device: true } }, async (request) => {
    const { ctx } = request;
    return app.db.transaction(
      async (tx) => {
        const tdb = new TenantDb(tx, ctx.tenantId);
        const counter = await tdb.select(tenantSyncCounters);
        const entities: Record<string, Record<string, unknown>[]> = {};
        for (const entity of SNAPSHOT_ORDER) {
          const handler = HANDLERS[entity];
          if (handler.loadAll) entities[entity] = await handler.loadAll(tdb, ctx.device!.branchId);
        }
        if (!canViewInventoryCost(ctx)) {
          for (const balance of entities.inventory_balance ?? []) {
            delete balance.avgCost;
            delete balance.stockValue;
          }
        }
        return { cursor: counter[0]?.lastSeq ?? 0, entities, serverTime: new Date().toISOString() };
      },
      { isolationLevel: 'repeatable read', withConsistentSnapshot: true, accessMode: 'read only' },
    );
  });
};

function canViewInventoryCost(ctx: RequestContext): boolean {
  return ctx.permissions.has('products.view_cost') || ctx.permissions.has('inventory.view_value');
}
