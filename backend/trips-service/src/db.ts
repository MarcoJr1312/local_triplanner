// PostgreSQL access for the trips service. The service owns this database:
// there are no foreign keys to the platform `users` table and no cross-store
// reads.

import {
  Pool,
  types,
  type PoolClient,
  type PoolConfig,
  type QueryResultRow,
} from 'pg';
import type { Config } from './env.ts';

// The GraphQL layer consumes timestamps as ISO strings.
types.setTypeParser(types.builtins.TIMESTAMPTZ, (value) => new Date(value).toISOString());

export interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<T[]>;
  one<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<T | null>;
  run(sql: string, params?: readonly unknown[]): Promise<number>;
  /** Simple-protocol execution for multi-statement DDL. No parameters. */
  exec(sql: string): Promise<void>;
}

export interface Db extends Queryable {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  ping(): Promise<void>;
  isMigrated(): Promise<boolean>;
  outboxPending(): Promise<number>;
  close(): Promise<void>;
}

/** Latest schema version applied by src/db/migrate.ts. */
export const LATEST_SCHEMA_VERSION = 3;

class Sql implements Queryable {
  constructor(private readonly client: Pool | PoolClient) {}

  async query<T extends QueryResultRow>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<T[]> {
    const result = await this.client.query<T>(sql, params as unknown[]);
    return result.rows;
  }

  async one<T extends QueryResultRow>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  async run(sql: string, params: readonly unknown[] = []): Promise<number> {
    const result = await this.client.query(sql, params as unknown[]);
    return result.rowCount ?? 0;
  }

  async exec(sql: string): Promise<void> {
    await this.client.query(sql);
  }
}

function poolConfig(config: Config): PoolConfig {
  if (config.databaseUrl) {
    return { connectionString: config.databaseUrl, max: 10 };
  }
  return {
    host: config.postgres.host,
    port: config.postgres.port,
    database: config.postgres.database,
    user: config.postgres.user,
    // An empty password means trust auth (local dev); omit the key instead of
    // sending an empty string.
    password: config.postgres.password === '' ? undefined : config.postgres.password,
    max: 10,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function connect(config: Config): Promise<Db> {
  const pool = new Pool(poolConfig(config));
  let lastError: unknown;

  for (let attempt = 1; attempt <= config.dbConnectAttempts; attempt += 1) {
    try {
      await pool.query('SELECT 1');
      return new TripsDb(pool);
    } catch (error) {
      lastError = error;
      if (attempt === config.dbConnectAttempts) break;
      console.error(`[trips] Postgres not ready (attempt ${attempt}/${config.dbConnectAttempts})`);
      await sleep(config.dbConnectDelayMs);
    }
  }

  await pool.end().catch(() => undefined);
  throw lastError instanceof Error ? lastError : new Error('Postgres unavailable');
}

class TripsDb extends Sql implements Db {
  constructor(private readonly pool: Pool) {
    super(pool);
  }

  async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(new Sql(client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async ping(): Promise<void> {
    await this.query('SELECT 1 AS ok');
  }

  async isMigrated(): Promise<boolean> {
    const table = await this.one<{ table: string | null }>(
      "SELECT to_regclass('public.schema_migrations')::text AS table",
    );
    if (!table?.table) return false;
    const row = await this.one<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM schema_migrations WHERE version >= $1',
      [LATEST_SCHEMA_VERSION],
    );
    return Number(row?.count ?? 0) > 0;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async outboxPending(): Promise<number> {
    const row = await this.one<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM outbox WHERE published_at IS NULL',
    );
    return Number(row?.count ?? 0);
  }
}
