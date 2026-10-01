import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  int,
  json,
  mysqlTable,
  primaryKey,
  tinyint,
  uniqueIndex,
  varchar,
  text,
  varbinary,
} from 'drizzle-orm/mysql-core';
import { money, nowMs, ts, uuid } from './columns.js';

export const platformSettings = mysqlTable('platform_settings', {
  key: varchar('key', { length: 100 }).primaryKey(),
  value: json('value').notNull(),
  updatedAt: ts('updated_at').notNull().default(nowMs),
  updatedBy: uuid('updated_by'),
});

export const platformAdmins = mysqlTable(
  'platform_admins',
  {
    id: uuid('id').primaryKey(),
    name: varchar('name', { length: 120 }).notNull(),
    email: varchar('email', { length: 190 }).notNull(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    totpSecretEnc: varbinary('totp_secret_enc', { length: 255 }),
    role: varchar('role', { length: 20 }).notNull().default('support'),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    lastLoginAt: ts('last_login_at'),
    createdAt: ts('created_at').notNull().default(nowMs),
  },
  (t) => [
    uniqueIndex('platform_admins_email_uq').on(t.email),
    check('platform_admins_role_ck', sql`${t.role} in ('super','support','billing')`),
    check('platform_admins_status_ck', sql`${t.status} in ('active','disabled')`),
  ],
);

export const features = mysqlTable('features', {
  key: varchar('key', { length: 60 }).primaryKey(),
  module: varchar('module', { length: 60 }).notNull(),
  name: varchar('name', { length: 120 }).notNull(),
  description: text('description'),
});

export const plans = mysqlTable(
  'plans',
  {
    id: uuid('id').primaryKey(),
    code: varchar('code', { length: 40 }).notNull(),
    name: varchar('name', { length: 80 }).notNull(),
    description: text('description'),
    currency: varchar('currency', { length: 3 }).notNull().default('PKR'),
    priceMonthly: money('price_monthly').notNull().default(0),
    priceYearly: money('price_yearly').notNull().default(0),
    trialDays: int('trial_days').notNull().default(14),
    limits: json('limits').notNull(),
    isPublic: boolean('is_public').notNull().default(true),
    sort: int('sort').notNull().default(0),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    createdAt: ts('created_at').notNull().default(nowMs),
    updatedAt: ts('updated_at').notNull().default(nowMs),
  },
  (t) => [uniqueIndex('plans_code_uq').on(t.code)],
);

export const planFeatures = mysqlTable(
  'plan_features',
  {
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'cascade' }),
    featureKey: varchar('feature_key', { length: 60 })
      .notNull()
      .references(() => features.key),
  },
  (t) => [primaryKey({ columns: [t.planId, t.featureKey] })],
);

export const tenants = mysqlTable(
  'tenants',
  {
    id: uuid('id').primaryKey(),
    slug: varchar('slug', { length: 60 }).notNull(),
    name: varchar('name', { length: 150 }).notNull(),
    legalName: varchar('legal_name', { length: 200 }),
    businessType: varchar('business_type', { length: 40 }).notNull().default('karyana'),
    country: varchar('country', { length: 2 }).notNull().default('PK'),
    currency: varchar('currency', { length: 3 }).notNull().default('PKR'),
    timezone: varchar('timezone', { length: 50 }).notNull().default('Asia/Karachi'),
    defaultLocale: varchar('default_locale', { length: 10 }).notNull().default('en'),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    suspendedReason: text('suspended_reason'),
    createdAt: ts('created_at').notNull().default(nowMs),
    archivedAt: ts('archived_at'),
  },
  (t) => [
    uniqueIndex('tenants_slug_uq').on(t.slug),
    check('tenants_status_ck', sql`${t.status} in ('active','suspended','archived')`),
  ],
);

/** Gap-free per-tenant change sequence (docs/phase-1/02 §3.2). */
export const tenantSyncCounters = mysqlTable('tenant_sync_counters', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id),
  lastSeq: bigint('last_seq', { mode: 'number' }).notNull().default(0),
});

export const subscriptions = mysqlTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id),
    status: varchar('status', { length: 20 }).notNull(),
    billingCycle: varchar('billing_cycle', { length: 10 }).notNull().default('monthly'),
    trialEndsAt: ts('trial_ends_at'),
    currentPeriodStart: ts('current_period_start'),
    currentPeriodEnd: ts('current_period_end'),
    graceEndsAt: ts('grace_ends_at'),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    priceOverride: money('price_override'),
    overrides: json('overrides'),
    isCurrent: boolean('is_current').notNull().default(true),
    currentKey: tinyint('current_key').generatedAlwaysAs(sql`(if(\`is_current\`, 1, null))`, { mode: 'stored' }),
    createdAt: ts('created_at').notNull().default(nowMs),
    updatedAt: ts('updated_at').notNull().default(nowMs),
  },
  (t) => [
    uniqueIndex('subscriptions_current_uq').on(t.tenantId, t.currentKey),
    check(
      'subscriptions_status_ck',
      sql`${t.status} in ('trialing','active','past_due','expired','suspended','cancelled')`,
    ),
    check('subscriptions_cycle_ck', sql`${t.billingCycle} in ('monthly','yearly','custom')`),
  ],
);

export const subscriptionEvents = mysqlTable(
  'subscription_events',
  {
    id: uuid('id').primaryKey(),
    subscriptionId: uuid('subscription_id')
      .notNull()
      .references(() => subscriptions.id),
    tenantId: uuid('tenant_id').notNull(),
    event: varchar('event', { length: 30 }).notNull(),
    fromStatus: varchar('from_status', { length: 20 }),
    toStatus: varchar('to_status', { length: 20 }),
    data: json('data'),
    actorAdminId: uuid('actor_admin_id'),
    createdAt: ts('created_at').notNull().default(nowMs),
  },
  (t) => [index('subscription_events_tenant_idx').on(t.tenantId, t.createdAt)],
);

export const adminAccessGrants = mysqlTable(
  'admin_access_grants',
  {
    id: uuid('id').primaryKey(),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => platformAdmins.id),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    reason: text('reason').notNull(),
    scope: varchar('scope', { length: 10 }).notNull().default('read'),
    grantedAt: ts('granted_at').notNull().default(nowMs),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
  },
  (t) => [check('admin_access_grants_scope_ck', sql`${t.scope} in ('read','write')`)],
);

export const platformAuditLogs = mysqlTable(
  'platform_audit_logs',
  {
    id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
    adminId: uuid('admin_id'),
    tenantId: uuid('tenant_id'),
    action: varchar('action', { length: 80 }).notNull(),
    targetType: varchar('target_type', { length: 60 }),
    targetId: varchar('target_id', { length: 64 }),
    before: json('before'),
    after: json('after'),
    ip: varbinary('ip', { length: 16 }),
    userAgent: varchar('user_agent', { length: 255 }),
    createdAt: ts('created_at').notNull().default(nowMs),
  },
  (t) => [index('platform_audit_logs_tenant_idx').on(t.tenantId, t.createdAt)],
);
