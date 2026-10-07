import { z } from 'zod';

/**
 * Password rules for accounts that sign in to the shop server and the super admin.
 * Length matters more than symbols (NIST 800-63B), so there are no "must contain a symbol" rules;
 * instead the obviously guessable passwords are refused.
 */
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;

/** Very common passwords and shop-themed guesses. Compared case-insensitively, letters and digits only. */
const COMMON = new Set([
  'password', 'password1', 'password12', 'password123', 'passw0rd', 'qwertyuiop', 'qwerty123', 'qwerty1234', '1234567890', '12345678910',
  'iloveyou12', 'admin12345', 'administrator', 'letmein123', 'welcome123', 'welcome1234', 'changeme123', 'changeme', 'pakistan123',
  'pakistan786', 'bismillah786', 'allahuakbar', 'muhammad123', 'muhammad786', 'karachi123', 'lahore12345', 'islamabad1',
  'retailos123', 'retailos1234', 'alnoormart', 'alnoormart1', 'alnoormart123', 'alnoor12345', 'shop123456', 'mystore123',
]);

export type PasswordProblem = 'too_short' | 'too_long' | 'too_common' | 'too_repetitive' | 'sequence' | 'contains_identity';

export interface PasswordContext {
  /** Email, mobile or name of the account; a password built from it is refused. */
  identity?: (string | null | undefined)[];
}

const normalise = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** 1234567890, 1234567890123 (wrapping 9 to 0), abcdefgh, zyxwvu: each character is one step from the last. */
function isSequence(p: string): boolean {
  if (p.length < 6) return false;
  const digits = /^\d+$/.test(p);
  const letters = /^[a-z]+$/.test(p);
  if (!digits && !letters) return false;
  const base = digits ? 10 : 26;
  const code = (ch: string) => (digits ? ch.charCodeAt(0) - 48 : ch.charCodeAt(0) - 97);
  const step = (((code(p[1]!) - code(p[0]!)) % base) + base) % base;
  if (step !== 1 && step !== base - 1) return false;
  for (let i = 1; i < p.length; i++) if ((((code(p[i]!) - code(p[i - 1]!)) % base) + base) % base !== step) return false;
  return true;
}

/** "abcabcabcabc", "12341234": a short block repeated. */
function isRepeatedBlock(p: string): boolean {
  for (let len = 1; len <= 4; len++) {
    if (p.length >= len * 3 && p.length % len === 0 && p === p.slice(0, len).repeat(p.length / len)) return true;
  }
  return false;
}

export function passwordProblems(password: string, ctx: PasswordContext = {}): PasswordProblem[] {
  const problems: PasswordProblem[] = [];
  if (password.length < PASSWORD_MIN) problems.push('too_short');
  if (password.length > PASSWORD_MAX) problems.push('too_long');
  const flat = normalise(password);
  if (COMMON.has(flat)) problems.push('too_common');
  if (new Set(flat).size <= 2 || isRepeatedBlock(flat)) problems.push('too_repetitive');
  if (isSequence(flat)) problems.push('sequence');
  for (const id of ctx.identity ?? []) {
    const n = id ? normalise(id.split('@')[0] ?? id) : '';
    // Only meaningful identity strings (a 3-letter name inside a long passphrase is fine).
    if (n.length >= 5 && flat.includes(n)) problems.push('contains_identity');
  }
  return [...new Set(problems)];
}

const MESSAGES: Record<PasswordProblem, string> = {
  too_short: `Password must be at least ${PASSWORD_MIN} characters`,
  too_long: `Password must be at most ${PASSWORD_MAX} characters`,
  too_common: 'That password is too common. Use a longer phrase that only you know',
  too_repetitive: 'Password uses too few different characters',
  sequence: 'Password cannot be a simple sequence like 1234567890',
  contains_identity: 'Password cannot contain your email, mobile number or name',
};

export function passwordMessage(problems: PasswordProblem[]): string {
  return MESSAGES[problems[0] ?? 'too_short'];
}

/** Zod schema for a new password. Pass the account identity to refuse passwords built from it. */
export const passwordSchema = (ctx: PasswordContext = {}) =>
  z.string().superRefine((value, refinement) => {
    const problems = passwordProblems(value, ctx);
    for (const p of problems) refinement.addIssue({ code: 'custom', message: MESSAGES[p] });
  });

/** Plain `new password` field with no account context. */
export const NewPassword = passwordSchema();
