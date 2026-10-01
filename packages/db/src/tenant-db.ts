import { and, eq, isNull, type SQL } from 'drizzle-orm';
import type { MySqlColumn, MySqlTable } from 'drizzle-orm/mysql-core';
import type { DbOrTx } from './client.js';

/**
 * Tenant isolation layer (docs/phase-1/01 §3, layer 4).
 *
 * MySQL has no row-level security, so every read and write of tenant data goes through
 * this class. It adds `tenant_id = ?` to every WHERE and forces `tenant_id` on every insert,
 * ignoring any tenant id in the payload. It is constructed only from an authenticated
 * context; there is no way to create one without a tenant id (fails closed).
 */
export type TenantTable = MySqlTable & { tenantId: MySqlColumn };
type SoftDeletable = TenantTable & { deletedAt: MySqlColumn };

export class TenantDb {
  constructor(
    readonly db: DbOrTx,
    readonly tenantId: string,
  ) {
    if (!tenantId || typeof tenantId !== 'string') {
      throw new Error('TenantDb requires a tenant id from the authenticated context');
    }
  }

  /** `tenant_id = ?` for a table, optionally AND-ed with more conditions. Use in joins too. */
  scope(table: TenantTable, ...conditions: (SQL | undefined)[]): SQL {
    return and(eq(table.tenantId, this.tenantId), ...conditions) as SQL;
  }

  /** Same as scope() but also excludes soft-deleted rows. */
  active(table: SoftDeletable, ...conditions: (SQL | undefined)[]): SQL {
    return this.scope(table, isNull(table.deletedAt), ...conditions);
  }

  select<T extends TenantTable>(table: T, where?: SQL) {
    return this.db.select().from(table as MySqlTable).where(this.scope(table, where));
  }

  insert<T extends TenantTable>(table: T, values: T['$inferInsert'] | T['$inferInsert'][]) {
    const rows = (Array.isArray(values) ? values : [values]).map((row) => ({
      ...row,
      tenantId: this.tenantId,
    }));
    return this.db.insert(table).values(rows as T['$inferInsert'][]);
  }

  update<T extends TenantTable>(table: T, set: Partial<T['$inferInsert']>, where: SQL) {
    const { tenantId: _ignored, ...safeSet } = set as Record<string, unknown>;
    return this.db
      .update(table)
      .set(safeSet as never)
      .where(this.scope(table, where));
  }

  delete<T extends TenantTable>(table: T, where: SQL) {
    return this.db.delete(table).where(this.scope(table, where));
  }

  /** Run a transaction whose handle is also tenant-scoped. */
  async transaction<R>(fn: (tdb: TenantDb) => Promise<R>): Promise<R> {
    if (!('transaction' in this.db)) throw new Error('Nested transactions are not supported');
    return (this.db as { transaction: (cb: (tx: DbOrTx) => Promise<R>) => Promise<R> }).transaction((tx) =>
      fn(new TenantDb(tx, this.tenantId)),
    );
  }
}
