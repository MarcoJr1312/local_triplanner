import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
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
  test('applies version 1, reports readiness and is idempotent', async () => {
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
        'invitations',
        'outbox',
        'schema_migrations',
      ]),
    );
    expect(await db.isMigrated()).toBe(true);
  });

  test('applies from empty and records exactly one version row', async () => {
    if (!db) return;
    await resetSchema(db);

    const first = await migrate(db);
    expect(first.applied).toBe(true);
    expect(first.version).toBe(SCHEMA_VERSION);

    const rows = await count('SELECT COUNT(*)::int AS count FROM schema_migrations');
    expect(rows).toBe(1);
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
