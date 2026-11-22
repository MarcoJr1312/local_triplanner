import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { connectPg, cleanDemoUsers } from './helpers/pg.ts';
import type { PgDb } from '../src/pg/db.ts';
import { seedAll } from '../src/seed.ts';
import { DEMO_FRIEND_ID, DEMO_USER_ID } from '../src/pg/auth.ts';

let db: PgDb | null = null;

async function cleanDemo(conn: PgDb) {
  await cleanDemoUsers(conn);
}

before(async () => {
  db = await connectPg();
  if (db) await cleanDemo(db);
});

after(async () => {
  if (db) await cleanDemo(db);
  await db?.close();
});

describe('demo seed on Postgres', () => {
  test('writes the two demo identities idempotently', async () => {
    if (!db) return;

    const counts = async () =>
      (await db!
        .prepare(
          `SELECT count(*)::int AS users
             FROM users
            WHERE id IN (?, ?)`,
        )
        .get<{ users: number }>(DEMO_USER_ID, DEMO_FRIEND_ID)) ?? { users: 0 };

    await seedAll(db);
    assert.equal((await counts()).users, 2);

    await seedAll(db);
    assert.equal((await counts()).users, 2);
  });
});
