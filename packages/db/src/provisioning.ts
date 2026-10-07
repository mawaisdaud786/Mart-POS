import {
  FEATURES,
  PERMISSIONS,
  SENSITIVE_PERMISSIONS,
  SYSTEM_ROLES,
  SYSTEM_UNITS,
  DEFAULT_PLANS,
  newId,
  type SystemRoleKey,
} from '@retailos/domain';
import { and, eq, isNull } from 'drizzle-orm';
import type { Database, DbOrTx } from './client.js';
import { recordChanges, type ChangeRecord } from './change-log.js';
import {
  branches,
  features,
  permissions,
  planFeatures,
  plans,
  rolePermissions,
  roles,
  settings,
  subscriptionEvents,
  subscriptions,
  tenantMemberships,
  tenantProfiles,
  tenantSyncCounters,
  tenants,
  units,
  users,
  ZERO_UUID,
} from './schema/index.js';

/** Global reference data: features, plans, permissions, system units. Safe to run repeatedly. */
export async function seedReferenceData(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    for (const [key, name] of Object.entries(FEATURES)) {
      await tx.insert(features).values({ key, module: key, name }).onDuplicateKeyUpdate({ set: { name } });
    }
    for (const [module, keys] of Object.entries(PERMISSIONS)) {
      for (const key of keys) {
        await tx
          .insert(permissions)
          .values({ key, module, isSensitive: SENSITIVE_PERMISSIONS.has(key) })
          .onDuplicateKeyUpdate({ set: { module, isSensitive: SENSITIVE_PERMISSIONS.has(key) } });
      }
    }
    for (const [i, plan] of DEFAULT_PLANS.entries()) {
      const existing = await tx.select({ id: plans.id }).from(plans).where(eq(plans.code, plan.code));
      const planId = existing[0]?.id ?? newId();
      if (!existing[0]) {
        await tx.insert(plans).values({
          id: planId,
          code: plan.code,
          name: plan.name,
          trialDays: plan.trialDays,
          limits: plan.limits,
          sort: i,
        });
        await tx.insert(planFeatures).values(plan.features.map((featureKey) => ({ planId, featureKey })));
      }
    }
    for (const u of SYSTEM_UNITS) {
      const existing = await tx
        .select({ id: units.id })
        .from(units)
        .where(and(isNull(units.tenantId), eq(units.code, u.code)));
      if (existing[0]) continue;
      await tx.insert(units).values({
        id: newId(),
        tenantId: null,
        code: u.code,
        name: u.name,
        nameUr: u.nameUr,
        kind: u.kind,
        baseCode: u.baseCode ?? null,
        factorToBase: u.factorToBase != null ? String(u.factorToBase) : null,
      });
    }
  });
}

export interface ProvisionTenantInput {
  name: string;
  slug: string;
  planCode: string;
  owner: { name: string; phone?: string | null; email?: string | null; passwordHash: string };
  branchName?: string;
  /** Existing user id to attach as owner instead of creating one. */
  existingUserId?: string;
  trialDays?: number;
}

export interface ProvisionedTenant {
  tenantId: string;
  branchId: string;
  ownerUserId: string;
  ownerMembershipId: string;
  roleIds: Record<SystemRoleKey, string>;
}

/** Default tenant settings (docs/phase-1/03 settings). */
export const DEFAULT_SETTINGS: Record<string, unknown> = {
  'pos.allow_negative_stock': true,
  'pos.cashier_max_discount_percent': 5,
  'cash.discrepancy_threshold': 50000, // Rs 500 → explanation required
  'reorder.default_lead_time_days': 2,
  'reorder.default_review_days': 7,
  'reorder.safety_days': 2,
  'reinvest.min_cash_reserve': 2000000, // Rs 20,000
  'sync.offline_session_hours': 72,
  'sync.document_window_days': 90,
  'ghar.discount_percent': 5,
  'ghar.minimum_margin_percent': 10,
  'ghar.delivery_fee': 15000,
  'ghar.free_delivery_threshold': 400000,
};

/**
 * Create a tenant with everything a shop needs to start: subscription (trial), profile,
 * default branch, role templates, owner membership and default settings.
 */
export async function provisionTenant(db: Database, input: ProvisionTenantInput): Promise<ProvisionedTenant> {
  return db.transaction(async (tx) => {
    const planRows = await tx.select().from(plans).where(eq(plans.code, input.planCode));
    const plan = planRows[0];
    if (!plan) throw new Error(`Unknown plan: ${input.planCode}`);

    const tenantId = newId();
    const now = new Date();
    const trialDays = input.trialDays ?? plan.trialDays;
    const trialEnds = new Date(now.getTime() + trialDays * 86_400_000);

    await tx.insert(tenants).values({ id: tenantId, slug: input.slug, name: input.name });
    await tx.insert(tenantSyncCounters).values({ tenantId, lastSeq: 0 });

    const subscriptionId = newId();
    await tx.insert(subscriptions).values({
      id: subscriptionId,
      tenantId,
      planId: plan.id,
      status: 'trialing',
      trialEndsAt: trialEnds,
      currentPeriodStart: now,
      currentPeriodEnd: trialEnds,
    });
    await tx.insert(subscriptionEvents).values({
      id: newId(),
      subscriptionId,
      tenantId,
      event: 'trial_started',
      toStatus: 'trialing',
      data: { plan: plan.code, trialDays },
    });

    await tx.insert(tenantProfiles).values({ tenantId, shopName: input.name });

    const changes: ChangeRecord[] = [];
    const branchId = newId();
    await tx.insert(branches).values({
      id: branchId,
      tenantId,
      code: 'MAIN',
      name: input.branchName ?? 'Main Branch',
      isDefault: true,
    });
    changes.push({ entityType: 'branch', entityId: branchId, op: 'upsert' });

    const roleIds = {} as Record<SystemRoleKey, string>;
    for (const [key, role] of Object.entries(SYSTEM_ROLES) as [SystemRoleKey, (typeof SYSTEM_ROLES)[SystemRoleKey]][]) {
      const roleId = newId();
      roleIds[key] = roleId;
      await tx.insert(roles).values({ id: roleId, tenantId, name: role.name, isSystem: true, systemKey: key });
      await tx
        .insert(rolePermissions)
        .values(role.permissions.map((permissionKey) => ({ tenantId, roleId, permissionKey })));
      changes.push({ entityType: 'role', entityId: roleId, op: 'upsert' });
    }

    let ownerUserId = input.existingUserId;
    if (!ownerUserId) {
      ownerUserId = newId();
      await tx.insert(users).values({
        id: ownerUserId,
        name: input.owner.name,
        phone: input.owner.phone ?? null,
        email: input.owner.email?.toLowerCase() ?? null,
        passwordHash: input.owner.passwordHash,
      });
    }
    const ownerMembershipId = newId();
    await tx.insert(tenantMemberships).values({
      id: ownerMembershipId,
      tenantId,
      userId: ownerUserId,
      roleId: roleIds.owner,
      displayName: input.owner.name,
    });
    changes.push({ entityType: 'membership', entityId: ownerMembershipId, op: 'upsert' });

    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      await tx.insert(settings).values({ tenantId, scopeBranchId: ZERO_UUID, key, value });
      changes.push({ entityType: 'setting', entityId: key, op: 'upsert' });
    }

    await recordChanges(tx as DbOrTx, tenantId, changes);
    return { tenantId, branchId, ownerUserId, ownerMembershipId, roleIds };
  });
}
