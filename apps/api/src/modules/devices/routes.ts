import { RegisterDeviceBody, SessionInfo } from '@retailos/contracts';
import { schema } from '@retailos/db';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { invalidateContextCache } from '../../lib/context.js';
import { AppError, notFound } from '../../lib/errors.js';
import { issueSession, REFRESH_COOKIE, sessionInfo } from '../../lib/session.js';
import { hashToken } from '../../lib/tokens.js';
import { audit } from '../../lib/audit.js';

const { branches, devices, refreshTokens, users } = schema;

/** Short device codes used in invoice numbers: A1…A9, B1…Z9. */
export function nextDeviceCode(used: ReadonlySet<string>): string {
  for (let l = 65; l <= 90; l++) {
    for (let d = 1; d <= 9; d++) {
      const code = `${String.fromCharCode(l)}${d}`;
      if (!used.has(code)) return code;
    }
  }
  throw new AppError(409, 'DEVICE_CODES_EXHAUSTED', 'No device codes left');
}

const DeviceView = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  branchId: z.string(),
  platform: z.string().nullable(),
  status: z.string(),
  registeredAt: z.string(),
  lastSeenAt: z.string().nullable(),
});

export const deviceRoutes: FastifyPluginAsyncZod = async (app) => {
  /**
   * Register this browser as a device (plan device limit applies) and rebind the session to it.
   * Idempotent: registering the same device id again returns the existing device.
   */
  app.post(
    '/register',
    { schema: { body: RegisterDeviceBody, response: { 200: SessionInfo } }, config: { permission: 'devices.manage', write: true } },
    async (request, reply) => {
      const { ctx } = request;
      const body = request.body;
      const { tdb } = ctx;

      const existing = (await tdb.select(devices, eq(devices.id, body.id)))[0];
      if (existing && existing.status !== 'active') throw new AppError(403, 'DEVICE_REVOKED', 'This device was revoked');

      if (!existing) {
        const branchId =
          body.branchId ??
          (await tdb.db
            .select({ id: branches.id })
            .from(branches)
            .where(tdb.active(branches, eq(branches.isDefault, true))))[0]?.id;
        if (!branchId) throw new AppError(400, 'BRANCH_REQUIRED', 'No branch to register the device in');
        const branch = (await tdb.db.select({ id: branches.id }).from(branches).where(tdb.active(branches, eq(branches.id, branchId))))[0];
        if (!branch) throw notFound('Branch');

        const all = await tdb.select(devices);
        const active = all.filter((d) => d.status === 'active');
        if (active.length >= ctx.limits.devices) {
          throw new AppError(403, 'PLAN_LIMIT_DEVICES', `Your plan allows ${ctx.limits.devices} devices. Revoke one or upgrade.`);
        }
        const code = nextDeviceCode(new Set(all.map((d) => d.code)));
        await tdb.insert(devices, {
          id: body.id,
          tenantId: ctx.tenantId,
          branchId,
          code,
          name: body.name,
          platform: body.platform ?? null,
          userAgent: request.headers['user-agent']?.slice(0, 255) ?? null,
          registeredBy: ctx.userId,
        });
        await audit(tdb, ctx, request, { action: 'device.registered', entityType: 'device', entityId: body.id, after: { code, name: body.name, branchId } });
      }

      // Replace the current session with one bound to the device.
      const token = request.cookies[REFRESH_COOKIE];
      if (token) {
        await app.db
          .update(refreshTokens)
          .set({ revokedAt: new Date(), revokeReason: 'device_bound' })
          .where(and(eq(refreshTokens.tokenHash, hashToken(token)), isNull(refreshTokens.revokedAt)));
      }
      invalidateContextCache(ctx.tenantId);
      const { accessToken, ctx: newCtx } = await issueSession({ db: app.db, keys: app.keys, config: app.config }, reply, {
        userId: ctx.userId,
        tenantId: ctx.tenantId,
        membershipId: ctx.membershipId,
        deviceId: body.id,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      });
      const user = (await app.db.select().from(users).where(eq(users.id, ctx.userId)))[0]!;
      return sessionInfo(newCtx, accessToken, app.config.ACCESS_TOKEN_TTL_SECONDS, user);
    },
  );

  app.get('/', { schema: { response: { 200: z.array(DeviceView) } }, config: { permission: 'devices.manage' } }, async (request) => {
    const rows = await request.ctx.tdb.select(devices);
    return rows.map((d) => ({
      id: d.id,
      code: d.code,
      name: d.name,
      branchId: d.branchId,
      platform: d.platform,
      status: d.status,
      registeredAt: d.registeredAt.toISOString(),
      lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
    }));
  });

  /** Revoke a device: its sessions end and it can no longer sync. */
  app.post(
    '/:id/revoke',
    { schema: { params: z.object({ id: z.uuid() }), response: { 200: z.object({ ok: z.boolean() }) } }, config: { permission: 'devices.manage' } },
    async (request) => {
      const { ctx } = request;
      const result = await ctx.tdb.update(
        devices,
        { status: 'revoked', revokedAt: new Date(), revokedBy: ctx.userId },
        and(eq(devices.id, request.params.id), eq(devices.status, 'active'))!,
      );
      if (result[0].affectedRows === 0) throw notFound('Active device');
      await app.db
        .update(refreshTokens)
        .set({ revokedAt: new Date(), revokeReason: 'device_revoked' })
        .where(and(eq(refreshTokens.tenantId, ctx.tenantId), eq(refreshTokens.deviceId, request.params.id), isNull(refreshTokens.revokedAt)));
      invalidateContextCache(ctx.tenantId);
      await audit(ctx.tdb, ctx, request, { action: 'device.revoked', entityType: 'device', entityId: request.params.id });
      return { ok: true };
    },
  );
};
