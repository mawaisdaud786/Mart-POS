import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Encryptor, base32Encode, newTotpSecret, totp, verifyTotp } from '../src/lib/crypto';

describe('Encryptor', () => {
  const enc = new Encryptor(randomBytes(32));

  it('round-trips through the text form that is stored in the database', () => {
    const secret = newTotpSecret();
    const stored = enc.encryptToText(secret);
    expect(stored).toMatch(/^[A-Za-z0-9+/=]+$/);
    // The database driver returns varbinary columns as UTF-8 text; base64 must survive that unchanged.
    const viaDriver = Buffer.from(stored, 'utf8').toString('utf8');
    expect(enc.decryptFromText(viaDriver)).toBe(secret);
  });

  it('uses a fresh IV every time', () => {
    expect(enc.encryptToText('same')).not.toBe(enc.encryptToText('same'));
  });

  it('detects tampering and wrong keys', () => {
    const blob = enc.encrypt('secret');
    blob[blob.length - 1] = blob[blob.length - 1]! ^ 1;
    expect(() => enc.decrypt(blob)).toThrow();
    expect(() => new Encryptor(randomBytes(32)).decryptFromText(enc.encryptToText('secret'))).toThrow();
  });

  it('requires a 32-byte key', () => {
    expect(() => new Encryptor(randomBytes(16))).toThrow(/32 bytes/);
  });
});

describe('TOTP (RFC 6238)', () => {
  // RFC 6238 appendix B test secret, SHA-1: the 8-digit codes 94287082 / 07081804 end in these 6 digits.
  const secret = base32Encode(Buffer.from('12345678901234567890'));

  it('matches the RFC test vectors', () => {
    expect(totp(secret, 59_000)).toBe('287082');
    expect(totp(secret, 1_111_111_109_000)).toBe('081804');
  });

  it('accepts one step of clock drift and nothing more', () => {
    const now = 1_700_000_000_000;
    expect(verifyTotp(secret, totp(secret, now), now)).toBe(true);
    expect(verifyTotp(secret, totp(secret, now - 30_000), now)).toBe(true);
    expect(verifyTotp(secret, totp(secret, now + 30_000), now)).toBe(true);
    expect(verifyTotp(secret, totp(secret, now - 90_000), now)).toBe(false);
    expect(verifyTotp(secret, '000000', now)).toBe(false);
  });
});
