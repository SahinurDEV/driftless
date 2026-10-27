/**
 * D1-compatible async wrapper over @libsql/client (local SQLite file).
 */
import { createClient, type Client, type InArgs } from '@libsql/client';
import type { DbAdapter, DbStatement } from '../types/env';

type Bound = { sql: string; args: InArgs };

class LibsqlStatement implements DbStatement {
  constructor(
    private client: Client,
    private sql: string,
    private args: InArgs = [],
  ) {}

  bind(...values: unknown[]): DbStatement {
    return new LibsqlStatement(this.client, this.sql, values as InArgs);
  }

  async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
    const rs = await this.client.execute({ sql: this.sql, args: this.args });
    const row = rs.rows[0];
    if (!row) return null;
    if (colName) return (row[colName] as T) ?? null;
    return rowToObject(row) as T;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    const rs = await this.client.execute({ sql: this.sql, args: this.args });
    return { results: rs.rows.map((r) => rowToObject(r) as T) };
  }

  async run(): Promise<{ success: boolean; meta?: { changes?: number } }> {
    const rs = await this.client.execute({ sql: this.sql, args: this.args });
    return { success: true, meta: { changes: rs.rowsAffected } };
  }

  /** Internal: expose bound SQL for batch */
  _bound(): Bound {
    return { sql: this.sql, args: this.args };
  }
}

function rowToObject(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    if (Number.isNaN(Number(key))) out[key] = row[key];
  }
  // libsql rows are array-like with named props
  return { ...out };
}

export class LibsqlDb implements DbAdapter {
  constructor(public client: Client) {}

  prepare(query: string): DbStatement {
    return new LibsqlStatement(this.client, query);
  }

  async batch(statements: DbStatement[]): Promise<unknown[]> {
    const batch = statements.map((s) => {
      const b = (s as LibsqlStatement)._bound();
      return { sql: b.sql, args: b.args };
    });
    const results = await this.client.batch(batch, 'write');
    return results;
  }
}

export function openLibsql(dbPath: string): LibsqlDb {
  const client = createClient({ url: `file:${dbPath}` });
  return new LibsqlDb(client);
}
