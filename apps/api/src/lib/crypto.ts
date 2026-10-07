import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * AES-256-GCM for secrets at rest (TOTP secrets, integration credentials).
 * Format: version byte (1) | 12-byte IV | 16-byte tag | ciphertext.
 */
export class Encryptor {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error('Encryption key must be 32 bytes');
  }

  static fromEnv(value: string | undefined, keysDir: string, production: boolean): Encryptor {
    if (value) return new Encryptor(Buffer.from(value, 'base64'));
    if (production) throw new Error('APP_ENCRYPTION_KEY is required in production');
    const file = join(keysDir, 'app-encryption.key');
    if (!existsSync(file)) {
      mkdirSync(keysDir, { recursive: true });
      writeFileSync(file, randomBytes(32).toString('base64'), { mode: 0o600 });
    }
    return new Encryptor(Buffer.from(readFileSync(file, 'utf8').trim(), 'base64'));
  }

  encrypt(plain: string): Buffer {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), data]);
  }

  /**
   * Text form (base64) for columns that the database driver hands back as a string: drizzle decodes
   * `varbinary` as UTF-8, which would corrupt raw ciphertext. Base64 survives that unchanged.
   */
  encryptToText(plain: string): string {
    return this.encrypt(plain).toString('base64');
  }

  decryptFromText(text: string): string {
    return this.decrypt(Buffer.from(text, 'base64'));
  }

  decrypt(blob: Buffer): string {
    if (blob[0] !== 1) throw new Error('Unknown encryption format');
    const decipher = createDecipheriv('aes-256-gcm', this.key, blob.subarray(1, 13));
    decipher.setAuthTag(blob.subarray(13, 29));
    return Buffer.concat([decipher.update(blob.subarray(29)), decipher.final()]).toString('utf8');
  }
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits) — compatible with Google Authenticator / Authy. */
export function totp(secretBase32: string, time = Date.now(), step = 30): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(time / 1000 / step)));
  const mac = createHmac('sha1', base32Decode(secretBase32)).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0xf;
  const code = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, '0');
}

/** Accepts the current code and one step either side (clock drift). */
export function verifyTotp(secretBase32: string, code: string, time = Date.now()): boolean {
  const input = Buffer.from(code.padStart(6, '0'));
  return [-1, 0, 1].some((drift) => {
    const expected = Buffer.from(totp(secretBase32, time + drift * 30_000));
    return expected.length === input.length && timingSafeEqual(expected, input);
  });
}

export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}
