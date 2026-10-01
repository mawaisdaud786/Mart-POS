import { resolveEntitlements, type FeatureKey, type Permission, type PlanLimits } from '@retailos/domain';
import { TenantDb, schema, type Database } from '@retailos/db';
import { and, eq, isNull } from 'drizzle-orm';
import type { AccessClaims } from './tokens.js';

const {
  devices,
  planFeatures,
  plans,
  rolePermissions,
  roles,
  subscriptions,
  tenantMemberships,
  tenants,
  users,
} = schema;

export interface SubscriptionState {
  status: string;
  /** Expired/ended subscriptions can view and export, but not create new records. */
  readOnly: boolean;
  periodEnd: Date | null;
}

export interface RequestContext {
  userId: string;
  userName: string;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  membershipId: string;
  roleId: string;
  roleName: string;
  permissions: ReadonlySet<Permission>;
  features: ReadonlySet<FeatureKey>;
  limits: PlanLimits;
  subscription: SubscriptionState;
  device: { id: string; code: string; branchId: string } | null;
  tdb: TenantDb;
}

export class ContextError extends Error {
  constructor(
    readonly code: 'MEMBERSHIP_INACTIVE' | 'TENANT_SUSPENDED' | 'DEVICE_REVOKED' | 'USER_DISABLED',
    message: string,
  ) {
    super(message);
  }
}

export function subscriptionState(
  row: { status: string; trialEndsAt: Date | null; currentPeriodEnd: Date | null; graceEndsAt: Date | null } | undefined,
  now = new Date(),
): SubscriptionState {
  if (!row) return { status: 'expired', readOnly: true, periodEnd: null };
  const periodEnd = row.currentPeriodEnd;
  let readOnly = row.status === 'expired' || row.status === 'suspended';
  if (row.status === 'trialing' && row.trialEndsAt && row.trialEndsAt < now) readOnly = true;
  if (row.status === 'past_due' && row.graceEndsAt && row.graceEndsAt < now) readOnly = true;
  if (row.status === 'cancelled' && periodEnd && periodEnd < now) readOnly = true;
  return { status: row.status, readOnly, periodEnd };
}

type CachedContext = Omit<RequestContext, 'tdb'> & { expiresAt: number };
const cache = new Map<string, CachedContext>();
const TTL_MS = 30_000;

/** Drop cached contexts for a tenant (after role, device or subscription changes). */
export function invalidateContextCache(tenantId?: string): void {
  if (!tenantId) return cache.clear();
  for (const [key, value] of cache) if (value.tenantId === tenantId) cache.delete(key);
}

/**
 * Build the request context from verified token claims. The tenant id comes only from the
 * token, and the membership must still be active: a token for a removed user stops working
 * within the cache TTL even before it expires.
 */
export async function loadContext(db: Database, claims: AccessClaims): Promise<RequestContext> {
  const key = `${claims.mid}:${claims.did ?? '-'}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now() && hit.tenantId === claims.tid && hit.userId === claims.sub) {
    const { expiresAt: _e, ...ctx } = hit;
    return { ...ctx, tdb: new TenantDb(db, ctx.tenantId) };
  }

  const rows = await db
    .select({
      membershipId: tenantMemberships.id,
      membershipStatus: tenantMemberships.status,
      roleId: roles.id,
      roleName: roles.name,
      userName: users.name,
      userStatus: users.status,
      tenantName: tenants.name,
      tenantSlug: tenants.slug,
      tenantStatus: tenants.status,
    })
    .from(tenantMemberships)
    .innerJoin(users, eq(users.id, tenantMemberships.userId))
    .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
    .innerJoin(roles, and(eq(roles.tenantId, tenantMemberships.tenantId), eq(roles.id, tenantMemberships.roleId)))
    .where(
      and(
        eq(tenantMemberships.id, claims.mid),
        eq(tenantMemberships.tenantId, claims.tid),
        eq(tenantMemberships.userId, claims.sub),
        isNull(tenantMemberships.deletedAt),
      ),
    );
  const m = rows[0];
  if (!m || m.membershipStatus !== 'active') throw new ContextError('MEMBERSHIP_INACTIVE', 'Membership is not active');
  if (m.userStatus !== 'active') throw new ContextError('USER_DISABLED', 'User is disabled');
  if (m.tenantStatus !== 'active') throw new ContextError('TENANT_SUSPENDED', 'This shop account is suspended');

  const permRows = await db
    .select({ key: rolePermissions.permissionKey })
    .from(rolePermissions)
    .where(and(eq(rolePermissions.tenantId, claims.tid), eq(rolePermissions.roleId, m.roleId)));

  const subRows = await db
    .select({
      status: subscriptions.status,
      trialEndsAt: subscriptions.trialEndsAt,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      graceEndsAt: subscriptions.graceEndsAt,
      overrides: subscriptions.overrides,
      planId: plans.id,
      limits: plans.limits,
    })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(and(eq(subscriptions.tenantId, claims.tid), eq(subscriptions.isCurrent, true)));
  const sub = subRows[0];
  const featureRows = sub
    ? await db.select({ key: planFeatures.featureKey }).from(planFeatures).where(eq(planFeatures.planId, sub.planId))
    : [];
  const entitlements = resolveEntitlements(
    featureRows.map((f) => f.key),
    (sub?.limits as PlanLimits) ?? { users: 0, branches: 0, devices: 0, products: 0, storageMb: 0 },
    sub?.overrides as Parameters<typeof resolveEntitlements>[2],
  );

  let device: RequestContext['device'] = null;
  if (claims.did) {
    const d = (
      await db
        .select({ id: devices.id, code: devices.code, branchId: devices.branchId, status: devices.status })
        .from(devices)
        .where(and(eq(devices.id, claims.did), eq(devices.tenantId, claims.tid)))
    )[0];
    if (!d || d.status !== 'active') throw new ContextError('DEVICE_REVOKED', 'This device has been revoked');
    device = { id: d.id, code: d.code, branchId: d.branchId };
  }

  const ctx: Omit<RequestContext, 'tdb'> = {
    userId: claims.sub,
    userName: m.userName,
    tenantId: claims.tid,
    tenantName: m.tenantName,
    tenantSlug: m.tenantSlug,
    membershipId: m.membershipId,
    roleId: m.roleId,
    roleName: m.roleName,
    permissions: new Set(permRows.map((p) => p.key as Permission)),
    features: entitlements.features,
    limits: entitlements.limits,
    subscription: subscriptionState(sub),
    device,
  };
  cache.set(key, { ...ctx, expiresAt: Date.now() + TTL_MS });
  return { ...ctx, tdb: new TenantDb(db, ctx.tenantId) };
}
