// Shared fixtures for the Postgres integration tests.
// Tests never touch the dev database: they run against `triplanner_test`,
// created on demand. Every helper is null-safe so suites skip when Postgres
// is down.

import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { DEFAULT_DATABASE_URL, PgDb, type AsyncDb } from '../../src/pg/db.ts';
import { migrate } from '../../src/db/migrate.ts';

const ADMIN_URL = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
const TEST_DB = 'triplanner_test';

function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

export const pgUrl = process.env.TEST_DATABASE_URL ?? withDatabase(ADMIN_URL, TEST_DB);

async function ensureTestDatabase(): Promise<void> {
  if (process.env.TEST_DATABASE_URL) return;
  const client = new Client({ connectionString: ADMIN_URL });
  await client.connect();
  try {
    const { rows } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [TEST_DB]);
    if (rows.length === 0) await client.query(`CREATE DATABASE ${TEST_DB}`);
  } finally {
    await client.end();
  }
}

export async function connectPg(): Promise<PgDb | null> {
  try {
    await ensureTestDatabase();
    const db = await PgDb.connect(pgUrl);
    await migrate(pgUrl);
    return db;
  } catch {
    return null;
  }
}

/**
 * Identity is owned by the users service; platform tests only need an opaque
 * UUID for attachments, favorites and chats.
 */
export async function insertUser(_db: AsyncDb, _displayName = 'Test User'): Promise<string> {
  return randomUUID();
}

export async function deleteUser(db: AsyncDb, userId: string): Promise<void> {
  await db.prepare('DELETE FROM user_favorites WHERE user_id = ?').run(userId);
  await db.prepare('DELETE FROM user_interests WHERE user_id = ?').run(userId);
  await db.prepare('DELETE FROM suggestion_chats WHERE user_id = ?').run(userId);
  await db.prepare('DELETE FROM attachment_viewers WHERE user_id = ?').run(userId);
}
