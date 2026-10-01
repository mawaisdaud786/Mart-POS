import type { SessionInfo } from '@retailos/contracts';
import { newId } from '@retailos/domain';
import { schema, type Database } from '@retailos/db';
import type { FastifyReply } from 'fastify';
import type { Config } from '../config.js';
import { loadContext, type RequestContext } from './context.js';
import { newRefreshToken, signAccessToken, type KeyPair } from './tokens.js';

export const REFRESH_COOKIE = 'rt';
/** Sent to all API routes so device registration can rebind the session. httpOnly + SameSite=Strict. */
export const REFRESH_COOKIE_PATH = '/api/v1';

export function sessionInfo(ctx: RequestContext, accessToken: string, expiresIn: number, user: { email: string | null; phone: string | null }): SessionInfo {
  return {
    accessToken,
    expiresIn,
    user: { id: ctx.userId, name: ctx.userName, email: user.email, phone: user.phone },
    tenant: { id: ctx.tenantId, name: ctx.tenantName, slug: ctx.tenantSlug },
    membership: { id: ctx.membershipId, roleId: ctx.roleId, roleName: ctx.roleName },
    permissions: [...ctx.permissions].sort(),
    features: [...ctx.features].sort(),
    device: ctx.device,
    subscription: {
      status: ctx.subscription.status,
      readOnly: ctx.subscription.readOnly,
      periodEnd: ctx.subscription.periodEnd?.toISOString() ?? null,
    },
  };
}

export interface IssueSessionInput {
  userId: string;
  tenantId: string;
  membershipId: string;
  deviceId?: string | undefined;
  familyId?: string;
  ip?: string;
  userAgent?: string | undefined;
}

/** Create an access token + a new refresh token (stored hashed) and set the refresh cookie. */
export async function issueSession(
  deps: { db: Database; keys: KeyPair; config: Config },
  reply: FastifyReply,
  input: IssueSessionInput,
): Promise<{ accessToken: string; ctx: RequestContext }> {
  const claims = {
    sub: input.userId,
    tid: input.tenantId,
    mid: input.membershipId,
    ...(input.deviceId ? { did: input.deviceId } : {}),
  };
  const ctx = await loadContext(deps.db, claims);
  const accessToken = await signAccessToken(deps.keys, claims, deps.config.ACCESS_TOKEN_TTL_SECONDS);

  const refresh = newRefreshToken();
  const expiresAt = new Date(Date.now() + deps.config.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
  await deps.db.insert(schema.refreshTokens).values({
    id: newId(),
    userId: input.userId,
    tenantId: input.tenantId,
    deviceId: input.deviceId ?? null,
    familyId: input.familyId ?? newId(),
    tokenHash: refresh.hash,
    expiresAt,
    ip: input.ip ?? null,
    userAgent: input.userAgent?.slice(0, 255) ?? null,
  });
  reply.setCookie(REFRESH_COOKIE, refresh.token, {
    httpOnly: true,
    secure: deps.config.COOKIE_SECURE,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    expires: expiresAt,
  });
  return { accessToken, ctx };
}

/** Normalise identifiers: emails lower-case, Pakistani mobile numbers to +92XXXXXXXXXX. */
export function normalizeIdentifier(identifier: string): { email?: string; phone?: string } {
  const value = identifier.trim();
  if (value.includes('@')) return { email: value.toLowerCase() };
  const digits = value.replace(/\D/g, '');
  if (digits.startsWith('0') && digits.length === 11) return { phone: `+92${digits.slice(1)}` };
  if (digits.startsWith('92') && digits.length === 12) return { phone: `+${digits}` };
  return { phone: `+${digits}` };
}
