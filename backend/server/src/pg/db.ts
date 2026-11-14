// Async Postgres handle shaped like the SQLite one the codebase already uses:
//
//   await db.prepare(sql).get(...) | .all(...) | .run(...)
//
// Keeping the shape means porting a call site is mostly adding `await`.
// Placeholders stay `?` / `:name`; query.ts rewrites them per statement.

import { Pool, types, type PoolClient } from 'pg';
import { rewriteQuery } from './query.ts';

export const DEFAULT_DATABASE_URL = 'postgres://triplanner:triplanner@localhost:5432/triplanner';

// timestamptz -> ISO-8601 string. The app has always consumed timestamps as
// strings; returning Date objects would change every mapper at once.
types.setTypeParser(types.builtins.TIMESTAMPTZ, (value) => new Date(value).toISOString());

export interface RunResult {
  changes: number;
}

export interface Statement {
  run(...params: unknown[]): Promise<RunResult>;
  get<T = Record<string, unknown>>(...params: unknown[]): Promise<T | undefined>;
  all<T = Record<string, unknown>>(...params: unknown[]): Promise<T[]>;
}

export interface AsyncDb {
  prepare(sql: string): Statement;
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: AsyncDb) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

class PgStatement implements Statement {
  constructor(private readonly db: PgDb, private readonly sql: string) {}

  async run(...params: unknown[]): Promise<RunResult> {
    const result = await this.db.query(this.sql, params);
    return { changes: result.rowCount ?? 0 };
  }

  async get<T = Record<string, unknown>>(...params: unknown[]): Promise<T | undefined> {
    const result = await this.db.query(this.sql, params);
    return result.rows[0] as T | undefined;
  }

  async all<T = Record<string, unknown>>(...params: unknown[]): Promise<T[]> {
    const result = await this.db.query(this.sql, params);
    return result.rows as T[];
  }
}

export class PgDb implements AsyncDb {
  private constructor(
    private readonly pool: Pool,
    private readonly client: PoolClient | null = null,
  ) {}

  static async connect(databaseUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL): Promise<PgDb> {
    const pool = new Pool({ connectionString: databaseUrl, max: 10 });
    // Fail fast instead of surfacing a connection error on the first request.
    const probe = await pool.connect();
    probe.release();
    return new PgDb(pool);
  }

  prepare(sql: string): Statement {
    return new PgStatement(this, sql);
  }

  async query(sql: string, params: unknown[] = []) {
    const { text, values } = rewriteQuery(sql, params);
    const runner = this.client ?? this.pool;
    return runner.query(text, values);
  }

  async exec(sql: string): Promise<void> {
    const runner = this.client ?? this.pool;
    await runner.query(sql);
  }

  async transaction<T>(fn: (tx: AsyncDb) => Promise<T>): Promise<T> {
    if (this.client) throw new Error('nested transactions are not supported');
    const client = await this.pool.connect();
    const tx = new PgDb(this.pool, client);
    try {
      await client.query('BEGIN');
      const result = await fn(tx);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
