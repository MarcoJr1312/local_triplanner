// Schema runner. One transaction, one advisory lock, one row per version.
// The service only ever migrates its own database.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { connect, LATEST_SCHEMA_VERSION, type Db, type Queryable } from '../db.ts';
import { loadConfig, loadDotEnv } from '../env.ts';

export const SCHEMA_VERSION = LATEST_SCHEMA_VERSION;
const MIGRATION_LOCK_ID = 740_001;

interface Migration {
  version: number;
  path: string;
}

// Ordered, append-only. Existing databases apply only the missing versions.
const MIGRATIONS: Migration[] = [
  { version: 1, path: '../../db/schema.sql' },
  { version: 2, path: '../../db/migrations/002-local-invitations.sql' },
  { version: 3, path: '../../db/migrations/003-activity-reminders.sql' },
  { version: 4, path: '../../db/migrations/004-demo-timezone.sql' },
];

export interface MigrateResult {
  version: number;
  applied: boolean;
  applied_versions: number[];
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
  const sqlByVersion = new Map<number, string>();
  for (const migration of MIGRATIONS) {
    const path = fileURLToPath(new URL(migration.path, import.meta.url));
    sqlByVersion.set(migration.version, await readFile(path, 'utf8'));
  }

  return db.transaction(async (tx) => {
    // Serializes concurrent boots; released on commit or rollback.
    await tx.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK_ID]);
    await tx.exec(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version    integer PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );

    const existing = await tx.query<{ version: number }>(
      'SELECT version FROM schema_migrations ORDER BY version',
    );
    const appliedVersions = new Set(existing.map((row) => Number(row.version)));
    const applied: number[] = [];

    for (const migration of MIGRATIONS) {
      if (appliedVersions.has(migration.version)) continue;
      const sql = sqlByVersion.get(migration.version);
      if (!sql) throw new Error(`missing migration ${migration.version}`);
      await tx.exec(sql);
      await tx.run('INSERT INTO schema_migrations (version) VALUES ($1)', [
        migration.version,
      ]);
      applied.push(migration.version);
    }

    return {
      version: SCHEMA_VERSION,
      applied: applied.length > 0,
      applied_versions: applied,
      tables: await listTables(tx),
    };
  });
}

if (import.meta.main) {
  loadDotEnv();
  const config = loadConfig();
  const db = await connect(config);
  try {
    const result = await migrate(db);
    const state = result.applied
      ? `applied ${result.applied_versions.join(', ')}`
      : 'already applied';
    console.log(`[trips] schema v${result.version} ${state} (${result.tables.join(', ')})`);
  } finally {
    await db.close();
  }
}
