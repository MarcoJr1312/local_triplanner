// Integracion del catalogo contra MongoDB real. Se salta sin Mongo.

import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { connectMongo } from './helpers/mongo.ts';
import type { MongoLocationCatalogue } from '../src/catalogue/mongo.ts';
import { seedCatalogue } from '../src/seed.ts';

let catalogue: MongoLocationCatalogue | null = null;

before(async () => {
  catalogue = await connectMongo('locations_service_catalogue_test');
  await catalogue?.clear();
});

after(async () => {
  await catalogue?.clear();
  await catalogue?.close();
});

beforeEach(async () => {
  await catalogue?.clear();
});

describe('locations catalogue on MongoDB', () => {
  test('upsert dedupes by place_id and updates in place', async () => {
    if (!catalogue) return;
    const first = await catalogue.upsert({ id: 'loc-a', place_id: 'place-1', name: 'Museo', category: 'sight' });
    const second = await catalogue.upsert({
      id: 'loc-b',
      place_id: 'place-1',
      name: 'Museo Renombrado',
      category: 'sight',
    });

    assert.equal(second.id, first.id);
    assert.equal(second.name, 'Museo Renombrado');
    assert.equal((await catalogue.getByPlaceId('place-1'))?.id, 'loc-a');
  });

  test('upsert dedupes by data_id when place_id is absent', async () => {
    if (!catalogue) return;
    await catalogue.upsert({ id: 'loc-c', data_id: 'data-9', name: 'Cafe', category: 'food' });
    await catalogue.upsert({ id: 'loc-d', data_id: 'data-9', name: 'Cafe Central', category: 'food' });

    assert.equal((await catalogue.getByDataId('data-9'))?.id, 'loc-c');
  });

  test('search is token-based, case-insensitive and places-only', async () => {
    if (!catalogue) return;
    await catalogue.upsert({ id: 'm1', name: 'Museo de Arte', category: 'sight', parent_id: 'dest-1' });
    await catalogue.upsert({ id: 'm2', name: 'Museo del Oro', category: 'sight', parent_id: 'dest-1' });
    await catalogue.upsert({ id: 'h1', name: 'Hotel Museo', slug: 'hotel-museo' });

    const all = await catalogue.search('MUSEO');
    assert.deepEqual(all.map((r) => r.id).sort(), ['m1', 'm2']);

    const filtered = await catalogue.search('museo arte');
    assert.deepEqual(filtered.map((r) => r.id), ['m1']);

    assert.deepEqual(await catalogue.search('zzz'), []);
    assert.deepEqual(await catalogue.search('   '), []);
  });

  test('search applies the 75 km radius and rating order', async () => {
    if (!catalogue) return;
    await catalogue.upsert({ id: 'near-low', name: 'Toronto Near', category: 'sight', lat: 43.65, lng: -79.38, rating: 4.1 });
    await catalogue.upsert({ id: 'near-high', name: 'Toronto High', category: 'sight', lat: 43.66, lng: -79.39, rating: 4.9 });
    await catalogue.upsert({ id: 'far', name: 'Toronto Far', category: 'sight', lat: 45.5, lng: -73.5, rating: 5 });

    const near = await catalogue.search('toronto', { lat: 43.6532, lng: -79.3832, limit: 10 });
    assert.deepEqual(near.map((r) => r.id), ['near-high', 'near-low']);

    const all = await catalogue.search('toronto', { limit: 10 });
    assert.deepEqual(all.map((r) => r.id), ['far', 'near-high', 'near-low']);
  });

  test('lists destinations by name and activities by parent rating', async () => {
    if (!catalogue) return;
    await catalogue.upsert({ id: 'd1', name: 'Toronto', slug: 'toronto', country: 'Canada' });
    await catalogue.upsert({ id: 'd2', name: 'Lisboa', slug: 'lisboa', country: 'Portugal' });
    await catalogue.upsert({ id: 'p1', name: 'CN Tower', category: 'sight', parent_id: 'd1', rating: 4.7 });
    await catalogue.upsert({ id: 'p2', name: 'ROM', category: 'sight', parent_id: 'd1', rating: 4.9 });

    const destinations = await catalogue.listDestinations();
    assert.deepEqual(destinations.map((d) => d.slug), ['lisboa', 'toronto']);

    const places = await catalogue.listByParent('d1');
    assert.deepEqual(places.map((p) => p.id), ['p2', 'p1']);
  });

  test('seed is idempotent', async () => {
    if (!catalogue) return;
    const data = {
      destinations: [
        {
          slug: 'toronto',
          name: 'Toronto',
          country: 'Canada',
          lat: 43.65,
          lng: -79.38,
          activities: [
            { id: 'a1', name: 'CN Tower', category: 'sight', lat: 43.64, lng: -79.38, rating: 4.7 },
            { id: 'a2', name: 'Kensington Market', category: 'food', lat: 43.65, lng: -79.4, rating: 4.6 },
          ],
        },
      ],
    };

    const first = await seedCatalogue(catalogue, data);
    const second = await seedCatalogue(catalogue, data);
    assert.equal(first, 3);
    assert.equal(second, 3);

    const places = await catalogue.listPlaces();
    const destinations = await catalogue.listDestinations();
    assert.equal(places.length, 2);
    assert.equal(destinations.length, 1);
  });
});
