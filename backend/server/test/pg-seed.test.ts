import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { connectPg } from './helpers/pg.ts';
import type { PgDb } from '../src/pg/db.ts';
import { seedAll } from '../src/seed.ts';

let db: PgDb | null = null;

async function cleanDemo(conn: PgDb) {
  await conn.prepare("DELETE FROM users WHERE id = 'demo-user'").run();
  await conn.prepare("DELETE FROM users WHERE id = 'demo-friend'").run();
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
            WHERE id IN ('demo-user', 'demo-friend')`,
        )
        .get<{ users: number }>()) ?? { users: 0 };

    await seedAll(db);
    assert.equal((await counts()).users, 2);

    await seedAll(db);
    assert.equal((await counts()).users, 2);
  });
});
