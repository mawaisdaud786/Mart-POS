import { hash } from '@node-rs/argon2';
import { passwordSchema } from '@retailos/contracts';
import { newId } from '@retailos/domain';
import { createDb, provisionTenant, schema, seedReferenceData } from '@retailos/db';
import { config as loadDotEnv } from 'dotenv';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { loadConfig } from './config.js';
import { Encryptor, newTotpSecret } from './lib/crypto.js';
import { appRoot, migrationsDir } from './lib/paths.js';
import { normalizeIdentifier } from './lib/session.js';
import { loadKeys } from './lib/tokens.js';

/**
 * Operations tool for production, where there is no `tsx` and no repository:
 *   node cli.js gen-secrets
 *   node cli.js doctor
 *   node cli.js migrate
 *   node cli.js create-admin  --email you@example.com --name "Your Name"
 *   node cli.js create-tenant --name "Al Noor Mart" --slug al-noor-mart --owner-name "Owner" --owner-email owner@example.com
 *   node cli.js reset-password --identifier owner@example.com        (shop user: email or mobile)
 *   node cli.js reset-admin-password --email you@example.com         (super admin)
 * Passwords are typed at a hidden prompt, never passed on the command line.
 */

const root = appRoot(import.meta.url);
loadDotEnv({ path: resolve(root, '.env'), quiet: true });

const [command, ...rest] = process.argv.slice(2);

