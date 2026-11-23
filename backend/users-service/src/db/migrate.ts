// Schema runner. One transaction, one advisory lock, one version row.
// The service only ever migrates its own database.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { connect, type Db, type Queryable } from '../db.ts';
import { loadConfig, loadDotEnv } from '../env.ts';

export const SCHEMA_VERSION = 2;
const MIGRATION_LOCK_ID = 740_002;
const SCHEMA_PATH = fileURLToPath(new URL('../../db/schema.sql', import.meta.url));

export interface MigrateResult {
  version: number;
  applied: boolean;
  tables: string[];
}

async function listTables(tx: Queryable): Promise<string[]> {
  const rows = await tx.query<{ table_name: string }>(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name`,
  );
  return rows.map((row) => row.table_name);
}

export async function migrate(db: Db): Promise<MigrateResult> {
  const sql = await readFile(SCHEMA_PATH, 'utf8');

  return db.transaction(async (tx) => {
    // Serializes concurrent boots; released on commit or rollback.
    await tx.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK_ID]);
    await tx.exec(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version    integer PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );

    const existing = await tx.one<{ version: number }>(
      'SELECT version FROM schema_migrations WHERE version = $1',
      [SCHEMA_VERSION],
    );
    if (existing) {
      return { version: SCHEMA_VERSION, applied: false, tables: await listTables(tx) };
    }

    await tx.exec(sql);
    await tx.run('INSERT INTO schema_migrations (version) VALUES ($1)', [SCHEMA_VERSION]);

    return { version: SCHEMA_VERSION, applied: true, tables: await listTables(tx) };
  });
}

if (import.meta.main) {
  loadDotEnv();
  const config = loadConfig();
  const db = await connect(config);
  try {
    const result = await migrate(db);
    const state = result.applied ? 'applied' : 'already applied';
    console.log(`[users] schema v${result.version} ${state} (${result.tables.join(', ')})`);
  } finally {
    await db.close();
  }
}
