import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadConfig, validateProductionOrigins } from '../src/config';

const prod = {
  NODE_ENV: 'production',
  DATABASE_URL: 'mysql://shop_app:secret@localhost:3306/shop_retailos',
  JWT_PRIVATE_KEY: 'placeholder-not-a-real-key-config-test-only',
  APP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  CORS_ORIGINS: 'https://shop.example.com',
};

describe('production configuration', () => {
  it('accepts a safe production setup and turns on secure cookies and one proxy hop by default', () => {
    const c = loadConfig(prod);
    expect(c.COOKIE_SECURE).toBe(true);
    expect(c.TRUST_PROXY).toBe(1);
    expect(c.DESKTOP_MODE).toBe(false);
    expect(c.corsOrigins).toEqual(['https://shop.example.com']);
  });

  it('allows the desktop renderer only when production API access is locked to loopback', () => {
    const desktop = loadConfig({
      ...prod,
      DESKTOP_MODE: 'true',
      HOST: '127.0.0.1',
      CORS_ORIGINS: 'http://127.0.0.1:5173',
    });
    expect(desktop.DESKTOP_MODE).toBe(true);
    expect(desktop.corsOrigins).toEqual(['http://127.0.0.1:5173']);

    expect(() => loadConfig({ ...prod, DESKTOP_MODE: 'true', HOST: '0.0.0.0', CORS_ORIGINS: 'http://127.0.0.1:5173' })).toThrow(
      /DESKTOP_MODE requires HOST=127\.0\.0\.1/,
    );
    expect(() => loadConfig({ ...prod, DESKTOP_MODE: 'true', HOST: '127.0.0.1', CORS_ORIGINS: 'https://shop.example.com' })).toThrow(
      /DESKTOP_MODE requires CORS_ORIGINS/,
    );
  });

  it('refuses insecure cookies in production', () => {
    expect(() => loadConfig({ ...prod, COOKIE_SECURE: 'false' })).toThrow(/COOKIE_SECURE=false/);
  });

  it('requires signing and encryption keys, and a 32-byte encryption key', () => {
    expect(() => loadConfig({ ...prod, JWT_PRIVATE_KEY: undefined })).toThrow(/JWT_PRIVATE_KEY/);
    expect(() => loadConfig({ ...prod, APP_ENCRYPTION_KEY: undefined })).toThrow(/APP_ENCRYPTION_KEY is required/);
    expect(() => loadConfig({ ...prod, APP_ENCRYPTION_KEY: 'c2hvcnQ=' })).toThrow(/32 random bytes/);
  });

  it('refuses the database root user', () => {
    expect(() => loadConfig({ ...prod, DATABASE_URL: 'mysql://root:pw@localhost/db' })).toThrow(/root user/);
  });

  it('refuses unsafe CORS origins', () => {
    for (const bad of ['*', 'https://*.example.com', 'http://shop.example.com', 'https://localhost', 'https://shop.example.com/', 'https://shop.example.com/app', 'shop.example.com']) {
      expect(validateProductionOrigins([bad]), bad).not.toEqual([]);
    }
    expect(validateProductionOrigins([])).not.toEqual([]);
    expect(validateProductionOrigins(['https://shop.example.com', 'https://admin.example.com:8443'])).toEqual([]);
  });

  it('reports every problem at once', () => {
    try {
      loadConfig({ ...prod, COOKIE_SECURE: 'false', CORS_ORIGINS: 'http://x.test' });
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toMatch(/COOKIE_SECURE[\s\S]*https/);
    }
  });
});

describe('development configuration', () => {
  const dev = { DATABASE_URL: 'mysql://u:p@127.0.0.1:3307/db' };

  it('keeps local conveniences: http cookies, localhost origins, no proxy', () => {
    const c = loadConfig(dev);
    expect(c.COOKIE_SECURE).toBe(false);
    expect(c.TRUST_PROXY).toBe(0);
    expect(c.corsOrigins).toContain('http://localhost:5173');
  });

  it('allows an explicit proxy hop count and bounds it', () => {
    expect(loadConfig({ ...dev, TRUST_PROXY: '2' }).TRUST_PROXY).toBe(2);
    expect(() => loadConfig({ ...dev, TRUST_PROXY: '50' })).toThrow();
  });

  it('bounds token lifetimes', () => {
    expect(() => loadConfig({ ...dev, ACCESS_TOKEN_TTL_SECONDS: '86400' })).toThrow();
    expect(() => loadConfig({ ...dev, REFRESH_TOKEN_TTL_DAYS: '3650' })).toThrow();
  });
});