function flags(args: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!a.startsWith('--')) throw new Error(`Unexpected argument: ${a}`);
    const value = args[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${a}`);
    out[a.slice(2)] = value;
    i++;
  }
  return out;
}

function need(f: Record<string, string>, key: string): string {
  const v = f[key]?.trim();
  if (!v) throw new Error(`--${key} is required`);
  return v;
}

/** Hidden password prompt. Falls back to RETAILOS_PASSWORD only when there is no terminal. */
async function promptHidden(label: string): Promise<string> {
  if (!process.stdin.isTTY) {
    const fromEnv = process.env.RETAILOS_PASSWORD;
    if (!fromEnv) throw new Error('Open an interactive terminal (cPanel > Terminal) to type the password.');
    return fromEnv;
  }
  process.stdout.write(label);
  return new Promise((resolvePromise, reject) => {
    const chars: string[] = [];
    const stdin = process.stdin;
    const finish = (fn: () => void) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
      process.stdout.write('\n');
      fn();
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return finish(() => resolvePromise(chars.join('')));
        if (ch === '\u0003') return finish(() => reject(new Error('Cancelled')));
        if (ch === '\u007f' || ch === '\b') chars.pop();
        else chars.push(ch);
      }
    };
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    stdin.on('data', onData);
  });
}

async function newPassword(identity: (string | null | undefined)[]): Promise<string> {
  const first = await promptHidden('New password (min 10 characters, a passphrase is best): ');
  const check = passwordSchema({ identity }).safeParse(first);
  if (!check.success) throw new Error(check.error.issues[0]?.message ?? 'Password is not strong enough');
  if (process.stdin.isTTY && (await promptHidden('Type it again: ')) !== first) throw new Error('The two passwords do not match');
  return first;
}

function connect() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set (put it in .env next to this file, or in the cPanel Node.js app variables)');
  return createDb(url, { connectionLimit: 1, ...(process.env.DB_COLLATION ? { collation: process.env.DB_COLLATION } : {}) });
}

const ok = (m: string) => console.log(`  OK    ${m}`);
const bad = (m: string) => {
  console.log(`  FAIL  ${m}`);
  failures++;
};
const warn = (m: string) => console.log(`  WARN  ${m}`);
let failures = 0;

async function genSecrets() {
  const { privateKey } = generateKeyPairSync('ed25519');
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString().trim();
  console.log('Add these to your cPanel Node.js app environment variables (keep them secret, never share or commit them):\n');
  console.log(`JWT_PRIVATE_KEY=${pem.replace(/\n/g, '\\n')}`);
  console.log(`APP_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`);
  console.log('\nBack them up somewhere safe. Losing APP_ENCRYPTION_KEY makes stored admin authenticator secrets unreadable;');
  console.log('changing JWT_PRIVATE_KEY signs everyone out.');
}

async function doctor() {
  console.log(`RetailOS API check (node ${process.version}, folder ${root})\n`);
  let config;
  try {
    config = loadConfig();
    ok(`Configuration is valid (NODE_ENV=${config.NODE_ENV}, cookies ${config.COOKIE_SECURE ? 'HTTPS-only' : 'NOT HTTPS-only'}, proxy hops ${config.TRUST_PROXY})`);
    if (config.NODE_ENV !== 'production') warn('NODE_ENV is not "production": security checks for production were skipped');
  } catch (e) {
    bad((e as Error).message);
    return;
  }
  try {
    const keys = await loadKeys(config);
    ok(`Signing key loaded (kid ${keys.kid})`);
    Encryptor.fromEnv(config.APP_ENCRYPTION_KEY, config.KEYS_DIR, config.NODE_ENV === 'production');
    ok('Encryption key loaded');
  } catch (e) {
    bad(`Keys: ${(e as Error).message}`);
  }
  const database = connect();
  try {
    const [[v]] = (await database.pool.query('select version() as v, @@character_set_database as cs, @@collation_database as co')) as unknown as [[{ v: string; cs: string; co: string }]];
    ok(`Database connected: ${v!.v} (${v!.cs} / ${v!.co})`);
    const maria = /mariadb/i.exec(v!.v);
    const ver = /^(\d+)\.(\d+)/.exec(v!.v.replace(/^5\.5\.5-/, ''));
    const major = Number(ver?.[1] ?? 0);
    const minor = Number(ver?.[2] ?? 0);
    if (maria ? major < 10 || (major === 10 && minor < 6) : major < 8) bad(`${maria ? 'MariaDB' : 'MySQL'} ${major}.${minor} is too old: use MySQL 8.0+ or MariaDB 10.6+`);
    try {
      // Reports add up bill lines inside the database with JSON_TABLE; check the exact syntax they use.
      const [[probe]] = (await database.pool.query(
        `select sum(jt.qty) as q, min(jt.pid) as p from json_table('{"items":[{"productId":"a","qty":1.5},{"productId":"b","qty":2}]}', '$' columns (nested path '$.items[*]' columns (ord for ordinality, pid varchar(64) character set utf8mb4 collate utf8mb4_bin path '$.productId', qty double path '$.qty'))) jt`,
      )) as unknown as [[{ q: number; p: string }]];
      if (Number(probe!.q) === 3.5 && probe!.p === 'a') ok('Report queries (JSON_TABLE) work');
      else bad('Report queries returned wrong results on this database engine');
    } catch (e) {
      bad(`Reports need JSON_TABLE, which this database does not support: ${(e as Error).message}`);
    }
    if (!/^utf8mb4/.test(v!.cs)) warn(`The database character set is ${v!.cs}; Urdu text needs utf8mb4`);
    const [tables] = (await database.pool.query("select count(*) as n from information_schema.tables where table_schema = database() and table_name = 'tenants'")) as unknown as [[{ n: number }]];
    if (Number(tables[0]!.n) === 0) warn('Tables are not created yet: run "node cli.js migrate"');
    else {
      const plans = await database.db.select().from(schema.plans).limit(1);
      if (plans[0]) {
        ok('Plans readable');
        if (typeof plans[0].limits !== 'object') bad('JSON columns come back as text on this database engine; use MySQL 8 or a current MariaDB');
        else ok('JSON columns work');
      } else warn('No plans yet: run "node cli.js seed"');
      const admins = await database.db.select({ n: sql<number>`count(*)` }).from(schema.platformAdmins);
      if (Number(admins[0]?.n ?? 0) === 0) warn('No super admin yet: run "node cli.js create-admin ..."');
      else ok(`${admins[0]!.n} super admin(s)`);
    }
  } catch (e) {
    bad(`Database: ${(e as Error).message}`);
  } finally {
    await database.close();
  }
  console.log(failures ? `\n${failures} problem(s) to fix before going live.` : '\nAll checks passed.');
  if (failures) process.exitCode = 1;
}

async function runMigrate() {
  const database = connect();
  try {
    await migrate(database.db, { migrationsFolder: migrationsDir(root) });
    console.log('Migrations applied');
    await seedReferenceData(database.db);
    console.log('Reference data (plans, permissions, units) is up to date');
  } finally {
    await database.close();
  }
}

async function createAdmin(f: Record<string, string>) {
  const email = need(f, 'email').toLowerCase();
  const name = need(f, 'name');
  const role = f.role ?? 'super';
  if (!['super', 'support', 'billing'].includes(role)) throw new Error('--role must be super, support or billing');
  const config = loadConfig();
  const encryptor = Encryptor.fromEnv(config.APP_ENCRYPTION_KEY, config.KEYS_DIR, config.NODE_ENV === 'production');
  const database = connect();
  try {
    const existing = await database.db.select({ id: schema.platformAdmins.id }).from(schema.platformAdmins).where(sql`${schema.platformAdmins.email} = ${email}`);
    if (existing[0]) throw new Error(`An admin with ${email} already exists`);
    const password = await newPassword([email, name]);
    const secret = newTotpSecret();
    const id = newId();
    await database.db.insert(schema.platformAdmins).values({
      id,
      name,
      email,
      role,
      passwordHash: await hash(password),
      totpSecretEnc: encryptor.encryptToText(secret),
    });
    await database.db.insert(schema.platformAuditLogs).values({ adminId: id, action: 'admin.created', after: { role, via: 'cli' } });
    console.log(`\nAdmin ${email} created.\n`);
    console.log('Add this to your authenticator app (Google Authenticator, Authy, Microsoft Authenticator): choose "enter a setup key"');
    console.log(`  Account: RetailOS (${email})`);
    console.log(`  Key:     ${secret}  (time based)`);
    console.log(`  Or open: otpauth://totp/RetailOS:${encodeURIComponent(email)}?secret=${secret}&issuer=RetailOS`);
    console.log('\nThis key is shown once. Admin sign-in needs the password and the 6-digit code.');
  } finally {
    await database.close();
  }
}

