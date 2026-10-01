import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  int,
  json,
  mysqlTable,
  primaryKey,
  text,
  varchar,
} from 'drizzle-orm/mysql-core';
import { nowMs, ts, uuid } from './columns.js';

/** Server change log that devices pull from (docs/phase-1/02 §3.2). */
export const syncChanges = mysqlTable(
  'sync_changes',
  {
    tenantId: uuid('tenant_id').notNull(),
    serverSeq: bigint('server_seq', { mode: 'number' }).notNull(),
    entityType: varchar('entity_type', { length: 40 }).notNull(),
    entityId: varchar('entity_id', { length: 120 }).notNull(),
    branchId: uuid('branch_id'),
    op: varchar('op', { length: 10 }).notNull(),
    version: int('version').notNull().default(1),
    changedAt: ts('changed_at').notNull().default(nowMs),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.serverSeq] }),
    check('sync_changes_op_ck', sql`${t.op} in ('upsert','delete')`),
  ],
);

/** Idempotency log: one row per pushed mutation id. A repeated push returns the stored result. */
export const syncMutations = mysqlTable(
  'sync_mutations',
  {
    tenantId: uuid('tenant_id').notNull(),
    mutationId: uuid('mutation_id').notNull(),
    deviceId: uuid('device_id').notNull(),
    userId: uuid('user_id').notNull(),
    entityType: varchar('entity_type', { length: 40 }).notNull(),
    entityId: varchar('entity_id', { length: 120 }),
    op: varchar('op', { length: 20 }).notNull(),
    status: varchar('status', { length: 20 }).notNull(),
    result: json('result'),
    clientCreatedAt: ts('client_created_at'),
    receivedAt: ts('received_at').notNull().default(nowMs),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.mutationId] }),
    index('sync_mutations_device_idx').on(t.tenantId, t.deviceId, t.receivedAt),
    check('sync_mutations_status_ck', sql`${t.status} in ('applied','rejected','conflict')`),
  ],
);

export const syncConflicts = mysqlTable(
  'sync_conflicts',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    mutationId: uuid('mutation_id').notNull(),
    entityType: varchar('entity_type', { length: 40 }).notNull(),
    entityId: varchar('entity_id', { length: 120 }).notNull(),
    baseVersion: int('base_version').notNull(),
    serverVersion: int('server_version').notNull(),
    clientChanges: json('client_changes').notNull(),
    serverState: json('server_state').notNull(),
    status: varchar('status', { length: 20 }).notNull().default('open'),
    resolvedBy: uuid('resolved_by'),
    resolvedAt: ts('resolved_at'),
    createdAt: ts('created_at').notNull().default(nowMs),
  },
  (t) => [
    index('sync_conflicts_open_idx').on(t.tenantId, t.status),
    check('sync_conflicts_status_ck', sql`${t.status} in ('open','resolved_client','resolved_server')`),
  ],
);

/** Tenant audit trail. The app's DB user may only INSERT and SELECT here. */
export const auditLogs = mysqlTable(
  'audit_logs',
  {
    id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id'),
    adminId: uuid('admin_id'),
    deviceId: uuid('device_id'),
    ip: varchar('ip', { length: 45 }),
    userAgent: varchar('user_agent', { length: 255 }),
    action: varchar('action', { length: 80 }).notNull(),
    entityType: varchar('entity_type', { length: 40 }),
    entityId: varchar('entity_id', { length: 120 }),
    before: json('before'),
    after: json('after'),
    reason: text('reason'),
    occurredAt: ts('occurred_at').notNull().default(nowMs),
    createdAt: ts('created_at').notNull().default(nowMs),
  },
  (t) => [
    index('audit_logs_tenant_idx').on(t.tenantId, t.createdAt),
    index('audit_logs_entity_idx').on(t.tenantId, t.entityType, t.entityId),
  ],
);

/** Background job queue (no Redis): workers claim rows with SELECT … FOR UPDATE SKIP LOCKED. */
export const jobs = mysqlTable(
  'jobs',
  {
    id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
    tenantId: uuid('tenant_id'),
    queue: varchar('queue', { length: 40 }).notNull().default('default'),
    name: varchar('name', { length: 80 }).notNull(),
    payload: json('payload'),
    status: varchar('status', { length: 20 }).notNull().default('queued'),
    attempts: int('attempts').notNull().default(0),
    maxAttempts: int('max_attempts').notNull().default(5),
    runAt: ts('run_at').notNull().default(nowMs),
    lockedAt: ts('locked_at'),
    lockedBy: varchar('locked_by', { length: 80 }),
    lastError: text('last_error'),
    createdAt: ts('created_at').notNull().default(nowMs),
    finishedAt: ts('finished_at'),
  },
  (t) => [
    index('jobs_claim_idx').on(t.status, t.queue, t.runAt),
    check('jobs_status_ck', sql`${t.status} in ('queued','running','done','failed')`),
  ],
);

export const importJobs = mysqlTable(
  'import_jobs',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    kind: varchar('kind', { length: 20 }).notNull(),
    fileKey: varchar('file_key', { length: 255 }),
    status: varchar('status', { length: 20 }).notNull().default('uploaded'),
    totalRows: int('total_rows').notNull().default(0),
    validRows: int('valid_rows').notNull().default(0),
    errorRows: int('error_rows').notNull().default(0),
    options: json('options'),
    createdBy: uuid('created_by'),
    createdAt: ts('created_at').notNull().default(nowMs),
    finishedAt: ts('finished_at'),
  },
  (t) => [
    index('import_jobs_tenant_idx').on(t.tenantId, t.createdAt),
    check(
      'import_jobs_kind_ck',
      sql`${t.kind} in ('products','opening_stock','customers','suppliers','prices')`,
    ),
    check(
      'import_jobs_status_ck',
      sql`${t.status} in ('uploaded','validating','validated','importing','done','failed')`,
    ),
  ],
);

export const importJobRows = mysqlTable(
  'import_job_rows',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    jobId: uuid('job_id').notNull(),
    rowNo: int('row_no').notNull(),
    data: json('data').notNull(),
    errors: json('errors'),
    status: varchar('status', { length: 20 }).notNull(),
  },
  (t) => [
    index('import_job_rows_job_idx').on(t.tenantId, t.jobId, t.rowNo),
    check('import_job_rows_status_ck', sql`${t.status} in ('valid','error','imported','skipped')`),
  ],
);
