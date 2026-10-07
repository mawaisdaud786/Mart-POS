import { describe, expect, it } from 'vitest';
import { NewPassword, passwordProblems, passwordSchema } from './password';

describe('password policy', () => {
  it('accepts a long passphrase without symbols', () => {
    expect(passwordProblems('blue tractor drinks chai')).toEqual([]);
    expect(NewPassword.safeParse('Zq8-kitchen-lamp').success).toBe(true);
  });

  it('rejects short passwords', () => {
    expect(passwordProblems('Ab1!xyz')).toContain('too_short');
    expect(NewPassword.safeParse('short').success).toBe(false);
  });

  it('rejects common passwords regardless of case, spacing and punctuation', () => {
    expect(passwordProblems('Password123')).toContain('too_common');
    expect(passwordProblems('PASS WORD-123')).toContain('too_common');
    expect(passwordProblems('Al-Noor-Mart-123')).toContain('too_common');
    expect(passwordProblems('qwertyuiop')).toContain('too_common');
  });

  it('rejects repeated characters and plain sequences', () => {
    expect(passwordProblems('aaaaaaaaaaaa')).toContain('too_repetitive');
    expect(passwordProblems('abababababab')).toContain('too_repetitive');
    expect(passwordProblems('abcdefghijkl')).toContain('sequence');
    expect(passwordProblems('9876543210')).toContain('sequence');
    expect(passwordProblems('12345678901')).toContain('sequence'); // wraps from 9 to 0
    expect(passwordProblems('0123456789012')).toContain('sequence');
    expect(passwordProblems('abcabcabcabc')).toContain('too_repetitive');
    expect(passwordProblems('123412341234')).toContain('too_repetitive');
    expect(passwordProblems('qwxzvbnmplo')).toEqual([]); // not a sequence
  });

  it('rejects passwords built from the account identity', () => {
    const ctx = { identity: ['ahmed.raza@alnoormart.pk', '+923001234567', 'Ahmed Raza'] };
    expect(passwordProblems('ahmed.raza2026!', ctx)).toContain('contains_identity');
    expect(passwordProblems('MyAhmedRaza-shop', ctx)).toContain('contains_identity');
    expect(passwordProblems('+923001234567abc', ctx)).toContain('contains_identity');
    expect(passwordProblems('green-river-stones', ctx)).toEqual([]);
  });

  it('ignores very short identity fragments', () => {
    expect(passwordProblems('a long unrelated phrase', { identity: ['Ali', null, undefined] })).toEqual([]);
  });

  it('rejects absurdly long passwords (argon2 CPU cost)', () => {
    expect(passwordProblems('x1'.repeat(150))).toContain('too_long');
  });

  it('exposes readable messages through zod', () => {
    const r = passwordSchema().safeParse('password123');
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map((i) => i.message).join(' ')).toMatch(/too common/);
  });
});