async function createTenant(f: Record<string, string>) {
  const name = need(f, 'name');
  const slug = need(f, 'slug');
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) throw new Error('--slug may only contain lowercase letters, digits and single dashes');
  const ownerName = need(f, 'owner-name');
  const email = f['owner-email']?.trim().toLowerCase();
  const phone = f['owner-phone']?.trim();
  if (!email && !phone) throw new Error('Give --owner-email or --owner-phone (the owner signs in with it)');
  const database = connect();
  try {
    await seedReferenceData(database.db);
    const taken = await database.db.select({ id: schema.tenants.id }).from(schema.tenants).where(sql`${schema.tenants.slug} = ${slug}`);
    if (taken[0]) throw new Error(`Shop code "${slug}" is already used`);
    const password = await newPassword([email, phone, ownerName]);
    const result = await provisionTenant(database.db, {
      name,
      slug,
      planCode: f.plan ?? 'business',
      trialDays: f['trial-days'] ? Number(f['trial-days']) : 365,
      owner: { name: ownerName, email: email ?? null, phone: phone ?? null, passwordHash: await hash(password) },
    });
    console.log(`\nShop "${name}" created (${result.tenantId}). The owner can now sign in with ${email ?? phone}.`);
  } finally {
    await database.close();
  }
}

/** Set a new password for a shop user and sign them out everywhere. */
async function resetPassword(f: Record<string, string>) {
  const id = normalizeIdentifier(need(f, 'identifier'));
  const database = connect();
  try {
    const where = id.email ? eq(schema.users.email, id.email) : eq(schema.users.phone, id.phone!);
    const user = (await database.db.select().from(schema.users).where(where))[0];
    if (!user) throw new Error('No user with that email or mobile number');
    const password = await newPassword([user.email, user.phone, user.name]);
    await database.db.update(schema.users).set({ passwordHash: await hash(password), updatedAt: new Date() }).where(eq(schema.users.id, user.id));
    // Every device is signed out: refresh tokens die now, access tokens within 15 minutes.
    const [revoked] = await database.db
      .update(schema.refreshTokens)
      .set({ revokedAt: new Date(), revokeReason: 'password_reset' })
      .where(and(eq(schema.refreshTokens.userId, user.id), isNull(schema.refreshTokens.revokedAt)));
    await database.db.delete(schema.loginAttempts).where(eq(schema.loginAttempts.identifier, id.email ?? id.phone!));
    console.log(`
Password changed for ${user.name}. ${revoked.affectedRows} signed-in session(s) were ended; the lockout (if any) was cleared.`);
  } finally {
    await database.close();
  }
}

/** Set a new password for a super admin, ended sessions are not tracked (admin tokens last one hour). */
async function resetAdminPassword(f: Record<string, string>) {
  const email = need(f, 'email').toLowerCase();
  const database = connect();
  try {
    const admin = (await database.db.select().from(schema.platformAdmins).where(eq(schema.platformAdmins.email, email)))[0];
    if (!admin) throw new Error(`No admin with ${email}`);
    const password = await newPassword([email, admin.name]);
    await database.db.update(schema.platformAdmins).set({ passwordHash: await hash(password) }).where(eq(schema.platformAdmins.id, admin.id));
    await database.db.insert(schema.platformAuditLogs).values({ adminId: admin.id, action: 'admin.password_reset', after: { via: 'cli' } });
    console.log(`
Password changed for ${email}. The authenticator app does not change. Existing admin sign-ins end within 1 hour.`);
  } finally {
    await database.close();
  }
}

try {
  switch (command) {
    case 'gen-secrets':
      await genSecrets();
      break;
    case 'doctor':
      await doctor();
      break;
    case 'migrate':
      await runMigrate();
      break;
    case 'create-admin':
      await createAdmin(flags(rest));
      break;
    case 'create-tenant':
      await createTenant(flags(rest));
      break;
    case 'reset-password':
      await resetPassword(flags(rest));
      break;
    case 'reset-admin-password':
      await resetAdminPassword(flags(rest));
      break;
    default:
      console.log('Commands: gen-secrets | doctor | migrate | create-admin | create-tenant | reset-password | reset-admin-password');
      console.log('Example:  node cli.js create-admin --email you@example.com --name "Your Name"');
      process.exitCode = command ? 1 : 0;
  }
} catch (error) {
  console.error(`\nError: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
