// Fixed-UUID migration integration: scratch platform/trips/users databases.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { migrateUsers, stableUuid } from '../scripts/migrate-users.ts';
import { migrateFavorites } from '../scripts/migrate-favorites.ts';
import {
  DEMO_FRIEND_UUID,
  DEMO_PASSWORD,
  DEMO_USER_UUID,
} from '../src/db/seed.ts';

const ADMIN_URL =
  process.env.TEST_USERS_ADMIN_URL ?? 'postgres://users:users@127.0.0.1:55433/postgres';
const PLATFORM_DB = 'migration_platform';
const TRIPS_DB = 'migration_trips';
const USERS_DB = 'migration_users';

const PLATFORM_URL = ADMIN_URL.replace(/\/postgres($|\?)/, `/${PLATFORM_DB}$1`);
const TRIPS_URL = ADMIN_URL.replace(/\/postgres($|\?)/, `/${TRIPS_DB}$1`);
const USERS_URL = ADMIN_URL.replace(/\/postgres($|\?)/, `/${USERS_DB}$1`);

let admin: Client | null = null;
let available = false;

async function recreate(client: Client, name: string, sql: string): Promise<void> {
  await client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await client.query(`CREATE DATABASE ${name}`);
  const db = new Client({ connectionString: ADMIN_URL.replace(/\/postgres($|\?)/, `/${name}$1`) });
  await db.connect();
  try {
    await db.query(sql);
  } finally {
    await db.end();
  }
}

const PLATFORM_SQL = `
CREATE TABLE users (
  id text PRIMARY KEY,
  username text,
  email text UNIQUE,
  password_hash text,
  display_name text NOT NULL,
  color text,
  avatar_url text,
  language text NOT NULL DEFAULT 'en',
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE TABLE attachment_viewers (
  attachment_id text NOT NULL,
  user_id text NOT NULL REFERENCES users(id),
  PRIMARY KEY (attachment_id, user_id)
);
CREATE TABLE item_attachments (id text PRIMARY KEY, created_by text);
CREATE TABLE user_favorites (
  user_id text NOT NULL REFERENCES users(id),
  location_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, location_id)
);
CREATE TABLE notifications (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  inviter_user_id text,
  type text NOT NULL DEFAULT 'trip_invite',
  trip_id text NOT NULL DEFAULT 't1',
  trip_name text NOT NULL DEFAULT 'Toronto',
  invitation_id text NOT NULL DEFAULT 'i1',
  role text NOT NULL DEFAULT 'viewer',
  status text NOT NULL DEFAULT 'unread',
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);

INSERT INTO users (id, email, display_name, color, language) VALUES
  ('demo-user', 'demo@triplanner.local', 'Demo', '#6366f1', 'en'),
  ('demo-friend', 'friend@example.com', 'Demo Friend', '#10b981', 'es'),
  ('legacy-ana', 'ana@example.com', 'Ana Legacy', NULL, 'es');
INSERT INTO item_attachments (id, created_by) VALUES ('a1', 'legacy-ana');
INSERT INTO user_favorites (user_id, location_id) VALUES ('demo-user', 'tor-cn-tower');
INSERT INTO notifications (id, user_id, inviter_user_id) VALUES ('n1', 'demo-friend', 'demo-user');
`;

const TRIPS_SQL = `
CREATE TABLE trips (id text PRIMARY KEY, owner_id text NOT NULL);
CREATE TABLE trip_members (
  trip_id text NOT NULL,
  user_id text NOT NULL,
  role text NOT NULL,
  PRIMARY KEY (trip_id, user_id)
);
CREATE TABLE trip_items (id text PRIMARY KEY, created_by text);
CREATE TABLE invitations (
  id text PRIMARY KEY,
  created_by text NOT NULL,
  invitee_user_id text,
  channel text NOT NULL DEFAULT 'local'
);

INSERT INTO trips (id, owner_id) VALUES ('t1', 'demo-user');
INSERT INTO trip_members (trip_id, user_id, role) VALUES
  ('t1', 'demo-user', 'owner'),
  ('t1', 'demo-friend', 'editor');
INSERT INTO trip_items (id, created_by) VALUES ('i1', 'demo-user');
INSERT INTO invitations (id, created_by, invitee_user_id) VALUES
  ('inv1', 'demo-user', 'legacy-ana');
`;

async function scalar(client: Client, sql: string, params: unknown[] = []): Promise<unknown> {
  const result = await client.query(sql, params);
  return result.rows[0] ? Object.values(result.rows[0])[0] : undefined;
}

beforeAll(async () => {
  try {
    admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    const usersSchema = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
    await recreate(admin, PLATFORM_DB, PLATFORM_SQL);
    await recreate(admin, TRIPS_DB, TRIPS_SQL);
    await recreate(admin, USERS_DB, usersSchema);
    available = true;
  } catch {
    available = false;
    await admin?.end().catch(() => undefined);
    admin = null;
  }
});

afterAll(async () => {
  if (admin) {
    for (const name of [PLATFORM_DB, TRIPS_DB, USERS_DB]) {
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => undefined);
    }
    await admin.end();
  }
});

