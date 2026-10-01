import { z } from 'zod';
import { Uuid } from './common.js';

export const LoginBody = z.object({
  /** Email or mobile number. */
  identifier: z.string().trim().min(3).max(190),
  password: z.string().min(1).max(200),
  /** Required when the user belongs to more than one shop. */
  tenantId: Uuid.optional(),
  /** Registered device to bind the session to, if this browser already has one. */
  deviceId: Uuid.optional(),
});
export type LoginBody = z.infer<typeof LoginBody>;

export const TenantChoice = z.object({ tenantId: Uuid, name: z.string(), role: z.string() });

export const SessionInfo = z.object({
  accessToken: z.string(),
  expiresIn: z.number(),
  user: z.object({ id: Uuid, name: z.string(), email: z.string().nullable(), phone: z.string().nullable() }),
  tenant: z.object({ id: Uuid, name: z.string(), slug: z.string() }),
  membership: z.object({ id: Uuid, roleId: Uuid, roleName: z.string() }),
  permissions: z.array(z.string()),
  features: z.array(z.string()),
  device: z.object({ id: Uuid, code: z.string(), branchId: Uuid }).nullable(),
  subscription: z.object({ status: z.string(), readOnly: z.boolean(), periodEnd: z.string().nullable() }),
});
export type SessionInfo = z.infer<typeof SessionInfo>;

export const LoginResponse = z.union([
  z.object({ status: z.literal('ok'), session: SessionInfo }),
  z.object({ status: z.literal('choose_tenant'), tenants: z.array(TenantChoice) }),
]);
export type LoginResponse = z.infer<typeof LoginResponse>;

export const RegisterDeviceBody = z.object({
  id: Uuid,
  name: z.string().trim().min(1).max(80),
  platform: z.string().max(40).optional(),
  branchId: Uuid.optional(),
});
export type RegisterDeviceBody = z.infer<typeof RegisterDeviceBody>;
