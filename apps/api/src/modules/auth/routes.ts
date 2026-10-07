import { hash, verify } from '@node-rs/argon2';
import { LoginBody, LoginResponse, SessionInfo } from '@retailos/contracts';
import { schema } from '@retailos/db';
import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError, unauthorized } from '../../lib/errors.js';
import { issueSession, normalizeIdentifier, REFRESH_COOKIE, REFRESH_COOKIE_PATH, sessionInfo } from '../../lib/session.js';
import { hashToken } from '../../lib/tokens.js';

const { devices, loginAttempts, refreshTokens, roles, tenantMemberships, tenants, users } = schema;

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
// Verified against when the user does not exist, so response time doesn't reveal which accounts exist.
const DUMMY_HASH = await hash('retailos-dummy-password');

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  const deps = { db: app.db, keys: app.keys, config: app.config };

  app.post(
    '/login',
    {
      schema: { body: LoginBody, response: { 200: LoginResponse } },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { identifier, password, tenantId, deviceId } = request.body;
      const id = normalizeIdentifier(identifier);
      const idKey = id.email ?? id.phone!;

      const since = new Date(Date.now() - LOCKOUT_MINUTES * 60_000);
      const [failed] = await app.db
        .select({ n: sql<number>`count(*)` })
        .from(loginAttempts)
        .where(and(eq(loginAttempts.identifier, idKey), eq(loginAttempts.success, false), gte(loginAttempts.createdAt, since)));
      if (Number(failed?.n ?? 0) >= MAX_FAILED_ATTEMPTS) {
        throw new AppError(429, 'TOO_MANY_ATTEMPTS', `Too many failed attempts. Try again in ${LOCKOUT_MINUTES} minutes.`);
      }

      const user = (
        await app.db
          .select()
          .from(users)
          .where(id.email ? eq(users.email, id.email) : eq(users.phone, id.phone!))
      )[0];
      const ok = await verify(user?.passwordHash ?? DUMMY_HASH, password);
      await app.db.insert(loginAttempts).values({ identifier: idKey, ip: request.ip, success: ok && !!user });
      if (!user || !ok) throw new AppError(401, 'INVALID_CREDENTIALS', 'Wrong email/mobile or password');
      if (user.status !== 'active') throw new AppError(401, 'USER_DISABLED', 'This user is disabled');

      const memberships = await app.db
        .select({ membershipId: tenantMemberships.id, tenantId: tenants.id, name: tenants.name, role: roles.name })
        .from(tenantMemberships)
        .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
        .innerJoin(roles, and(eq(roles.tenantId, tenantMemberships.tenantId), eq(roles.id, tenantMemberships.roleId)))
        .where(
          and(
            eq(tenantMemberships.userId, user.id),
            eq(tenantMemberships.status, 'active'),
            isNull(tenantMemberships.deletedAt),
            eq(tenants.status, 'active'),
          ),
        );
      if (memberships.length === 0) throw new AppError(403, 'NO_ACTIVE_SHOP', 'This user has no active shop');

      const chosen = tenantId ? memberships.find((m) => m.tenantId === tenantId) : memberships.length === 1 ? memberships[0] : undefined;
      if (!chosen) {
        if (tenantId) throw new AppError(403, 'NOT_A_MEMBER', 'You are not a member of that shop');
        return {
          status: 'choose_tenant' as const,
          tenants: memberships.map((m) => ({ tenantId: m.tenantId, name: m.name, role: m.role })),
        };
      }

      let boundDevice: string | undefined;
      if (deviceId) {
        const d = (
          await app.db
            .select({ id: devices.id, status: devices.status })
            .from(devices)
            .where(and(eq(devices.id, deviceId), eq(devices.tenantId, chosen.tenantId)))
        )[0];
        if (d?.status === 'active') boundDevice = d.id;
      }

      await app.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
      const { accessToken, ctx } = await issueSession(deps, reply, {
        userId: user.id,
        tenantId: chosen.tenantId,
        membershipId: chosen.membershipId,
        deviceId: boundDevice,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      });
      return {
        status: 'ok' as const,
        session: sessionInfo(ctx, accessToken, app.config.ACCESS_TOKEN_TTL_SECONDS, user),
      };
    },
  );

  /**
   * Rotate the refresh token. Reusing an already-rotated token means it was stolen or
   * replayed, so the whole token family is revoked (docs/phase-1/01 §5).
   */
  app.post(
    '/refresh',
    { schema: { response: { 200: SessionInfo } }, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request, reply) => {
      // CSRF defence for the cookie-authenticated endpoint: browsers can't set this header cross-site without CORS approval.
      if (request.headers['x-requested-with'] !== 'retailos') throw new AppError(403, 'CSRF', 'Missing request header');
      const token = request.cookies[REFRESH_COOKIE];
      if (!token) throw unauthorized('No session');

      const row = (await app.db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, hashToken(token))))[0];
      if (!row) throw unauthorized('Session not found');
      if (row.rotatedAt || row.revokedAt) {
        await app.db
          .update(refreshTokens)
          .set({ revokedAt: new Date(), revokeReason: 'reuse_detected' })
          .where(and(eq(refreshTokens.familyId, row.familyId), isNull(refreshTokens.revokedAt)));
        reply.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
        throw new AppError(401, 'SESSION_REVOKED', 'Session was revoked. Please log in again.');
      }
      if (row.expiresAt < new Date()) throw new AppError(401, 'SESSION_EXPIRED', 'Session expired. Please log in again.');

      const membership = (
        await app.db
          .select({ id: tenantMemberships.id })
          .from(tenantMemberships)
          .where(
            and(
              eq(tenantMemberships.tenantId, row.tenantId),
              eq(tenantMemberships.userId, row.userId),
              eq(tenantMemberships.status, 'active'),
              isNull(tenantMemberships.deletedAt),
            ),
          )
      )[0];
      if (!membership) throw new AppError(401, 'MEMBERSHIP_INACTIVE', 'Membership is not active');

      await app.db.update(refreshTokens).set({ rotatedAt: new Date() }).where(eq(refreshTokens.id, row.id));
      const user = (await app.db.select().from(users).where(eq(users.id, row.userId)))[0]!;
      const { accessToken, ctx } = await issueSession(deps, reply, {
        userId: row.userId,
        tenantId: row.tenantId,
        membershipId: membership.id,
        deviceId: row.deviceId ?? undefined,
        familyId: row.familyId,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      });
      return sessionInfo(ctx, accessToken, app.config.ACCESS_TOKEN_TTL_SECONDS, user);
    },
  );

  app.post('/logout', { schema: { response: { 200: z.object({ ok: z.boolean() }) } } }, async (request, reply) => {
    if (request.headers['x-requested-with'] !== 'retailos') throw new AppError(403, 'CSRF', 'Missing request header');
    const token = request.cookies[REFRESH_COOKIE];
    if (token) {
      const row = (await app.db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, hashToken(token))))[0];
      if (row) {
        await app.db
          .update(refreshTokens)
          .set({ revokedAt: new Date(), revokeReason: 'logout' })
          .where(and(eq(refreshTokens.familyId, row.familyId), isNull(refreshTokens.revokedAt)));
      }
    }
    reply.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
    return { ok: true };
  });
};
