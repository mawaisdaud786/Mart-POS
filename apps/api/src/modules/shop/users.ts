import { hash, verify } from '@node-rs/argon2';
import { PASSWORD_MAX, passwordSchema } from '@retailos/contracts';
import { newId } from '@retailos/domain';
import { schema } from '@retailos/db';
import { and, count, eq, isNull, ne } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { audit } from '../../lib/audit.js';
import { invalidateContextCache } from '../../lib/context.js';
import { AppError, forbidden, notFound } from '../../lib/errors.js';
import { REFRESH_COOKIE, normalizeIdentifier } from '../../lib/session.js';
import { hashToken } from '../../lib/tokens.js';

const { refreshTokens, roles, tenantMemberships, users } = schema;

const ROLE_KEYS = ['owner', 'manager', 'cashier', 'inventory_manager', 'accountant'] as const;
const DUMMY_HASH_PROMISE = hash('retailos-dummy-password');

const CreateUser = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: z.email().max(190).optional(),
    phone: z.string().trim().min(10).max(20).optional(),
    roleKey: z.enum(ROLE_KEYS),
    password: z.string().max(PASSWORD_MAX),
  })
  .superRefine((o, ctx) => {
    if (!o.email && !o.phone) ctx.addIssue({ code: 'custom', message: 'Give an email or a mobile number to sign in with' });
    const check = passwordSchema({ identity: [o.email, o.phone, o.name] }).safeParse(o.password);
    if (!check.success) for (const issue of check.error.issues) ctx.addIssue({ code: 'custom', path: ['password'], message: issue.message });
  });

