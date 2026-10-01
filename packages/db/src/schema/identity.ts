import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  json,
  mysqlTable,
  primaryKey,
  text,
  tinyint,
  uniqueIndex,
  varchar,
  int,
} from 'drizzle-orm/mysql-core';
import { activeKeySql, nowMs, syncColumns, ts, uuid } from './columns.js';
import { tenants } from './platform.js';

/** Global login identity. A user can belong to several shops through memberships. */
export const users = mysqlTable(
  'users',
  {
    id: uuid('id').primaryKey(),
    name: varchar('name', { length: 120 }).notNull(),
    phone: varchar('phone', { length: 20 }),
    email: varchar('email', { length: 190 }),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    preferredLocale: varchar('preferred_locale', { length: 10 }),
    lastLoginAt: ts('last_login_at'),
    createdAt: ts('created_at').notNull().default(nowMs),
    updatedAt: ts('updated_at').notNull().default(nowMs),
  },
  (t) => [
    uniqueIndex('users_phone_uq').on(t.phone),
    uniqueIndex('users_email_uq').on(t.email),
    check('users_login_ck', sql`${t.phone} is not null or ${t.email} is not null`),
    check('users_status_ck', sql`${t.status} in ('active','disabled')`),
  ],
);

export const permissions = mysqlTable('permissions', {
  key: varchar('key', { length: 60 }).primaryKey(),
  module: varchar('module', { length: 40 }).notNull(),
  description: varchar('description', { length: 255 }),
  isSensitive: boolean('is_sensitive').notNull().default(false),
});

export const roles = mysqlTable(
  'roles',
  {
    ...syncColumns(),
    name: varchar('name', { length: 80 }).notNull(),
    description: varchar('description', { length: 255 }),
    isSystem: boolean('is_system').notNull().default(false),
    systemKey: varchar('system_key', { length: 40 }),
  },
  (t) => [
    uniqueIndex('roles_tenant_id_uq').on(t.tenantId, t.id),
    uniqueIndex('roles_system_key_uq').on(t.tenantId, t.systemKey),
    index('roles_seq_idx').on(t.tenantId, t.serverSeq),
    foreignKey({ name: 'fk_roles_tenant', columns: [t.tenantId], foreignColumns: [tenants.id] }),
  ],
);

export const rolePermissions = mysqlTable(
  'role_permissions',
  {
    tenantId: uuid('tenant_id').notNull(),
    roleId: uuid('role_id').notNull(),
    permissionKey: varchar('permission_key', { length: 60 })
      .notNull()
      .references(() => permissions.key),
  },
  (t) => [
    primaryKey({ columns: [t.roleId, t.permissionKey] }),
    index('role_permissions_tenant_idx').on(t.tenantId),
    foreignKey({
      name: 'fk_role_permissions_role',
      columns: [t.tenantId, t.roleId],
      foreignColumns: [roles.tenantId, roles.id],
    }).onDelete('cascade'),
  ],
);

