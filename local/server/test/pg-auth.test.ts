// Integration tests for the Postgres auth slice.
// Requires the compose service (docker compose up -d). Skips when unreachable.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DEFAULT_DATABASE_URL, PgDb } from '../src/pg/db.ts';
import { migrate } from '../src/db/migrate.ts';
import { DEMO_USER_ID, ensureDemoUser, getCurrentUserId, resolveCurrentUserId, toProfile } from '../src/pg/auth.ts';
import type { FirebaseClaims } from '../src/auth/verify.ts';
import { AuthTokenError } from '../src/auth/verify.ts';

const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;

let db: PgDb | null = null;

before(async () => {
  try {
    db = await PgDb.connect(url);
    await migrate(url);
    await db.prepare('DELETE FROM users WHERE id = ?').run(DEMO_USER_ID);
  } catch {
    db = null;
  }
});

after(async () => {
  await db?.prepare('DELETE FROM users WHERE id = ?').run(DEMO_USER_ID);
  await db?.close();
});

function claims(email: string, overrides: Partial<FirebaseClaims> = {}): FirebaseClaims {
  return { uid: randomUUID(), email, email_verified: true, ...overrides };
}

describe('auth on Postgres', () => {
  test('ensureDemoUser is idempotent', async () => {
    if (!db) return;
    await ensureDemoUser(db);
    await ensureDemoUser(db);

    const rows = await db.prepare('SELECT id, email FROM users WHERE id = ?').all(DEMO_USER_ID);
    assert.equal(rows.length, 1);
    assert.equal((rows[0] as { email: string }).email, 'demo@triplanner.local');
  });

  test('request without headers falls back to the demo user', () => {
    assert.equal(getCurrentUserId(undefined), DEMO_USER_ID);
    assert.equal(getCurrentUserId({ headers: new Headers() }), DEMO_USER_ID);
    assert.equal(getCurrentUserId({ headers: {} }), DEMO_USER_ID);
  });

  test('x-user-id wins over the demo default', () => {
    assert.equal(getCurrentUserId({ headers: { 'x-user-id': '  u-42  ' } }), 'u-42');
    assert.equal(getCurrentUserId(new Request('http://local', { headers: { 'x-user-id': 'u-7' } })), 'u-7');
  });

  test('a bearer token resolves the user by email', async () => {
    if (!db) return;
    const email = `pg-auth-${randomUUID()}@example.com`;
    const verified = randomUUID();
    const request = new Request('http://local', { headers: { authorization: 'Bearer good-token' } });

    const first = await resolveCurrentUserId(db, request, async () => claims(email, { uid: verified }));
    const second = await resolveCurrentUserId(db, request, async () => claims(email, { uid: verified }));
    assert.equal(first, second);

    const row = await db.prepare('SELECT * FROM users WHERE id = ?').get<{ email: string; firebase_uid: string }>(first);
    assert.equal(row?.email, email);
    assert.equal(row?.firebase_uid, verified);

    await db.prepare('DELETE FROM users WHERE id = ?').run(first);
  });

  test('an invalid token propagates the verification error', async () => {
    if (!db) return;
    const request = new Request('http://local', { headers: { authorization: 'Bearer bad-token' } });
    await assert.rejects(
      () =>
        resolveCurrentUserId(db as PgDb, request, async () => {
          throw new AuthTokenError('Token de sesión inválido');
        }),
      AuthTokenError,
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
      firebase_uid: null,
      email_verified: 1,
      welcome_sent_at: null,
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
