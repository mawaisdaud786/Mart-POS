import { hash, verify } from '@node-rs/argon2';
import { newId } from '@retailos/domain';
import { provisionTenant, schema } from '@retailos/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { invalidateContextCache } from '../../lib/context.js';
import { AppError, conflict, notFound, unauthorized } from '../../lib/errors.js';
import { signAdminToken, verifyAdminToken, type AdminClaims } from '../../lib/tokens.js';
import { verifyTotp } from '../../lib/crypto.js';

const { devices, plans, platformAdmins, platformAuditLogs, subscriptions, tenantMemberships, tenants, users } = schema;

declare module 'fastify' {
  interface FastifyRequest {
    admin: AdminClaims;
  }
}

const ADMIN_TOKEN_TTL = 3600;
const DUMMY_HASH = await hash('retailos-dummy-admin');

const TenantSummary = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  status: z.string(),
  createdAt: z.string(),
  plan: z.string().nullable(),
  subscriptionStatus: z.string().nullable(),
  periodEnd: z.string().nullable(),
  users: z.number(),
  devices: z.number(),
});

/**
 * Super Admin API. Separate identity (platform_admins), separate token audience, TOTP required.
 * It manages tenants and subscriptions; it does not read tenant business data.
 */
export const adminRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/auth/login',
    {
      schema: {
        body: z.object({ email: z.email(), password: z.string().min(1), totp: z.string().regex(/^\d{6}$/) }),
        response: { 200: z.object({ accessToken: z.string(), expiresIn: z.number(), name: z.string(), role: z.string() }) },
      },
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (request) => {
      const { email, password, totp } = request.body;
      const admin = (await app.db.select().from(platformAdmins).where(eq(platformAdmins.email, email.toLowerCase())))[0];
      const ok = await verify(admin?.passwordHash ?? DUMMY_HASH, password);
      if (!admin || !ok || admin.status !== 'active') throw new AppError(401, 'INVALID_CREDENTIALS', 'Wrong email or password');
      if (!admin.totpSecretEnc || !verifyTotp(app.encryptor.decrypt(Buffer.from(admin.totpSecretEnc)), totp)) {
        throw new AppError(401, 'INVALID_TOTP', 'Wrong authenticator code');
      }
      await app.db.update(platformAdmins).set({ lastLoginAt: new Date() }).where(eq(platformAdmins.id, admin.id));
      await app.db.insert(platformAuditLogs).values({ adminId: admin.id, action: 'admin.login', userAgent: request.headers['user-agent']?.slice(0, 255) ?? null });
      return {
        accessToken: await signAdminToken(app.keys, { sub: admin.id, role: admin.role }, ADMIN_TOKEN_TTL),
        expiresIn: ADMIN_TOKEN_TTL,
        name: admin.name,
        role: admin.role,
      };
    },
  );

  await app.register(async (scope) => {
    scope.decorateRequest('admin', null as unknown as AdminClaims);
    scope.addHook('onRequest', async (request) => {
      const header = request.headers.authorization;
      if (!header?.startsWith('Bearer ')) throw unauthorized();
      try {
        request.admin = await verifyAdminToken(app.keys, header.slice(7));
      } catch {
        throw new AppError(401, 'TOKEN_INVALID', 'Session expired or invalid');
      }
    });

    const log = (adminId: string, action: string, tenantId: string | null, after?: unknown) =>
      app.db.insert(platformAuditLogs).values({ adminId, action, tenantId, targetType: 'tenant', targetId: tenantId, after: after ?? null });

    scope.get('/plans', { schema: { response: { 200: z.array(z.record(z.string(), z.unknown())) } } }, async () => {
      const rows = await app.db.select().from(plans).orderBy(plans.sort);
      return rows.map((p) => ({ ...p, createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString() }));
    });

    scope.get('/tenants', { schema: { response: { 200: z.array(TenantSummary) } } }, async () => {
      const rows = await app.db
        .select({
          id: tenants.id,
          slug: tenants.slug,
          name: tenants.name,
          status: tenants.status,
          createdAt: tenants.createdAt,
          plan: plans.name,
          subscriptionStatus: subscriptions.status,
          periodEnd: subscriptions.currentPeriodEnd,
          users: sql<number>`(select count(*) from ${tenantMemberships} m where m.tenant_id = ${tenants.id} and m.deleted_at is null)`,
          devices: sql<number>`(select count(*) from ${devices} d where d.tenant_id = ${tenants.id} and d.status = 'active')`,
        })
        .from(tenants)
        .leftJoin(subscriptions, and(eq(subscriptions.tenantId, tenants.id), eq(subscriptions.isCurrent, true)))
        .leftJoin(plans, eq(plans.id, subscriptions.planId))
        .orderBy(desc(tenants.createdAt));
      return rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        periodEnd: r.periodEnd?.toISOString() ?? null,
        users: Number(r.users),
        devices: Number(r.devices),
      }));
    });

    scope.post(
      '/tenants',
      {
        schema: {
          body: z.object({
            name: z.string().trim().min(2).max(150),
            slug: z.string().trim().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(60),
            planCode: z.string(),
            trialDays: z.number().int().min(0).max(365).optional(),
            owner: z.object({
              name: z.string().trim().min(1).max(120),
              email: z.email().optional(),
              phone: z.string().trim().min(10).max(20).optional(),
              password: z.string().min(8).max(200),
            }).refine((o) => o.email || o.phone, 'Owner needs an email or a mobile number'),
          }),
          response: { 200: z.object({ tenantId: z.string(), branchId: z.string(), ownerUserId: z.string() }) },
        },
      },
      async (request) => {
        const body = request.body;
        const taken = await app.db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, body.slug));
        if (taken[0]) throw conflict('SLUG_TAKEN', 'That shop code is already used');
        const email = body.owner.email?.toLowerCase();
        const existingUser = email ? (await app.db.select().from(users).where(eq(users.email, email)))[0] : undefined;
        const result = await provisionTenant(app.db, {
          name: body.name,
          slug: body.slug,
          planCode: body.planCode,
          ...(body.trialDays !== undefined ? { trialDays: body.trialDays } : {}),
          owner: { name: body.owner.name, email: email ?? null, phone: body.owner.phone ?? null, passwordHash: await hash(body.owner.password) },
          ...(existingUser ? { existingUserId: existingUser.id } : {}),
        });
        await log(request.admin.sub, 'tenant.created', result.tenantId, { name: body.name, plan: body.planCode });
        return { tenantId: result.tenantId, branchId: result.branchId, ownerUserId: result.ownerUserId };
      },
    );

    for (const action of ['suspend', 'activate'] as const) {
      scope.post(
        `/tenants/:id/${action}`,
        {
          schema: {
            params: z.object({ id: z.uuid() }),
            body: z.object({ reason: z.string().trim().min(3).max(500) }),
            response: { 200: z.object({ ok: z.boolean() }) },
          },
        },
        async (request) => {
          const status = action === 'suspend' ? 'suspended' : 'active';
          const [res] = await app.db
            .update(tenants)
            .set({ status, suspendedReason: action === 'suspend' ? request.body.reason : null })
            .where(eq(tenants.id, request.params.id));
          if (res.affectedRows === 0) throw notFound('Tenant');
          invalidateContextCache(request.params.id);
          await log(request.admin.sub, `tenant.${action}ed`, request.params.id, { reason: request.body.reason });
          return { ok: true };
        },
      );
    }

    scope.post(
      '/tenants/:id/subscription/extend',
      {
        schema: {
          params: z.object({ id: z.uuid() }),
          body: z.object({ days: z.number().int().min(1).max(730), reason: z.string().trim().min(3).max(500) }),
          response: { 200: z.object({ periodEnd: z.string() }) },
        },
      },
      async (request) => {
        const sub = (
          await app.db.select().from(subscriptions).where(and(eq(subscriptions.tenantId, request.params.id), eq(subscriptions.isCurrent, true)))
        )[0];
        if (!sub) throw notFound('Subscription');
        const base = sub.currentPeriodEnd && sub.currentPeriodEnd > new Date() ? sub.currentPeriodEnd : new Date();
        const periodEnd = new Date(base.getTime() + request.body.days * 86_400_000);
        const status = sub.status === 'trialing' ? 'trialing' : 'active';
        await app.db
          .update(subscriptions)
          .set({ currentPeriodEnd: periodEnd, ...(status === 'trialing' ? { trialEndsAt: periodEnd } : {}), status, updatedAt: new Date() })
          .where(eq(subscriptions.id, sub.id));
        await app.db.insert(schema.subscriptionEvents).values({
          id: newId(),
          subscriptionId: sub.id,
          tenantId: request.params.id,
          event: 'extended',
          fromStatus: sub.status,
          toStatus: status,
          data: { days: request.body.days, reason: request.body.reason },
          actorAdminId: request.admin.sub,
        });
        invalidateContextCache(request.params.id);
        await log(request.admin.sub, 'subscription.extended', request.params.id, { days: request.body.days });
        return { periodEnd: periodEnd.toISOString() };
      },
    );
  });
};