export const tenantMemberships = mysqlTable(
  'tenant_memberships',
  {
    ...syncColumns(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    roleId: uuid('role_id').notNull(),
    displayName: varchar('display_name', { length: 120 }),
    pinHash: varchar('pin_hash', { length: 255 }),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    allBranches: boolean('all_branches').notNull().default(true),
    joinedAt: ts('joined_at').notNull().default(nowMs),
  },
  (t) => [
    uniqueIndex('tenant_memberships_tenant_id_uq').on(t.tenantId, t.id),
    uniqueIndex('tenant_memberships_user_uq').on(t.tenantId, t.userId),
    index('tenant_memberships_user_idx').on(t.userId),
    index('tenant_memberships_seq_idx').on(t.tenantId, t.serverSeq),
    foreignKey({ name: 'fk_memberships_tenant', columns: [t.tenantId], foreignColumns: [tenants.id] }),
    foreignKey({
      name: 'fk_memberships_role',
      columns: [t.tenantId, t.roleId],
      foreignColumns: [roles.tenantId, roles.id],
    }),
    check('tenant_memberships_status_ck', sql`${t.status} in ('invited','active','disabled')`),
  ],
);

export const branches = mysqlTable(
  'branches',
  {
    ...syncColumns(),
    code: varchar('code', { length: 10 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    address: varchar('address', { length: 255 }),
    phone: varchar('phone', { length: 20 }),
    isDefault: boolean('is_default').notNull().default(false),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    activeKey: tinyint('active_key').generatedAlwaysAs(activeKeySql, { mode: 'stored' }),
  },
  (t) => [
    uniqueIndex('branches_tenant_id_uq').on(t.tenantId, t.id),
    uniqueIndex('branches_code_uq').on(t.tenantId, t.code, t.activeKey),
    index('branches_seq_idx').on(t.tenantId, t.serverSeq),
    foreignKey({ name: 'fk_branches_tenant', columns: [t.tenantId], foreignColumns: [tenants.id] }),
  ],
);

export const membershipBranches = mysqlTable(
  'membership_branches',
  {
    tenantId: uuid('tenant_id').notNull(),
    membershipId: uuid('membership_id').notNull(),
    branchId: uuid('branch_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.membershipId, t.branchId] }),
    foreignKey({
      name: 'fk_membership_branches_membership',
      columns: [t.tenantId, t.membershipId],
      foreignColumns: [tenantMemberships.tenantId, tenantMemberships.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_membership_branches_branch',
      columns: [t.tenantId, t.branchId],
      foreignColumns: [branches.tenantId, branches.id],
    }),
  ],
);

export const devices = mysqlTable(
  'devices',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    code: varchar('code', { length: 3 }).notNull(),
    name: varchar('name', { length: 80 }).notNull(),
    platform: varchar('platform', { length: 40 }),
    userAgent: varchar('user_agent', { length: 255 }),
    registeredBy: uuid('registered_by'),
    registeredAt: ts('registered_at').notNull().default(nowMs),
    lastSeenAt: ts('last_seen_at'),
    lastPushAt: ts('last_push_at'),
    lastPulledSeq: bigint('last_pulled_seq', { mode: 'number' }).notNull().default(0),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    revokedAt: ts('revoked_at'),
    revokedBy: uuid('revoked_by'),
  },
  (t) => [
    uniqueIndex('devices_tenant_id_uq').on(t.tenantId, t.id),
    uniqueIndex('devices_code_uq').on(t.tenantId, t.code),
    foreignKey({
      name: 'fk_devices_branch',
      columns: [t.tenantId, t.branchId],
      foreignColumns: [branches.tenantId, branches.id],
    }),
    check('devices_status_ck', sql`${t.status} in ('active','revoked')`),
  ],
);

export const refreshTokens = mysqlTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    tenantId: uuid('tenant_id').notNull(),
    deviceId: uuid('device_id'),
    familyId: uuid('family_id').notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    issuedAt: ts('issued_at').notNull().default(nowMs),
    expiresAt: ts('expires_at').notNull(),
    rotatedAt: ts('rotated_at'),
    revokedAt: ts('revoked_at'),
    revokeReason: varchar('revoke_reason', { length: 40 }),
    ip: varchar('ip', { length: 45 }),
    userAgent: varchar('user_agent', { length: 255 }),
  },
  (t) => [
    uniqueIndex('refresh_tokens_hash_uq').on(t.tokenHash),
    index('refresh_tokens_family_idx').on(t.familyId),
    index('refresh_tokens_user_idx').on(t.userId),
  ],
);

export const loginAttempts = mysqlTable(
  'login_attempts',
  {
    id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
    identifier: varchar('identifier', { length: 190 }).notNull(),
    ip: varchar('ip', { length: 45 }),
    success: boolean('success').notNull(),
    createdAt: ts('created_at').notNull().default(nowMs),
  },
  (t) => [index('login_attempts_identifier_idx').on(t.identifier, t.createdAt)],
);

export const tenantProfiles = mysqlTable(
  'tenant_profiles',
  {
    tenantId: uuid('tenant_id')
      .primaryKey()
      .references(() => tenants.id),
    shopName: varchar('shop_name', { length: 150 }).notNull(),
    shopNameUr: varchar('shop_name_ur', { length: 150 }),
    logoKey: varchar('logo_key', { length: 255 }),
    primaryColor: varchar('primary_color', { length: 9 }),
    phone: varchar('phone', { length: 20 }),
    whatsapp: varchar('whatsapp', { length: 20 }),
    email: varchar('email', { length: 190 }),
    address: varchar('address', { length: 255 }),
    addressUr: varchar('address_ur', { length: 255 }),
    ntn: varchar('ntn', { length: 20 }),
    strn: varchar('strn', { length: 20 }),
    receiptHeader: text('receipt_header'),
    receiptFooter: text('receipt_footer'),
    receiptWidthMm: int('receipt_width_mm').notNull().default(80),
    version: int('version').notNull().default(1),
    serverSeq: bigint('server_seq', { mode: 'number' }).notNull().default(0),
    updatedAt: ts('updated_at').notNull().default(nowMs),
  },
  (t) => [check('tenant_profiles_width_ck', sql`${t.receiptWidthMm} in (58, 80)`)],
);

export const settings = mysqlTable(
  'settings',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    /** All-zero UUID = tenant-wide setting (MySQL primary keys can't contain NULL). */
    scopeBranchId: uuid('scope_branch_id').notNull(),
    key: varchar('key', { length: 100 }).notNull(),
    value: json('value').notNull(),
    version: int('version').notNull().default(1),
    serverSeq: bigint('server_seq', { mode: 'number' }).notNull().default(0),
    updatedAt: ts('updated_at').notNull().default(nowMs),
    updatedBy: uuid('updated_by'),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.scopeBranchId, t.key] })],
);

export const attachments = mysqlTable(
  'attachments',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    entityType: varchar('entity_type', { length: 40 }).notNull(),
    entityId: uuid('entity_id'),
    storageKey: varchar('storage_key', { length: 255 }).notNull(),
    mime: varchar('mime', { length: 100 }).notNull(),
    sizeBytes: int('size_bytes').notNull(),
    originalName: varchar('original_name', { length: 255 }),
    uploadedBy: uuid('uploaded_by'),
    createdAt: ts('created_at').notNull().default(nowMs),
  },
  (t) => [index('attachments_entity_idx').on(t.tenantId, t.entityType, t.entityId)],
);

export const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
