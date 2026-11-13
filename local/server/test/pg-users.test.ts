// Integration test for the Postgres users port.
// Requires the compose service (docker compose up -d). Skips when unreachable.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PgDb } from '../src/pg/db.ts';
import { pgUrl } from './helpers/pg.ts';
import { migrate } from '../src/db/migrate.ts';
import { markWelcomeSent, upsertUserByEmail } from '../src/pg/users.ts';
import type { FirebaseClaims } from '../src/auth/verify.ts';

const url = pgUrl;

let db: PgDb | null = null;

before(async () => {
  try {
    db = await PgDb.connect(url);
    await migrate(url);
  } catch {
    db = null;
  }
});

after(async () => {
  await db?.close();
});

function claims(email: string, overrides: Partial<FirebaseClaims> = {}): FirebaseClaims {
  return { uid: randomUUID(), email, email_verified: true, ...overrides };
}

describe('users on Postgres', () => {
  test('creates a user once and reuses the row by email', async () => {
    if (!db) return;
    const email = `pg-test-${randomUUID()}@example.com`;

    const first = await upsertUserByEmail(db, claims(email, { name: 'Ana' }));
    assert.equal(first.created, true);
    assert.equal(first.user.email, email);
    assert.equal(first.user.display_name, 'Ana');
    assert.equal(typeof first.user.created_at, 'string');
    assert.ok(first.user.created_at.includes('T'));

    const second = await upsertUserByEmail(db, claims(email, { name: 'Ana Maria' }));
    assert.equal(second.created, false);
    assert.equal(second.user.id, first.user.id);
    // Existing custom display_name must not be overwritten by the token name.
    assert.equal(second.user.display_name, 'Ana');

    await db.prepare('DELETE FROM users WHERE id = ?').run(first.user.id);
  });

  test('keeps the first firebase_uid and syncs email_verified', async () => {
    if (!db) return;
    const email = `pg-test-${randomUUID()}@example.com`;
    const uid = randomUUID();

    const first = await upsertUserByEmail(db, claims(email, { uid, email_verified: false }));
    assert.equal(first.user.firebase_uid, uid);
    assert.equal(first.user.email_verified, 0);

    const second = await upsertUserByEmail(db, claims(email, { uid: randomUUID(), email_verified: true }));
    assert.equal(second.user.firebase_uid, uid);
    assert.equal(second.user.email_verified, 1);

    await db.prepare('DELETE FROM users WHERE id = ?').run(first.user.id);
  });

  test('marks the welcome email as sent', async () => {
    if (!db) return;
    const email = `pg-test-${randomUUID()}@example.com`;
    const { user } = await upsertUserByEmail(db, claims(email, { name: 'Bea' }));
    assert.equal(user.welcome_sent_at, null);

    await markWelcomeSent(db, user.id);
    const updated = await db
      .prepare('SELECT welcome_sent_at FROM users WHERE id = ?')
      .get<{ welcome_sent_at: string }>(user.id);
    assert.equal(typeof updated?.welcome_sent_at, 'string');

    await db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
  });
});
