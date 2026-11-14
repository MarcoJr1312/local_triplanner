// Applies backend/db/pg/schema.sql to $DATABASE_URL (idempotent).
// Used by `bun run db:migrate` locally and by the ECS migration task in wake.yml.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { resolveDatabaseUrl } from '../pg/config.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Repo layout: backend/server/src/db -> backend/db/pg/schema.sql (three levels up).
// Container layout: /app/src/db -> /app/db/pg/schema.sql (two levels up).
const SCHEMA_PATH =
  [
    path.resolve(__dirname, '..', '..', '..', 'db', 'pg', 'schema.sql'),
    path.resolve(__dirname, '..', '..', 'db', 'pg', 'schema.sql'),
  ].find((candidate) => existsSync(candidate)) ??
  path.resolve(__dirname, '..', '..', '..', 'db', 'pg', 'schema.sql');

export const DEFAULT_DATABASE_URL = 'postgres://triplanner:triplanner@localhost:5432/triplanner';

export async function migrate(databaseUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL): Promise<string[]> {
  const sql = readFileSync(SCHEMA_PATH, 'utf8');
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    const { rows } = await client.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
    );
    return rows.map((r) => r.tablename);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

if (import.meta.main) {
  resolveDatabaseUrl()
    .then((url) => migrate(url))
    .then((tables) => {
      // Never print the connection string: it may contain RDS credentials.
      console.log('schema applied');
      console.log(`tables: ${tables.join(', ')}`);
    })
    .catch((err) => {
      console.error('migration failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
