import { gzipSync } from 'node:zlib';
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
import { ContextError } from './lib/context.js';
import { AppError } from './lib/errors.js';
import type { Encryptor } from './lib/crypto.js';
import type { KeyPair } from './lib/tokens.js';
import { adminRoutes } from './modules/admin/routes.js';
import { authRoutes } from './modules/auth/routes.js';
import { shopRoutes } from './modules/shop/routes.js';
import { reportRoutes } from './modules/shop/report-routes.js';
import { shopUserRoutes } from './modules/shop/users.js';
import { tenantAuth } from './plugins/auth.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
    config: Config;
    keys: KeyPair;
    encryptor: Encryptor;
  }
}

export interface AppDeps {
  config: Config;
  db: Database;
  keys: KeyPair;
  encryptor: Encryptor;
}

export async function buildApp({ config, db, keys, encryptor }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      config.NODE_ENV === 'test'
        ? false
        : {
            level: config.LOG_LEVEL,
            redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]', 'req.body.password', 'req.body.totp'],
          },
    // Only the configured number of proxy hops is trusted (see TRUST_PROXY): a client cannot fake its IP.
    trustProxy: config.TRUST_PROXY > 0 ? (_address: string, hop: number) => hop < config.TRUST_PROXY : false,
    bodyLimit: 5 * 1024 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('db', db);
  app.decorate('config', config);
  app.decorate('keys', keys);
  app.decorate('encryptor', encryptor);

  await app.register(helmet, { contentSecurityPolicy: { directives: { defaultSrc: ["'none'"] } } });
  await app.register(cors, {
    origin: config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Requested-With'],
    maxAge: 600,
  });
  await app.register(cookie);
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });

  // Business data and tokens must never be stored by browsers' shared caches or intermediate proxies.
  app.addHook('onSend', async (_request, reply) => {
    if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
  });

  // Smaller answers load much faster on a mobile connection: compress JSON (lists of products, bills) when the browser accepts gzip.
  app.addHook('onSend', async (request, reply, payload) => {
    const type = String(reply.getHeader('content-type') ?? '');
    const text = typeof payload === 'string' ? Buffer.from(payload) : Buffer.isBuffer(payload) ? payload : null;
    if (!text || text.length < 1024 || reply.hasHeader('content-encoding') || !type.includes('json')) return payload;
    if (!String(request.headers['accept-encoding'] ?? '').includes('gzip')) return payload;
    const packed = gzipSync(text, { level: 6 });
    reply.header('content-encoding', 'gzip');
    const vary = String(reply.getHeader('vary') ?? '');
    reply.header('vary', vary ? vary + ', Accept-Encoding' : 'Accept-Encoding');
    reply.removeHeader('content-length');
    return packed;
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof ContextError) {
      const status = error.code === 'TENANT_SUSPENDED' ? 403 : 401;
      return reply.status(status).type('application/problem+json').send({ type: 'about:blank', title: error.message, status, code: error.code });
    }
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
    const mysqlCodes = new Set(['ECONNREFUSED', 'ER_BAD_DB_ERROR', 'ER_NO_SUCH_TABLE', 'ER_ACCESS_DENIED_ERROR', 'PROTOCOL_CONNECTION_LOST']);
    const dbUnavailable = typeof error === 'object' && error && 'code' in error && typeof error.code === 'string' && mysqlCodes.has(error.code);
    if (dbUnavailable) {
      request.log.error({ err: error }, 'Database unavailable during request');
      return reply.status(503).type('application/problem+json').send({
        type: 'about:blank',
        title: 'The shop database is unavailable right now',
        status: 503,
        code: 'DATABASE_UNAVAILABLE',
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
      // The shop's records and operations. The older device/sync/catalog endpoints are not registered:
      // the web app no longer uses them, and an endpoint nobody uses is only extra attack surface.
      await scope.register(shopRoutes, { prefix: '/shop' });
      await scope.register(reportRoutes, { prefix: '/shop/reports' });
      await scope.register(shopUserRoutes, { prefix: '/shop' });
    },
    { prefix: '/api/v1' },
  );

  await app.register(adminRoutes, { prefix: '/admin/v1' });
  return app;
}
