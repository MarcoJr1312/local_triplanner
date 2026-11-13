// Applies local/db/pg/schema.sql to $DATABASE_URL (idempotent).
// Used by `bun run db:migrate` locally and by the ECS migration task in wake.yml.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(__dirname, '..', '..', '..', 'db', 'pg', 'schema.sql');

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
  migrate()
    .then((tables) => {
      console.log(`schema applied to ${process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL}`);
      console.log(`tables: ${tables.join(', ')}`);
    })
    .catch((err) => {
      console.error('migration failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
