import './env.js';
import { hash } from '@node-rs/argon2';
import { eq } from 'drizzle-orm';
import { createDb } from './client.js';
import { provisionTenant, seedReferenceData } from './provisioning.js';
import { tenants } from './schema/index.js';

/**
 * Seeds reference data (plans, features, permissions, units) and, in development,
 * the first tenant "Al Noor Mart" with an owner login taken from SEED_OWNER_* variables.
 */
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

const { db, close } = createDb(url, { connectionLimit: 1 });
await seedReferenceData(db);
console.log('Reference data seeded');

const email = process.env.SEED_OWNER_EMAIL;
const password = process.env.SEED_OWNER_PASSWORD;
if (email && password) {
  const existing = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, 'al-noor-mart'));
  if (existing[0]) {
    console.log('Tenant al-noor-mart already exists');
  } else {
    const result = await provisionTenant(db, {
      name: 'Al Noor Mart',
      slug: 'al-noor-mart',
      planCode: 'business',
      owner: { name: process.env.SEED_OWNER_NAME ?? 'Owner', email, passwordHash: await hash(password) },
      trialDays: 365,
    });
    console.log(`Tenant Al Noor Mart created (${result.tenantId})`);
  }
} else {
  console.log('SEED_OWNER_EMAIL / SEED_OWNER_PASSWORD not set: skipped first tenant');
}
await close();
