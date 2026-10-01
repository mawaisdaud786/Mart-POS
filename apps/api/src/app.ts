import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { Database } from '@retailos/db';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { sql } from 'drizzle-orm';
import type { Config } from './config.js';
import { AppError } from './lib/errors.js';
import type { KeyPair } from './lib/tokens.js';
import { adminRoutes } from './modules/admin/routes.js';
import { authRoutes } from './modules/auth/routes.js';
import { catalogRoutes } from './modules/catalog/routes.js';
import { deviceRoutes } from './modules/devices/routes.js';
import { syncRoutes } from './modules/sync/routes.js';
import { tenantAuth } from './plugins/auth.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
    config: Config;
    keys: KeyPair;
  }
}

export interface AppDeps {
  config: Config;
  db: Database;
  keys: KeyPair;
}

export async function buildApp({ config, db, keys }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      config.NODE_ENV === 'test'
        ? false
        : { level: config.LOG_LEVEL, redact: ['req.headers.authorization', 'req.headers.cookie'] },
    trustProxy: true,
    bodyLimit: 5 * 1024 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('db', db);
  app.decorate('config', config);
  app.decorate('keys', keys);

  await app.register(helmet, { contentSecurityPolicy: { directives: { defaultSrc: ["'none'"] } } });
  await app.register(cors, { origin: config.corsOrigins, credentials: true });
  await app.register(cookie);
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply
        .status(400)
        .type('application/problem+json')
        .send({
          type: 'about:blank',
          title: 'Validation failed',
          status: 400,
          code: 'VALIDATION_FAILED',
          errors: error.validation.map((v) => ({
            path: v.instancePath.replace(/^\//, '').replace(/\//g, '.'),
            message: v.message ?? 'Invalid value',
          })),
        });
    }
    if (error instanceof AppError) {
      return reply.status(error.status).type('application/problem+json').send({
        type: 'about:blank',
        title: error.message,
        status: error.status,
        code: error.code,
        ...(error.errors ? { errors: error.errors } : {}),
      });
    }
    if (error.statusCode && error.statusCode < 500) {
      return reply.status(error.statusCode).type('application/problem+json').send({
        type: 'about:blank',
        title: error.message,
        status: error.statusCode,
        code: error.code ?? 'BAD_REQUEST',
      });
    }
    request.log.error(error);
    return reply.status(500).type('application/problem+json').send({
      type: 'about:blank',
      title: 'Something went wrong on the server',
      status: 500,
      code: 'INTERNAL',
    });
  });

  app.get('/healthz', async () => ({ status: 'ok' }));
  app.get('/readyz', async (_request, reply) => {
    try {
      await db.execute(sql`select 1`);
      return { status: 'ok', db: 'ok' };
    } catch {
      return reply.status(503).send({ status: 'unavailable', db: 'down' });
    }
  });

  // Public tenant auth endpoints (login/refresh/logout).
  await app.register(authRoutes, { prefix: '/api/v1/auth' });

  // Everything else under /api/v1 requires a tenant session.
  await app.register(
    async (scope) => {
      await tenantAuth(scope);
      await scope.register(deviceRoutes, { prefix: '/devices' });
      await scope.register(syncRoutes, { prefix: '/sync' });
      await scope.register(catalogRoutes);
    },
    { prefix: '/api/v1' },
  );

  await app.register(adminRoutes, { prefix: '/admin/v1' });
  return app;
}
