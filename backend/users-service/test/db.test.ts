import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import type { Db } from '../src/db.ts';
import { migrate, SCHEMA_VERSION } from '../src/db/migrate.ts';
import {
  DEMO_FRIEND_UUID,
  DEMO_PASSWORD,
  DEMO_USER_UUID,
  isProtectedUserId,
  seedDemoUsers,
} from '../src/db/seed.ts';
import { connectTestDb, resetSchema } from './helpers/pg.ts';

let db: Db | null = null;

beforeAll(async () => {
  db = await connectTestDb();
  if (db) console.log('[users] test database connected');
  else console.warn('[users] test database unavailable; db tests return early');
});

beforeEach(async () => {
  if (!db) return;
  await resetSchema(db);
  await migrate(db);
});

async function count(sql: string, params: unknown[] = []): Promise<number> {
  if (!db) return -1;
  const row = await db.one<{ count: number }>(sql, params);
  return Number(row?.count ?? 0);
}

async function insertUser(overrides: {
  id?: string;
  username: string;
  email?: string | null;
  passwordHash?: string;
  deletedAt?: string | null;
}): Promise<string> {
  if (!db) return '';
  const id = overrides.id ?? randomUUID();
  await db.run(
    `INSERT INTO users (id, username, email, password_hash, display_name, deleted_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      id,
      overrides.username,
      overrides.email ?? null,
      overrides.passwordHash ?? '$argon2id$test-placeholder',
      `User ${overrides.username}`,
      overrides.deletedAt ?? null,
    ],
  );
  return id;
}

describe('migrate', () => {
  test('applies version 1, reports readiness and is idempotent', async () => {
    if (!db) return;

    // beforeEach just migrated; a second run must not re-apply.
    const again = await migrate(db);
    expect(again.version).toBe(SCHEMA_VERSION);
    expect(again.applied).toBe(false);
    expect(again.tables).toEqual(
      expect.arrayContaining(['users', 'notifications', 'schema_migrations']),
    );
    expect(await db.isMigrated()).toBe(true);
  });

  test('applies from empty and records exactly one version row', async () => {
    if (!db) return;
    await resetSchema(db);

    expect(await db.isMigrated()).toBe(false);

    const first = await migrate(db);
    expect(first.applied).toBe(true);
    expect(first.version).toBe(SCHEMA_VERSION);

    expect(await count('SELECT COUNT(*)::int AS count FROM schema_migrations')).toBe(1);
  });

  test('has no foreign key to another service database', async () => {
    if (!db) return;
    const fk = await count(
      `SELECT COUNT(*)::int AS count
         FROM information_schema.table_constraints
        WHERE constraint_type = 'FOREIGN KEY'
          AND table_schema = 'public'
          AND constraint_name ILIKE '%trip%'`,
    );
    expect(fk).toBe(0);
  });
});

describe('user constraints', () => {
  test('enforces unique usernames among active users', async () => {
    if (!db) return;
    await insertUser({ username: 'alice' });

    let rejected = false;
    try {
      await insertUser({ username: 'alice' });
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });

  test('rejects uppercase usernames', async () => {
    if (!db) return;
    let rejected = false;
    try {
      await insertUser({ username: 'Alice' });
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });

  test('frees the username and email after a soft delete', async () => {
    if (!db) return;
    const first = await insertUser({ username: 'alice', email: 'alice@example.com' });
    await db.run('UPDATE users SET deleted_at = now() WHERE id = $1', [first]);

    const second = await insertUser({ username: 'alice', email: 'alice@example.com' });
    expect(second).not.toBe(first);
    expect(await count('SELECT COUNT(*)::int AS count FROM users')).toBe(2);
  });

  test('keeps emails unique when present and allows many NULLs', async () => {
    if (!db) return;
    await insertUser({ username: 'one', email: 'one@example.com' });

    let rejected = false;
    try {
      await insertUser({ username: 'two', email: 'ONE@example.com' });
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);

    await insertUser({ username: 'three', email: null });
    await insertUser({ username: 'four', email: null });
    expect(await count('SELECT COUNT(*)::int AS count FROM users WHERE email IS NULL')).toBe(2);
  });

  test('requires a password hash and a valid language', async () => {
    if (!db) return;

    let rejected = false;
    try {
      await db.run(
        `INSERT INTO users (id, username, password_hash, display_name)
         VALUES ($1, 'nohash', NULL, 'No Hash')`,
        [randomUUID()],
      );
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);

    rejected = false;
    try {
      await db.run(
        `INSERT INTO users (id, username, password_hash, display_name, language)
         VALUES ($1, 'badlang', 'x', 'Bad Language', 'fr')`,
        [randomUUID()],
      );
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });
});

describe('notification constraints', () => {
  async function insertNotification(
    userId: string,
    invitationId = 'inv-1',
    overrides: { type?: string; role?: string; status?: string; inviter?: string } = {},
  ): Promise<string> {
    if (!db) return '';
    const id = randomUUID();
    await db.run(
      `INSERT INTO notifications
         (id, user_id, type, trip_id, trip_name, invitation_id, inviter_user_id, role, status)
       VALUES ($1, $2, $3, 'trip-1', 'Toronto', $4, $5, $6, $7)`,
      [
        id,
        userId,
        overrides.type ?? 'trip_invite',
        invitationId,
        overrides.inviter ?? null,
        overrides.role ?? 'viewer',
        overrides.status ?? 'unread',
      ],
    );
    return id;
  }

  test('accepts a local invite and only the documented statuses', async () => {
    if (!db) return;
    const userId = await insertUser({ username: 'invitee' });
    const inviter = await insertUser({ username: 'inviter' });

    await insertNotification(userId, 'inv-ok', { inviter });

    for (const overrides of [
      { status: 'pending' },
      { type: 'email' },
      { role: 'owner' },
    ]) {
      let rejected = false;
      try {
        await insertNotification(userId, `inv-${JSON.stringify(overrides)}`, overrides);
      } catch {
        rejected = true;
      }
      expect(rejected).toBe(true);
    }
  });

  test('makes (user, invitation) idempotent', async () => {
    if (!db) return;
    const userId = await insertUser({ username: 'invitee' });
    await insertNotification(userId, 'inv-duplicate');

    let rejected = false;
    try {
      await insertNotification(userId, 'inv-duplicate');
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
    expect(await count('SELECT COUNT(*)::int AS count FROM notifications')).toBe(1);
  });

  test('cascades notifications on a hard user delete', async () => {
    if (!db) return;
    const userId = await insertUser({ username: 'invitee' });
    await insertNotification(userId);

    await db.run('DELETE FROM users WHERE id = $1', [userId]);
    expect(await count('SELECT COUNT(*)::int AS count FROM notifications')).toBe(0);
  });

  test('keeps the notification when the inviter is deleted', async () => {
    if (!db) return;
    const userId = await insertUser({ username: 'invitee' });
    const inviter = await insertUser({ username: 'inviter' });
    await insertNotification(userId, 'inv-keep', { inviter });

    await db.run('DELETE FROM users WHERE id = $1', [inviter]);
    const row = await db.one<{ inviter_user_id: string | null }>(
      'SELECT inviter_user_id FROM notifications WHERE invitation_id = $1',
      ['inv-keep'],
    );
    expect(row?.inviter_user_id).toBeNull();
  });
});

describe('demo seed', () => {
  test('creates both protected accounts with fixed UUIDs and Argon2id passwords', async () => {
    if (!db) return;

    const first = await seedDemoUsers(db);
    expect(first.created).toBe(2);
    expect(first.total).toBe(2);

    const demo = await db.one<{
      id: string;
      username: string;
      email: string;
      display_name: string;
      password_hash: string;
      language: string;
    }>('SELECT * FROM users WHERE id = $1', [DEMO_USER_UUID]);
    expect(demo).toMatchObject({
      id: DEMO_USER_UUID,
      username: 'demo',
      email: 'demo@triplanner.local',
      display_name: 'Demo',
      language: 'en',
    });
    expect(demo?.password_hash.startsWith('$argon2id$')).toBe(true);
    expect(await Bun.password.verify(DEMO_PASSWORD, demo?.password_hash ?? '')).toBe(true);
    expect(await Bun.password.verify('wrong-password', demo?.password_hash ?? '')).toBe(false);

    const friend = await db.one<{ id: string; username: string }>(
      'SELECT id, username FROM users WHERE id = $1',
      [DEMO_FRIEND_UUID],
    );
    expect(friend).toEqual({ id: DEMO_FRIEND_UUID, username: 'demo-friend' });

    expect(isProtectedUserId(DEMO_USER_UUID)).toBe(true);
    expect(isProtectedUserId(DEMO_FRIEND_UUID)).toBe(true);
    expect(isProtectedUserId(randomUUID())).toBe(false);
  });

  test('is idempotent and never rewrites existing accounts', async () => {
    if (!db) return;
    await seedDemoUsers(db);
    const before = await db.one<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE id = $1',
      [DEMO_USER_UUID],
    );

    const second = await seedDemoUsers(db);
    expect(second.created).toBe(0);

    const after = await db.one<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE id = $1',
      [DEMO_USER_UUID],
    );
    expect(after?.password_hash).toBe(before?.password_hash);
    expect(await count('SELECT COUNT(*)::int AS count FROM users')).toBe(2);
  });
});