export const shopUserRoutes: FastifyPluginAsyncZod = async (app) => {
  const roleRows = (tenantId: string) =>
    app.db.select({ id: roles.id, name: roles.name, systemKey: roles.systemKey }).from(roles).where(and(eq(roles.tenantId, tenantId), isNull(roles.deletedAt)));

  /** Everyone needs names for receipts and "sold by", so this list is open to any signed-in person. */
  app.get('/people', async (request) => {
    const rows = await app.db
      .select({ id: users.id, name: tenantMemberships.displayName, userName: users.name })
      .from(tenantMemberships)
      .innerJoin(users, eq(users.id, tenantMemberships.userId))
      .where(and(eq(tenantMemberships.tenantId, request.ctx.tenantId), isNull(tenantMemberships.deletedAt)));
    return rows.map((r) => ({ id: r.id, name: r.name ?? r.userName }));
  });

  app.get('/roles', { config: { permission: 'users.manage' } }, async (request) => {
    const rows = await roleRows(request.ctx.tenantId);
    return rows.filter((r) => r.systemKey && (ROLE_KEYS as readonly string[]).includes(r.systemKey)).map((r) => ({ id: r.id, key: r.systemKey!, name: r.name }));
  });

  app.get('/users', { config: { permission: 'users.manage' } }, async (request) => {
    const rows = await app.db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        phone: users.phone,
        userStatus: users.status,
        membershipStatus: tenantMemberships.status,
        roleKey: roles.systemKey,
        roleName: roles.name,
        lastLoginAt: users.lastLoginAt,
      })
      .from(tenantMemberships)
      .innerJoin(users, eq(users.id, tenantMemberships.userId))
      .innerJoin(roles, and(eq(roles.tenantId, tenantMemberships.tenantId), eq(roles.id, tenantMemberships.roleId)))
      .where(and(eq(tenantMemberships.tenantId, request.ctx.tenantId), isNull(tenantMemberships.deletedAt)));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      phone: r.phone,
      roleKey: r.roleKey,
      roleName: r.roleName,
      active: r.userStatus === 'active' && r.membershipStatus === 'active',
      lastLoginAt: r.lastLoginAt?.toISOString() ?? null,
    }));
  });

  app.post('/users', { schema: { body: CreateUser }, config: { permission: 'users.manage', write: true, rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request) => {
    const body = request.body;
    const { ctx } = request;
    if (body.roleKey === 'owner' && !ctx.permissions.has('roles.manage')) throw forbidden('OWNER_ONLY', 'Only an owner can add another owner');
    const [active] = await app.db
      .select({ n: count() })
      .from(tenantMemberships)
      .where(and(eq(tenantMemberships.tenantId, ctx.tenantId), isNull(tenantMemberships.deletedAt), eq(tenantMemberships.status, 'active')));
    if (Number(active?.n ?? 0) >= ctx.limits.users) throw new AppError(409, 'USER_LIMIT', `Your plan allows ${ctx.limits.users} users`);
    const role = (await roleRows(ctx.tenantId)).find((r) => r.systemKey === body.roleKey);
    if (!role) throw notFound('Role');
    const email = body.email?.toLowerCase() ?? null;
    const phone = body.phone ? (normalizeIdentifier(body.phone).phone ?? null) : null;
    // Accounts are global across shops; never attach or reveal someone else's account from here.
    const taken = await app.db.select({ id: users.id }).from(users).where(email ? eq(users.email, email) : eq(users.phone, phone!));
    if (taken[0]) throw new AppError(409, 'ALREADY_REGISTERED', 'That email or mobile number is already registered');
    const passwordHash = await hash(body.password);
    const userId = newId();
    await app.db.transaction(async (tx) => {
      await tx.insert(users).values({ id: userId, name: body.name, email, phone, passwordHash });
      await tx.insert(tenantMemberships).values({ id: newId(), tenantId: ctx.tenantId, userId, roleId: role.id, displayName: body.name });
    });
    await audit(ctx.tdb, ctx, request, { action: 'user.created', entityType: 'user', entityId: userId, after: { role: body.roleKey } });
    return { id: userId };
  });

  const countActiveOwners = async (tenantId: string, exceptUserId: string) => {
    const rows = await app.db
      .select({ n: count() })
      .from(tenantMemberships)
      .innerJoin(roles, and(eq(roles.tenantId, tenantMemberships.tenantId), eq(roles.id, tenantMemberships.roleId)))
      .innerJoin(users, eq(users.id, tenantMemberships.userId))
      .where(
        and(
          eq(tenantMemberships.tenantId, tenantId),
          eq(roles.systemKey, 'owner'),
          eq(tenantMemberships.status, 'active'),
          eq(users.status, 'active'),
          isNull(tenantMemberships.deletedAt),
          ne(tenantMemberships.userId, exceptUserId),
        ),
      );
    return Number(rows[0]?.n ?? 0);
  };

  app.patch(
    '/users/:id',
    {
      schema: {
        params: z.object({ id: z.uuid() }),
        body: z.object({ name: z.string().trim().min(1).max(120).optional(), roleKey: z.enum(ROLE_KEYS).optional(), active: z.boolean().optional() }),
      },
      config: { permission: 'users.manage', write: true },
    },
    async (request) => {
      const { ctx } = request;
      const { id } = request.params;
      const body = request.body;
      const member = (
        await app.db
          .select({ membershipId: tenantMemberships.id, roleKey: roles.systemKey })
          .from(tenantMemberships)
          .innerJoin(roles, and(eq(roles.tenantId, tenantMemberships.tenantId), eq(roles.id, tenantMemberships.roleId)))
          .where(and(eq(tenantMemberships.tenantId, ctx.tenantId), eq(tenantMemberships.userId, id), isNull(tenantMemberships.deletedAt)))
      )[0];
      if (!member) throw notFound('User');
      const isOwnerChange = member.roleKey === 'owner' || body.roleKey === 'owner';
      if (isOwnerChange && !ctx.permissions.has('roles.manage')) throw forbidden('OWNER_ONLY', 'Only an owner can change an owner');
      if (id === ctx.userId && (body.active === false || (body.roleKey && body.roleKey !== member.roleKey))) {
        throw new AppError(400, 'OP_REJECTED', 'You cannot change your own role or switch yourself off');
      }
      const leavingOwner = member.roleKey === 'owner' && ((body.roleKey && body.roleKey !== 'owner') || body.active === false);
      if (leavingOwner && (await countActiveOwners(ctx.tenantId, id)) === 0) throw new AppError(400, 'OP_REJECTED', 'Keep at least one active owner');
      await app.db.transaction(async (tx) => {
        if (body.name) {
          await tx.update(users).set({ name: body.name, updatedAt: new Date() }).where(eq(users.id, id));
          await tx.update(tenantMemberships).set({ displayName: body.name }).where(eq(tenantMemberships.id, member.membershipId));
        }
        if (body.roleKey) {
          const role = (await roleRows(ctx.tenantId)).find((r) => r.systemKey === body.roleKey);
          if (!role) throw notFound('Role');
          await tx.update(tenantMemberships).set({ roleId: role.id }).where(eq(tenantMemberships.id, member.membershipId));
        }
        if (body.active !== undefined) {
          await tx.update(tenantMemberships).set({ status: body.active ? 'active' : 'disabled' }).where(eq(tenantMemberships.id, member.membershipId));
          if (!body.active) {
            await tx.update(refreshTokens).set({ revokedAt: new Date(), revokeReason: 'user_disabled' }).where(and(eq(refreshTokens.userId, id), eq(refreshTokens.tenantId, ctx.tenantId), isNull(refreshTokens.revokedAt)));
          }
        }
      });
      invalidateContextCache(ctx.tenantId);
      await audit(ctx.tdb, ctx, request, { action: 'user.updated', entityType: 'user', entityId: id, after: body });
      return { ok: true };
    },
  );

  app.post(
    '/users/:id/password',
    { schema: { params: z.object({ id: z.uuid() }), body: z.object({ password: z.string().max(PASSWORD_MAX) }) }, config: { permission: 'users.manage', write: true, rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request) => {
      const { ctx } = request;
      const target = (
        await app.db
          .select({ id: users.id, name: users.name, email: users.email, phone: users.phone, roleKey: roles.systemKey })
          .from(tenantMemberships)
          .innerJoin(users, eq(users.id, tenantMemberships.userId))
          .innerJoin(roles, and(eq(roles.tenantId, tenantMemberships.tenantId), eq(roles.id, tenantMemberships.roleId)))
          .where(and(eq(tenantMemberships.tenantId, ctx.tenantId), eq(tenantMemberships.userId, request.params.id), isNull(tenantMemberships.deletedAt)))
      )[0];
      if (!target) throw notFound('User');
      if (target.roleKey === 'owner' && target.id !== ctx.userId && !ctx.permissions.has('roles.manage')) throw forbidden('OWNER_ONLY', 'Only an owner can reset an owner password');
      const check = passwordSchema({ identity: [target.email, target.phone, target.name] }).safeParse(request.body.password);
      if (!check.success) throw new AppError(400, 'VALIDATION_FAILED', check.error.issues[0]?.message ?? 'Password is not strong enough', [{ path: 'password', message: check.error.issues[0]?.message ?? '' }]);
      await app.db.update(users).set({ passwordHash: await hash(request.body.password), updatedAt: new Date() }).where(eq(users.id, target.id));
      // Signed out everywhere: refresh tokens die now, access tokens within their short lifetime.
      await app.db.update(refreshTokens).set({ revokedAt: new Date(), revokeReason: 'password_reset' }).where(and(eq(refreshTokens.userId, target.id), isNull(refreshTokens.revokedAt)));
      await audit(ctx.tdb, ctx, request, { action: 'user.password_reset', entityType: 'user', entityId: target.id });
      return { ok: true };
    },
  );

  /** Change my own password. Every other signed-in device is signed out; this one stays signed in. */
  app.post(
    '/me/password',
    { schema: { body: z.object({ current: z.string().min(1).max(PASSWORD_MAX), next: z.string().max(PASSWORD_MAX) }) }, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request) => {
      const { ctx } = request;
      const me = (await app.db.select().from(users).where(eq(users.id, ctx.userId)))[0];
      if (!me) throw notFound('User');
      const ok = await verify(me.passwordHash, request.body.current).catch(() => false);
      await verify(await DUMMY_HASH_PROMISE, request.body.current).catch(() => false); // same cost either way
      if (!ok) throw new AppError(401, 'INVALID_CREDENTIALS', 'Your current password is wrong');
      const check = passwordSchema({ identity: [me.email, me.phone, me.name] }).safeParse(request.body.next);
      if (!check.success) throw new AppError(400, 'VALIDATION_FAILED', check.error.issues[0]?.message ?? 'Password is not strong enough', [{ path: 'next', message: check.error.issues[0]?.message ?? '' }]);
      if (request.body.next === request.body.current) throw new AppError(400, 'OP_REJECTED', 'Choose a different password');
      await app.db.update(users).set({ passwordHash: await hash(request.body.next), updatedAt: new Date() }).where(eq(users.id, me.id));
      const cookie = request.cookies[REFRESH_COOKIE];
      const current = cookie ? (await app.db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, hashToken(cookie))))[0] : undefined;
      await app.db
        .update(refreshTokens)
        .set({ revokedAt: new Date(), revokeReason: 'password_changed' })
        .where(and(eq(refreshTokens.userId, me.id), isNull(refreshTokens.revokedAt), current ? ne(refreshTokens.familyId, current.familyId) : undefined));
      await audit(ctx.tdb, ctx, request, { action: 'user.password_changed', entityType: 'user', entityId: me.id });
      return { ok: true };
    },
  );
};
