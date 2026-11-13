// Integration tests for the DynamoDB catalogue (DynamoDB Local in compose).
// Skips when the container is not reachable.

import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { DynamoLocationCatalogue, LOCAL_DYNAMO_ENDPOINT } from '../src/catalogue/dynamo.ts';
import { ensureTable } from '../src/catalogue/bootstrap.ts';

const endpoint = process.env.DYNAMODB_ENDPOINT ?? LOCAL_DYNAMO_ENDPOINT;
const tableName = process.env.DYNAMODB_TEST_TABLE ?? 'triplanner-locations-test';

let catalogue: DynamoLocationCatalogue | null = null;

before(async () => {
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
});

beforeEach(async () => {
  await catalogue?.clear();
});

describe('location catalogue on DynamoDB', () => {
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

    const siblings = await catalogue.listByParent('does-not-exist');
    assert.equal(siblings.length, 0);
    // One row only: the second write updated the first.
    const found = await catalogue.search('museo renombrado');
    assert.equal(found.length, 1);
  });

  test('upsert dedupes by data_id when place_id is absent', async () => {
    if (!catalogue) return;
    await catalogue.upsert({ id: 'loc-c', data_id: 'data-9', name: 'Café', category: 'food' });
    await catalogue.upsert({ id: 'loc-d', data_id: 'data-9', name: 'Café Central', category: 'food' });

    assert.equal((await catalogue.getByDataId('data-9'))?.id, 'loc-c');
  });

  test('search is token-based, case-insensitive and places-only', async () => {
    if (!catalogue) return;
    await catalogue.upsert({ id: 'm1', name: 'Museo de Arte', category: 'sight', parent_id: 'dest-1' });
    await catalogue.upsert({ id: 'm2', name: 'Museo del Oro', category: 'sight', parent_id: 'dest-1' });
    await catalogue.upsert({ id: 'h1', name: 'Hotel Museo', slug: 'hotel-museo' }); // destination: no category

    const all = await catalogue.search('MUSEO');
    assert.deepEqual(all.map((r) => r.id).sort(), ['m1', 'm2']);

    const filtered = await catalogue.search('museo arte');
    assert.deepEqual(filtered.map((r) => r.id), ['m1']);

    assert.deepEqual(await catalogue.search('zzz'), []);
  });

  test('lists destinations by slug and places by parent', async () => {
    if (!catalogue) return;
    await catalogue.upsert({ id: 'd1', name: 'Toronto', slug: 'toronto', country: 'Canadá' });
    await catalogue.upsert({ id: 'd2', name: 'Lisboa', slug: 'lisboa', country: 'Portugal' });
    await catalogue.upsert({ id: 'p1', name: 'CN Tower', category: 'sight', parent_id: 'd1', rating: 4.7 });
    await catalogue.upsert({ id: 'p2', name: 'ROM', category: 'sight', parent_id: 'd1', rating: 4.9 });

    const destinations = await catalogue.listDestinations();
    assert.deepEqual(destinations.map((d) => d.slug), ['lisboa', 'toronto']);

    const places = await catalogue.listByParent('d1');
    assert.deepEqual(places.map((p) => p.id), ['p2', 'p1']); // rating DESC
  });

  test('returns null for unknown ids', async () => {
    if (!catalogue) return;
    assert.equal(await catalogue.getById('nope'), null);
    assert.equal(await catalogue.getByPlaceId('nope'), null);
    assert.equal(await catalogue.getByDataId('nope'), null);
  });
});
