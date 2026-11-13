import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { connectPg, deleteUser, insertUser } from './helpers/pg.ts';
import type { PgDb } from '../src/pg/db.ts';
import { setFavorite } from '../src/pg/favorites.ts';
import { DynamoLocationCatalogue, LOCAL_DYNAMO_ENDPOINT } from '../src/catalogue/dynamo.ts';
import { ensureTable } from '../src/catalogue/bootstrap.ts';
import { searchCatalogue, searchLocationsWithCatalogue } from '../src/catalogue/search.ts';
import type { HasDataClient } from '../src/hasdata/client.ts';

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

  test('falls back to HasData once and then serves from the catalogue', async () => {
    if (!db || !catalogue) return;
    const userId = await insertUser(db);

    let calls = 0;
    const fakeClient = {
      search: async () => {
        calls++;
        return {
          localResults: [
            {
              title: 'Museo Nuevo',
              placeId: 'place-new',
              type: 'museum',
              gpsCoordinates: { latitude: 8.99, longitude: -79.52 },
              rating: 4.2,
              address: 'Calle 1',
            },
          ],
        };
      },
    } as unknown as HasDataClient;

    const first = await searchLocationsWithCatalogue({
      catalogue,
      db,
      client: fakeClient,
      q: 'museo nuevo',
      lat: 8.98,
      lng: -79.52,
      userId,
    });
    assert.equal(first.length, 1);
    assert.equal(first[0]?.name, 'Museo Nuevo');
    assert.equal(calls, 1);
    assert.equal((await catalogue.getByPlaceId('place-new'))?.name, 'Museo Nuevo');

    const second = await searchLocationsWithCatalogue({
      catalogue,
      db,
      client: fakeClient,
      q: 'museo nuevo',
      lat: 8.98,
      lng: -79.52,
      userId,
    });
    assert.equal(second.length, 1);
    assert.equal(calls, 1, 'second call must hit the catalogue, not HasData');

    await deleteUser(db, userId);
  });

  test('returns nothing without a client and without cache hits', async () => {
    if (!db || !catalogue) return;
    const userId = await insertUser(db);
    const rows = await searchLocationsWithCatalogue({ catalogue, db, client: null, q: 'inexistente', userId });
    assert.deepEqual(rows, []);
    await deleteUser(db, userId);
  });
});
