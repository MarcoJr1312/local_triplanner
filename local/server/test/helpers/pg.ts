// Shared fixtures for the Postgres integration tests.
// Every helper returns null-safe handles so suites skip when Postgres is down.

import { randomUUID } from 'node:crypto';
import { DEFAULT_DATABASE_URL, PgDb } from '../../src/pg/db.ts';
import { migrate } from '../../src/db/migrate.ts';

export const pgUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;

export async function connectPg(): Promise<PgDb | null> {
  try {
    const db = await PgDb.connect(pgUrl);
    await migrate(pgUrl);
    return db;
  } catch {
    return null;
  }
}

export async function insertUser(db: PgDb, displayName = 'Test User'): Promise<string> {
  const id = randomUUID();
  await db
    .prepare('INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)')
    .run(id, `test-${id}@example.com`, displayName);
  return id;
}

export async function insertTrip(db: PgDb, ownerId: string): Promise<string> {
  const id = randomUUID();
  await db
    .prepare(
      `INSERT INTO trips (id, name, start_date, end_date, owner_id, invite_code)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, 'Trip de prueba', '2026-01-01', '2026-01-05', ownerId, randomUUID().replaceAll('-', '').slice(0, 12));
  return id;
}

export async function deleteTrip(db: PgDb, tripId: string): Promise<void> {
  await db.prepare('DELETE FROM invitations WHERE trip_id = ?').run(tripId);
  await db.prepare('DELETE FROM trips WHERE id = ?').run(tripId);
}

export async function deleteUser(db: PgDb, userId: string): Promise<void> {
  await db.prepare('DELETE FROM user_favorites WHERE user_id = ?').run(userId);
  await db.prepare('DELETE FROM user_interests WHERE user_id = ?').run(userId);
  await db.prepare('DELETE FROM suggestion_chats WHERE user_id = ?').run(userId);
  await db.prepare('DELETE FROM trips WHERE owner_id = ?').run(userId);
  await db.prepare('DELETE FROM users WHERE id = ?').run(userId);
}
