import { schema, type Database } from '@retailos/db';
import { lt } from 'drizzle-orm';

const { loginAttempts, refreshTokens } = schema;

const DAY = 86_400_000;

/**
 * Housekeeping for security tables so they do not grow forever:
 * login attempts are only needed for the lockout window (kept 30 days for investigations),
 * refresh tokens are kept 7 days past expiry so reuse of a stolen, expired token is still detected.
 */
export async function purgeStaleSecurityRows(db: Database, now = Date.now()): Promise<{ loginAttempts: number; refreshTokens: number }> {
  const [a] = await db.delete(loginAttempts).where(lt(loginAttempts.createdAt, new Date(now - 30 * DAY)));
  const [b] = await db.delete(refreshTokens).where(lt(refreshTokens.expiresAt, new Date(now - 7 * DAY)));
  return { loginAttempts: a.affectedRows, refreshTokens: b.affectedRows };
}

/** Run at start and every 6 hours. Never keeps the process alive and never throws. */
export function schedulePurge(db: Database, log: (message: string) => void): () => void {
  const run = () =>
    purgeStaleSecurityRows(db)
      .then((n) => {
        if (n.loginAttempts || n.refreshTokens) log(`Purged ${n.loginAttempts} old login attempts and ${n.refreshTokens} expired sessions`);
      })
      .catch((error: unknown) => log(`Security table cleanup failed: ${error instanceof Error ? error.message : String(error)}`));
  void run();
  const timer = setInterval(run, 6 * 3_600_000);
  timer.unref();
  return () => clearInterval(timer);
}
