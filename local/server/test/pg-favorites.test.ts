import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { connectPg, deleteUser, insertUser } from './helpers/pg.ts';
import type { PgDb } from '../src/pg/db.ts';
import { favoriteIdsForUser, isFavorite, setFavorite } from '../src/pg/favorites.ts';

let db: PgDb | null = null;

before(async () => {
  db = await connectPg();
});

after(async () => {
  await db?.close();
});

describe('favorites on Postgres', () => {
  test('toggles a favorite idempotently', async () => {
    if (!db) return;
    const userId = await insertUser(db);
    const locationId = 'loc-1';

    assert.equal(await setFavorite(db, userId, locationId, true), true);
    assert.equal(await isFavorite(db, userId, locationId), true);

    // Repeating the add must not fail or duplicate.
    await setFavorite(db, userId, locationId, true);
    const { c } = (await db
      .prepare('SELECT count(*)::int AS c FROM user_favorites WHERE user_id = ?')
      .get<{ c: number }>(userId)) ?? { c: 0 };
    assert.equal(c, 1);

    assert.equal(await setFavorite(db, userId, locationId, false), false);
    assert.equal(await isFavorite(db, userId, locationId), false);

    await deleteUser(db, userId);
  });

  test('rejects a location the catalogue does not know', async () => {
    if (!db) return;
    const userId = await insertUser(db);
    await assert.rejects(() => setFavorite(db as PgDb, userId, 'missing', true, async () => false), /no encontrado/);
    await deleteUser(db, userId);
  });

  test('lists favorite ids in one pass', async () => {
    if (!db) return;
    const userId = await insertUser(db);
    await setFavorite(db, userId, 'loc-a', true);
    await setFavorite(db, userId, 'loc-b', true);

    const ids = await favoriteIdsForUser(db, userId);
    assert.deepEqual([...ids].sort(), ['loc-a', 'loc-b']);

    await deleteUser(db, userId);
  });
});
