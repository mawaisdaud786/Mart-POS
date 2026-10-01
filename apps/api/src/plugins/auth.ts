import type { FeatureKey, Permission } from '@retailos/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ContextError, loadContext, type RequestContext } from '../lib/context.js';
import { AppError, forbidden, unauthorized } from '../lib/errors.js';
import { verifyAccessToken } from '../lib/tokens.js';

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Route needs this permission (role) … */
    permission?: Permission;
    /** … and this plan feature. */
    feature?: FeatureKey;
    /** Route creates or changes data: blocked when the subscription is read-only. */
    write?: boolean;
    /** Route needs a registered device (sync endpoints). */
    device?: boolean;
  }
  interface FastifyRequest {
    ctx: RequestContext;
  }
}

function bearer(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

/**
 * Registers authentication for every route in the calling scope. The tenant always comes
 * from the verified token; nothing in the request body, query or headers can change it.
 */
export async function tenantAuth(app: FastifyInstance): Promise<void> {
  app.decorateRequest('ctx', null as unknown as RequestContext);

  app.addHook('onRequest', async (request) => {
    const token = bearer(request);
    if (!token) throw unauthorized();
    let claims;
    try {
      claims = await verifyAccessToken(app.keys, token);
    } catch {
      throw new AppError(401, 'TOKEN_INVALID', 'Session expired or invalid');
    }
    try {
      request.ctx = await loadContext(app.db, claims);
    } catch (err) {
      if (err instanceof ContextError) {
        const status = err.code === 'TENANT_SUSPENDED' ? 403 : 401;
        throw new AppError(status, err.code, err.message);
      }
      throw err;
    }
  });

  app.addHook('preHandler', async (request) => {
    const config = request.routeOptions.config;
    const ctx = request.ctx;
    if (config.feature && !ctx.features.has(config.feature)) {
      throw forbidden('FEATURE_NOT_IN_PLAN', 'This feature is not included in your plan');
    }
    if (config.permission && !ctx.permissions.has(config.permission)) {
      throw forbidden();
    }
    if (config.write && ctx.subscription.readOnly) {
      throw forbidden('SUBSCRIPTION_READ_ONLY', 'Your subscription has ended: data is read-only until it is renewed');
    }
    if (config.device && !ctx.device) {
      throw forbidden('DEVICE_REQUIRED', 'Register this device first');
    }
  });
}
