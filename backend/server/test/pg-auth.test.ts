// Demo auth tests for the local runner. No Firebase: identity is x-user-id.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { PgDb } from '../src/pg/db.ts';
import { pgUrl } from './helpers/pg.ts';
import { migrate } from '../src/db/migrate.ts';
import {
  DEMO_FRIEND_ID,
  DEMO_USER_ID,
  ensureDemoUsers,
  getCurrentUserId,
  toProfile,
} from '../src/pg/auth.ts';

let db: PgDb | null = null;

async function cleanDemo(conn: PgDb) {
  await conn.prepare('DELETE FROM users WHERE id IN (?, ?)').run(DEMO_USER_ID, DEMO_FRIEND_ID);
}

before(async () => {
  try {
    db = await PgDb.connect(pgUrl);
    await migrate(pgUrl);
    await cleanDemo(db);
  } catch {
    db = null;
  }
});

after(async () => {
  if (db) await cleanDemo(db);
  await db?.close();
});

describe('demo auth on Postgres', () => {
  test('ensureDemoUsers is idempotent and seeds both identities', async () => {
    if (!db) return;
    await ensureDemoUsers(db);
    await ensureDemoUsers(db);

    const rows = await db
      .prepare('SELECT id, email, display_name FROM users WHERE id IN (?, ?) ORDER BY id')
      .all(DEMO_FRIEND_ID, DEMO_USER_ID);
    assert.equal(rows.length, 2);

    const byId = new Map(rows.map((row) => [(row as { id: string }).id, row]));
    assert.equal((byId.get(DEMO_USER_ID) as { email: string }).email, 'demo@triplanner.local');
    assert.equal((byId.get(DEMO_FRIEND_ID) as { email: string }).email, 'friend@triplanner.local');
  });

  test('request without headers falls back to the demo user', () => {
    assert.equal(getCurrentUserId(undefined), DEMO_USER_ID);
    assert.equal(getCurrentUserId({ headers: new Headers() }), DEMO_USER_ID);
    assert.equal(getCurrentUserId({ headers: {} }), DEMO_USER_ID);
  });

  test('x-user-id wins over the demo default', () => {
    assert.equal(getCurrentUserId({ headers: { 'x-user-id': '  u-42  ' } }), 'u-42');
    assert.equal(
      getCurrentUserId(new Request('http://local', { headers: { 'x-user-id': 'u-7' } })),
      'u-7',
    );
  });

  test('toProfile maps the row to the GraphQL shape', () => {
    const profile = toProfile({
      id: 'u1',
      email: 'a@b.c',
      display_name: 'Ana',
      color: null,
      avatar_url: 'http://img',
      language: 'en',
      created_at: '2026-01-01T00:00:00.000Z',
    });
    assert.deepEqual(profile, {
      userId: 'u1',
      email: 'a@b.c',
      displayName: 'Ana',
      color: null,
      avatarUrl: 'http://img',
      language: 'en',
    });
  });
});
