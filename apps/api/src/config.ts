import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().min(1),
  /** Ed25519 private key (PKCS#8 PEM). In development a key is generated into storage/keys if missing. */
  JWT_PRIVATE_KEY: z.string().optional(),
  APP_ENCRYPTION_KEY: z.string().optional(),
  KEYS_DIR: z.string().default('storage/keys'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  /** Comma-separated allowed browser origins (app + admin). */
  CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:5174'),
  /** Allows the locked-down loopback-only Windows desktop renderer. */
  DESKTOP_MODE: z.enum(['true', 'false']).optional(),
  /** Defaults to true in production; refusing to start with false there. */
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  /**
   * How many reverse proxies sit in front of the API (Apache/Passenger on cPanel = 1, plus Cloudflare = 2).
   * Only that many entries of X-Forwarded-For are trusted; anything a client adds in front is ignored,
   * so it cannot fake its IP to dodge rate limits and login lockouts. 0 = connect directly.
   */
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).optional(),
  LOG_LEVEL: z.string().default('info'),
});

export type Config = Omit<z.infer<typeof Env>, 'COOKIE_SECURE' | 'TRUST_PROXY' | 'DESKTOP_MODE'> & {
  corsOrigins: string[];
  COOKIE_SECURE: boolean;
  TRUST_PROXY: number;
  DESKTOP_MODE: boolean;
};

/** Origins must be exact https:// origins, except for the explicitly loopback-only desktop mode. */
export function validateProductionOrigins(origins: string[], desktopMode = false): string[] {
  const problems: string[] = [];
  if (origins.length === 0) problems.push('CORS_ORIGINS must list your web app origin, e.g. https://shop.example.com');
  for (const origin of origins) {
    if (desktopMode && origin === 'http://127.0.0.1:5173') continue;
    let url: URL | undefined;
    try {
      url = new URL(origin);
    } catch {
      /* reported below */
    }
    if (origin.includes('*')) problems.push(`CORS_ORIGINS must not contain wildcards (${origin})`);
    else if (!url || url.origin !== origin) problems.push(`CORS_ORIGINS entry is not an exact origin without a path or trailing slash: ${origin}`);
    else if (url.protocol !== 'https:') problems.push(`CORS_ORIGINS must use https in production: ${origin}`);
    else if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) problems.push(`CORS_ORIGINS must not allow localhost in production: ${origin}`);
  }
  return problems;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }
  const { COOKIE_SECURE, TRUST_PROXY, DESKTOP_MODE, ...config } = parsed.data;
  const production = config.NODE_ENV === 'production';
  const desktopMode = DESKTOP_MODE === 'true';
  const corsOrigins = config.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);

  if (production) {
    const problems: string[] = [];
    if (!config.JWT_PRIVATE_KEY) problems.push('JWT_PRIVATE_KEY is required in production');
    if (!config.APP_ENCRYPTION_KEY) problems.push('APP_ENCRYPTION_KEY is required in production');
    else if (Buffer.from(config.APP_ENCRYPTION_KEY, 'base64').length !== 32) problems.push('APP_ENCRYPTION_KEY must be 32 random bytes, base64 encoded');
    if (COOKIE_SECURE === 'false') problems.push('COOKIE_SECURE=false is not allowed in production (session cookies must be HTTPS-only)');
    if (/^mysql:\/\/root[:@]/i.test(config.DATABASE_URL)) problems.push('DATABASE_URL must not use the MySQL root user; create a dedicated user limited to this database');
    if (desktopMode) {
      if (config.HOST !== '127.0.0.1') problems.push('DESKTOP_MODE requires HOST=127.0.0.1');
      if (corsOrigins.length !== 1 || corsOrigins[0] !== 'http://127.0.0.1:5173') {
        problems.push('DESKTOP_MODE requires CORS_ORIGINS=http://127.0.0.1:5173');
      }
    }
    problems.push(...validateProductionOrigins(corsOrigins, desktopMode));
    if (problems.length > 0) throw new Error(`Unsafe production configuration:\n - ${problems.join('\n - ')}`);
  }

  return {
    ...config,
    corsOrigins,
    DESKTOP_MODE: desktopMode,
    COOKIE_SECURE: COOKIE_SECURE ? COOKIE_SECURE === 'true' : production,
    TRUST_PROXY: TRUST_PROXY ?? (production ? 1 : 0),
  };
}
