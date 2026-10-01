import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().min(1),
  /** Ed25519 private key (PKCS#8 PEM). In development a key is generated into storage/keys if missing. */
  JWT_PRIVATE_KEY: z.string().optional(),
  KEYS_DIR: z.string().default('storage/keys'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().default(30),
  /** Comma-separated allowed browser origins (app + admin). */
  CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:5174'),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  LOG_LEVEL: z.string().default('info'),
});

export type Config = z.infer<typeof Env> & { corsOrigins: string[] };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }
  const config = parsed.data;
  if (config.NODE_ENV === 'production' && !config.JWT_PRIVATE_KEY) {
    throw new Error('JWT_PRIVATE_KEY is required in production');
  }
  return { ...config, corsOrigins: config.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean) };
}