describe('migrateUsers', () => {
  test('dry-run reports the mapping and writes nothing', async () => {
    if (!available) return;

    const report = await migrateUsers({
      legacyUrl: PLATFORM_URL,
      tripsUrl: TRIPS_URL,
      usersUrl: USERS_URL,
      apply: false,
      log: () => undefined,
    });

    expect(report.applied).toBe(false);
    expect(report.users).toBe(3);
    expect(report.mappings.find((row) => row.oldId === 'demo-user')?.newId).toBe(
      DEMO_USER_UUID,
    );
    expect(report.mappings.find((row) => row.oldId === 'demo-friend')?.newId).toBe(
      DEMO_FRIEND_UUID,
    );
    expect(report.mappings.find((row) => row.oldId === 'legacy-ana')?.username).toBe('ana');

    const platform = new Client({ connectionString: PLATFORM_URL });
    const service = new Client({ connectionString: USERS_URL });
    await Promise.all([platform.connect(), service.connect()]);
    try {
      expect(await scalar(platform, "SELECT id FROM users WHERE id = 'demo-user'")).toBe(
        'demo-user',
      );
      expect(await scalar(service, 'SELECT COUNT(*)::int FROM users')).toBe(0);
    } finally {
      await platform.end();
      await service.end();
    }
  });

  test('applies UUIDs everywhere and is idempotent', async () => {
    if (!available) return;

    const first = await migrateUsers({
      legacyUrl: PLATFORM_URL,
      tripsUrl: TRIPS_URL,
      usersUrl: USERS_URL,
      apply: true,
      log: () => undefined,
    });
    expect(first.applied).toBe(true);
    expect(first.verification.non_uuid_platform_ids).toBe(0);
    expect(first.verification.dangling_references).toBe(0);

    const platform = new Client({ connectionString: PLATFORM_URL });
    const trips = new Client({ connectionString: TRIPS_URL });
    const service = new Client({ connectionString: USERS_URL });
    await Promise.all([platform.connect(), trips.connect(), service.connect()]);
    try {
      const ana = first.mappings.find((row) => row.oldId === 'legacy-ana');
      expect(ana).toBeDefined();
      const anaId = stableUuid('legacy-ana');
      expect(ana?.newId).toBe(anaId);

      expect(await scalar(platform, 'SELECT COUNT(*)::int FROM users')).toBe(3);
      expect(await scalar(platform, "SELECT user_id FROM user_favorites WHERE location_id = 'tor-cn-tower'")).toBe(
        DEMO_USER_UUID,
      );
      expect(await scalar(platform, "SELECT created_by FROM item_attachments WHERE id = 'a1'")).toBe(
        anaId,
      );
      expect(await scalar(platform, "SELECT user_id FROM notifications WHERE id = 'n1'")).toBe(
        DEMO_FRIEND_UUID,
      );
      expect(await scalar(platform, "SELECT inviter_user_id FROM notifications WHERE id = 'n1'")).toBe(
        DEMO_USER_UUID,
      );

      expect(await scalar(trips, "SELECT owner_id FROM trips WHERE id = 't1'")).toBe(
        DEMO_USER_UUID,
      );
      expect(await scalar(trips, "SELECT user_id FROM trip_members WHERE trip_id = 't1' AND role = 'editor'")).toBe(
        DEMO_FRIEND_UUID,
      );
      expect(await scalar(trips, "SELECT created_by FROM trip_items WHERE id = 'i1'")).toBe(
        DEMO_USER_UUID,
      );
      expect(await scalar(trips, "SELECT invitee_user_id FROM invitations WHERE id = 'inv1'")).toBe(
        anaId,
      );

      const demo = await service.query<{ username: string; password_hash: string }>(
        'SELECT username, password_hash FROM users WHERE id = $1',
        [DEMO_USER_UUID],
      );
      expect(demo.rows[0]?.username).toBe('demo');
      expect(demo.rows[0]?.password_hash.startsWith('$argon2id$')).toBe(true);
      expect(
        await Bun.password.verify(DEMO_PASSWORD, demo.rows[0]?.password_hash ?? ''),
      ).toBe(true);
      expect(await scalar(service, 'SELECT COUNT(*)::int FROM users')).toBe(3);

      const fk = await scalar(
        platform,
        `SELECT COUNT(*)::int FROM information_schema.table_constraints
          WHERE constraint_type = 'FOREIGN KEY' AND table_schema = 'public'
            AND constraint_name ILIKE '%users%'`,
      );
      expect(fk).toBe(0);
    } finally {
      await platform.end();
      await trips.end();
      await service.end();
    }

    // Second run: no writes, same ids.
    const second = await migrateUsers({
      legacyUrl: PLATFORM_URL,
      tripsUrl: TRIPS_URL,
      usersUrl: USERS_URL,
      apply: true,
      log: () => undefined,
    });
    expect(second.applied).toBe(true);
    expect(second.verification.non_uuid_platform_ids).toBe(0);
    expect(second.verification.dangling_references).toBe(0);
    expect(second.users).toBe(3);
  });

  test('copies favorites after the UUID cutover and is idempotent', async () => {
    if (!available) return;

    const first = await migrateFavorites({
      legacyUrl: PLATFORM_URL,
      usersUrl: USERS_URL,
      apply: true,
      log: () => undefined,
    });
    expect(first.applied).toBe(true);
    expect(first.read).toBe(1);
    expect(first.copied).toBe(1);

    const service = new Client({ connectionString: USERS_URL });
    await service.connect();
    try {
      expect(
        await scalar(
          service,
          'SELECT location_id FROM favorite_locations WHERE user_id = $1',
          [DEMO_USER_UUID],
        ),
      ).toBe('tor-cn-tower');
      expect(await scalar(service, 'SELECT COUNT(*)::int FROM favorite_locations')).toBe(1);
    } finally {
      await service.end();
    }

    const second = await migrateFavorites({
      legacyUrl: PLATFORM_URL,
      usersUrl: USERS_URL,
      apply: true,
      log: () => undefined,
    });
    expect(second.copied).toBe(0);
    expect(second.alreadyPresent).toBe(1);
  });
});
