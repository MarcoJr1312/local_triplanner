import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import type { Db } from '../src/db.ts';
import { migrate, SCHEMA_VERSION } from '../src/db/migrate.ts';
import { DEMO_ITEMS, DEMO_TRIP_ID, seedDemo } from '../src/db/seed.ts';
import { connectTestDb, resetSchema } from './helpers/pg.ts';

let db: Db | null = null;

beforeAll(async () => {
  db = await connectTestDb();
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

async function insertTrip(id: string, ownerId: string, inviteCode: string): Promise<void> {
  if (!db) return;
  await db.run(
    `INSERT INTO trips (id, name, start_date, end_date, owner_id, invite_code)
     VALUES ($1, $2, '2026-01-01', '2026-01-02', $3, $4)`,
    [id, `Trip ${id}`, ownerId, inviteCode],
  );
}

describe('migrate', () => {
  test('applies the latest version, reports readiness and is idempotent', async () => {
    if (!db) return;

    // beforeEach just migrated; a second run must not re-apply.
    const again = await migrate(db);
    expect(again.version).toBe(SCHEMA_VERSION);
    expect(again.applied).toBe(false);
    expect(again.tables).toEqual(
      expect.arrayContaining([
        'trips',
        'trip_members',
        'trip_items',
        'trip_item_reminders',
        'trip_item_reminder_recipients',
        'invitations',
        'outbox',
        'schema_migrations',
      ]),
    );
    expect(await db.isMigrated()).toBe(true);
  });

  test('applies from empty and records one row per version', async () => {
    if (!db) return;
    await resetSchema(db);

    const first = await migrate(db);
    expect(first.applied).toBe(true);
    expect(first.version).toBe(SCHEMA_VERSION);
    expect(first.applied_versions).toEqual([1, 2, 3, 4, 5]);

    expect(await count('SELECT COUNT(*)::int AS count FROM schema_migrations')).toBe(5);
    const versions = await db.query<{ version: number }>(
      'SELECT version FROM schema_migrations ORDER BY version',
    );
    expect(versions.map((row) => row.version)).toEqual([1, 2, 3, 4, 5]);
  });

  test('upgrades an existing v1 database and becomes ready', async () => {
    if (!db) return;
    await resetSchema(db);

    // Simulate a database created before local invitations.
    const v1 = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
    await db.exec(v1);
    await db.run('INSERT INTO schema_migrations (version) VALUES (1)');
    expect(await db.isMigrated()).toBe(false);

    const result = await migrate(db);
    expect(result.applied).toBe(true);
    expect(result.applied_versions).toEqual([2, 3, 4, 5]);
    expect(await db.isMigrated()).toBe(true);

    const column = await db.one<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'invitations' AND column_name = 'invitee_user_id'`,
    );
    expect(column?.column_name).toBe('invitee_user_id');
  });

  test('has no foreign key to a platform users table', async () => {
    if (!db) return;
    // An unknown owner is legal: identity lives in the API database.
    await insertTrip('t-ghost', 'ghost-user', 'GHOST1');
    expect(await count('SELECT COUNT(*)::int AS count FROM trips WHERE id = $1', ['t-ghost'])).toBe(1);

    const fk = await count(
      `SELECT COUNT(*)::int AS count
         FROM information_schema.table_constraints
        WHERE constraint_type = 'FOREIGN KEY'
          AND table_schema = 'public'
          AND constraint_name ILIKE '%users%'`,
    );
    expect(fk).toBe(0);
  });
});

describe('constraints', () => {
  test('allows exactly one owner membership per trip', async () => {
    if (!db) return;
    await insertTrip('t-owner', 'u1', 'OWNER1');
    await db.run(
      "INSERT INTO trip_members (trip_id, user_id, role) VALUES ('t-owner', 'u1', 'owner')",
    );

    let rejected = false;
    try {
      await db.run(
        "INSERT INTO trip_members (trip_id, user_id, role) VALUES ('t-owner', 'u2', 'owner')",
      );
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);

    await db.run(
      "INSERT INTO trip_members (trip_id, user_id, role) VALUES ('t-owner', 'u2', 'editor')",
    );
    expect(
      await count('SELECT COUNT(*)::int AS count FROM trip_members WHERE trip_id = $1', ['t-owner']),
    ).toBe(2);
  });

  test('rejects an owner invitation role and accepts viewer', async () => {
    if (!db) return;
    await insertTrip('t-invite', 'u1', 'INVITE1');

    let rejected = false;
    try {
      await db.run(
        `INSERT INTO invitations (id, trip_id, email, code, role, created_by)
         VALUES ('i-owner', 't-invite', 'a@example.com', 'OWNERCODE', 'owner', 'u1')`,
      );
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);

    await db.run(
      `INSERT INTO invitations (id, trip_id, email, code, role, created_by)
       VALUES ('i-viewer', 't-invite', 'a@example.com', 'VIEWERCODE', 'viewer', 'u1')`,
    );
    expect(
      await count('SELECT COUNT(*)::int AS count FROM invitations WHERE trip_id = $1', ['t-invite']),
    ).toBe(1);
  });

  test('enforces the local invitation channel and one pending invite per user', async () => {
    if (!db) return;
    await insertTrip('t-local', 'u1', 'LOCAL1');

    // A local invite needs an invitee and no email/code.
    let rejected = false;
    try {
      await db.run(
        `INSERT INTO invitations (id, trip_id, role, created_by, channel)
         VALUES ('l-missing', 't-local', 'viewer', 'u1', 'local')`,
      );
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);

    // An email invite still needs both fields.
    rejected = false;
    try {
      await db.run(
        `INSERT INTO invitations (id, trip_id, role, created_by, channel)
         VALUES ('e-missing', 't-local', 'viewer', 'u1', 'email')`,
      );
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);

    await db.run(
      `INSERT INTO invitations
         (id, trip_id, email, code, role, status, created_by, channel, invitee_user_id)
       VALUES ('l-1', 't-local', NULL, NULL, 'viewer', 'pending', 'u1', 'local', 'u2')`,
    );

    // One pending local invite per trip+invitee.
    rejected = false;
    try {
      await db.run(
        `INSERT INTO invitations
           (id, trip_id, email, code, role, status, created_by, channel, invitee_user_id)
         VALUES ('l-2', 't-local', NULL, NULL, 'editor', 'pending', 'u1', 'local', 'u2')`,
      );
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);

    // Declining frees the pair for a new invite.
    await db.run("UPDATE invitations SET status = 'declined' WHERE id = 'l-1'");
    await db.run(
      `INSERT INTO invitations
         (id, trip_id, email, code, role, status, created_by, channel, invitee_user_id)
       VALUES ('l-3', 't-local', NULL, NULL, 'editor', 'pending', 'u1', 'local', 'u2')`,
    );
    expect(
      await count('SELECT COUNT(*)::int AS count FROM invitations WHERE trip_id = $1', ['t-local']),
    ).toBe(2);
  });

  test('cascade deletes members, items and invitations with the trip', async () => {
    if (!db) return;
    await insertTrip('t-cascade', 'u1', 'CASCADE1');
    await db.run("INSERT INTO trip_members (trip_id, user_id, role) VALUES ('t-cascade', 'u1', 'owner')");
    await db.run(
      `INSERT INTO trip_items (id, trip_id, title, day)
       VALUES ('item-1', 't-cascade', 'Museum', '2026-01-01')`,
    );
    await db.run(
      `INSERT INTO invitations (id, trip_id, email, code, role, created_by)
       VALUES ('inv-1', 't-cascade', 'a@example.com', 'CASCADECODE', 'editor', 'u1')`,
    );

    await db.run('DELETE FROM trips WHERE id = $1', ['t-cascade']);

    expect(
      await count('SELECT COUNT(*)::int AS count FROM trip_members WHERE trip_id = $1', ['t-cascade']),
    ).toBe(0);
    expect(
      await count('SELECT COUNT(*)::int AS count FROM trip_items WHERE trip_id = $1', ['t-cascade']),
    ).toBe(0);
    expect(
      await count('SELECT COUNT(*)::int AS count FROM invitations WHERE trip_id = $1', ['t-cascade']),
    ).toBe(0);
  });

  test('accepts an outbox row and exposes it as pending', async () => {
    if (!db) return;
    await db.run(
      `INSERT INTO outbox (id, topic, event_key, payload)
       VALUES ('o1', 'TripInvitation', 'o1', '{"type":"email.invite.v1"}'::jsonb)`,
    );
    expect(
      await count('SELECT COUNT(*)::int AS count FROM outbox WHERE published_at IS NULL'),
    ).toBe(1);
  });
});

describe('demo seed', () => {
  test('creates one trip, one owner and nine items, idempotently', async () => {
    if (!db) return;

    const first = await seedDemo(db);
    expect(first.tripId).toBe(DEMO_TRIP_ID);
    expect(first.items).toBe(DEMO_ITEMS.length);

    expect(
      await count('SELECT COUNT(*)::int AS count FROM trips WHERE id = $1', [DEMO_TRIP_ID]),
    ).toBe(1);
    expect(
      await count('SELECT COUNT(*)::int AS count FROM trip_members WHERE trip_id = $1', [DEMO_TRIP_ID]),
    ).toBe(1);
    expect(
      await count('SELECT COUNT(*)::int AS count FROM trip_items WHERE trip_id = $1', [DEMO_TRIP_ID]),
    ).toBe(DEMO_ITEMS.length);

    await seedDemo(db);

    expect(
      await count('SELECT COUNT(*)::int AS count FROM trips WHERE id = $1', [DEMO_TRIP_ID]),
    ).toBe(1);
    expect(
      await count('SELECT COUNT(*)::int AS count FROM trip_items WHERE trip_id = $1', [DEMO_TRIP_ID]),
    ).toBe(DEMO_ITEMS.length);
  });
});
