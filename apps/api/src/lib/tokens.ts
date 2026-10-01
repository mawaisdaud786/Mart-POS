import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SignJWT, importPKCS8, importSPKI, jwtVerify, exportSPKI, type CryptoKey } from 'jose';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import type { Config } from '../config.js';

const ALG = 'EdDSA';
const ISSUER = 'retailos';

export interface KeyPair {
  kid: string;
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicKeyPem: string;
}

/** Load the signing key from config, or (development/test only) from/into KEYS_DIR. */
export async function loadKeys(config: Config): Promise<KeyPair> {
  let privatePem = config.JWT_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!privatePem) {
    const file = join(config.KEYS_DIR, 'jwt-ed25519.pem');
    if (existsSync(file)) {
      privatePem = readFileSync(file, 'utf8');
    } else {
      const { privateKey } = generateKeyPairSync('ed25519');
      privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
      mkdirSync(config.KEYS_DIR, { recursive: true });
      writeFileSync(file, privatePem, { mode: 0o600 });
    }
  }
  const publicPem = createPublicKey(createPrivateKey(privatePem)).export({ type: 'spki', format: 'pem' }).toString();
  const privateKey = await importPKCS8(privatePem, ALG);
  const publicKey = await importSPKI(publicPem, ALG, { extractable: true });
  const kid = createHash('sha256').update(publicPem).digest('base64url').slice(0, 16);
  return { kid, privateKey, publicKey, publicKeyPem: await exportSPKI(publicKey) };
}

export interface AccessClaims {
  sub: string; // user id
  tid: string; // tenant id
  mid: string; // membership id
  did?: string; // device id
}

export interface AdminClaims {
  sub: string; // admin id
  role: string;
}

export async function signAccessToken(keys: KeyPair, claims: AccessClaims, ttlSeconds: number): Promise<string> {
  return new SignJWT({ tid: claims.tid, mid: claims.mid, ...(claims.did ? { did: claims.did } : {}) })
    .setProtectedHeader({ alg: ALG, kid: keys.kid })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setAudience('tenant')
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(keys.privateKey);
}

export async function verifyAccessToken(keys: KeyPair, token: string): Promise<AccessClaims> {
  const { payload } = await jwtVerify(token, keys.publicKey, { issuer: ISSUER, audience: 'tenant', algorithms: [ALG] });
  if (typeof payload.sub !== 'string' || typeof payload.tid !== 'string' || typeof payload.mid !== 'string') {
    throw new Error('Malformed token');
  }
  return {
    sub: payload.sub,
    tid: payload.tid,
    mid: payload.mid,
    ...(typeof payload.did === 'string' ? { did: payload.did } : {}),
  };
}

export async function signAdminToken(keys: KeyPair, claims: AdminClaims, ttlSeconds: number): Promise<string> {
  return new SignJWT({ role: claims.role })
    .setProtectedHeader({ alg: ALG, kid: keys.kid })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setAudience('admin')
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(keys.privateKey);
}

export async function verifyAdminToken(keys: KeyPair, token: string): Promise<AdminClaims> {
  const { payload } = await jwtVerify(token, keys.publicKey, { issuer: ISSUER, audience: 'admin', algorithms: [ALG] });
  if (typeof payload.sub !== 'string' || typeof payload.role !== 'string') throw new Error('Malformed token');
  return { sub: payload.sub, role: payload.role };
}

/** Opaque refresh token: 256 random bits. Only its SHA-256 hash is stored. */
export function newRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
