import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { connectPg, deleteUser, insertUser } from './helpers/pg.ts';
import type { PgDb } from '../src/pg/db.ts';
import { setFavorite } from '../src/pg/favorites.ts';
import { DynamoLocationCatalogue, LOCAL_DYNAMO_ENDPOINT } from '../src/catalogue/dynamo.ts';
import { ensureTable } from '../src/catalogue/bootstrap.ts';
import { searchCatalogue, searchLocationsWithCatalogue } from '../src/catalogue/search.ts';

const endpoint = process.env.DYNAMODB_ENDPOINT ?? LOCAL_DYNAMO_ENDPOINT;
const tableName = 'triplanner-locations-search-test';

let db: PgDb | null = null;
let catalogue: DynamoLocationCatalogue | null = null;

before(async () => {
  db = await connectPg();
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      await ensureTable({ endpoint, tableName });
      catalogue = new DynamoLocationCatalogue({ endpoint, tableName });
      await catalogue.clear();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  catalogue = null;
});

after(async () => {
  await catalogue?.clear();
  await db?.close();
});

beforeEach(async () => {
  await catalogue?.clear();
});

describe('catalogue-backed search', () => {
  test('puts favorites first, then ranks by rating', async () => {
    if (!db || !catalogue) return;
    const userId = await insertUser(db);

    await catalogue.upsert({ id: 'a', name: 'Museo A', category: 'sight', rating: 4.9, rating_count: 100 });
    await catalogue.upsert({ id: 'b', name: 'Museo B', category: 'sight', rating: 3.0, rating_count: 10 });
    await catalogue.upsert({ id: 'c', name: 'Museo C', category: 'sight', rating: 4.5, rating_count: 50 });
    await setFavorite(db, userId, 'b', true);

    const rows = await searchCatalogue(catalogue, db, 'museo', {}, 20, userId);
    assert.deepEqual(rows.map((r) => r.id), ['b', 'a', 'c']);

    await deleteUser(db, userId);
  });

  test('drops results outside the 75 km radius when coordinates are given', async () => {
    if (!db || !catalogue) return;
    const userId = await insertUser(db);

    await catalogue.upsert({ id: 'near', name: 'Museo Cerca', category: 'sight', lat: 8.99, lng: -79.52 });
    await catalogue.upsert({ id: 'far', name: 'Museo Lejos', category: 'sight', lat: 9.99, lng: -79.52 });

    const withCoords = await searchCatalogue(catalogue, db, 'museo', { lat: 8.98, lng: -79.52 }, 20);
    assert.deepEqual(withCoords.map((r) => r.id), ['near']);

    const withoutCoords = await searchCatalogue(catalogue, db, 'museo', {}, 20);
    assert.equal(withoutCoords.length, 2);

    await deleteUser(db, userId);
  });

  test('returns an empty list on a cache miss (no remote provider)', async () => {
    if (!db || !catalogue) return;
    const userId = await insertUser(db);
    const rows = await searchLocationsWithCatalogue({ catalogue, db, q: 'inexistente', userId });
    assert.deepEqual(rows, []);
    await deleteUser(db, userId);
  });

  test('matches multiple tokens in the name', async () => {
    if (!db || !catalogue) return;
    await catalogue.upsert({ id: 'cn', name: 'CN Tower', category: 'sight', rating: 4.6 });
    await catalogue.upsert({ id: 'rom', name: 'Royal Ontario Museum', category: 'sight', rating: 4.7 });

    const rows = await searchCatalogue(catalogue, db, 'royal museum', {}, 20);
    assert.deepEqual(rows.map((r) => r.id), ['rom']);
  });
});
