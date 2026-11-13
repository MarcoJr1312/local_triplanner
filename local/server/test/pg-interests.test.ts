import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { connectPg, deleteUser, insertUser } from './helpers/pg.ts';
import type { PgDb } from '../src/pg/db.ts';
import { listUserInterests, replaceUserInterests } from '../src/pg/interests.ts';

let db: PgDb | null = null;

before(async () => {
  db = await connectPg();
});

after(async () => {
  await db?.close();
});

describe('interests on Postgres', () => {
  test('normalizes, dedupes and preserves the saved order', async () => {
    if (!db) return;
    const userId = await insertUser(db);
    const synced: string[][] = [];

    const saved = await replaceUserInterests(db, userId, [' Food ', 'food', 'MUSEUMS', '', 'hiking'], async (_u, terms) => {
      synced.push([...terms]);
    });

    assert.deepEqual(saved, ['food', 'museums', 'hiking']);
    assert.deepEqual(await listUserInterests(db, userId), ['food', 'museums', 'hiking']);
    assert.deepEqual(synced, [['food', 'museums', 'hiking']]);

    await deleteUser(db, userId);
  });

  test('replaces the previous list instead of appending', async () => {
    if (!db) return;
    const userId = await insertUser(db);
    await replaceUserInterests(db, userId, ['food', 'museums'], async () => {});
    await replaceUserInterests(db, userId, ['nightlife'], async () => {});

    assert.deepEqual(await listUserInterests(db, userId), ['nightlife']);

    await deleteUser(db, userId);
  });

  test('keeps insertion order inside one write (identity column)', async () => {
    if (!db) return;
    const userId = await insertUser(db);
    const terms = Array.from({ length: 10 }, (_, i) => `term-${i}`);

    await replaceUserInterests(db, userId, terms, async () => {});
    // created_at is identical for all rows (one transaction); seq must order them.
    assert.deepEqual(await listUserInterests(db, userId), terms);

    await deleteUser(db, userId);
  });

  test('still commits when the agent sync fails', async () => {
    if (!db) return;
    const userId = await insertUser(db);
    await replaceUserInterests(db, userId, ['food'], async () => {
      throw new Error('agent down');
    });
    assert.deepEqual(await listUserInterests(db, userId), ['food']);
    await deleteUser(db, userId);
  });
});
