import { before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryLocationCatalogue } from './helpers/memory-catalogue.ts';
import { searchCatalogue, searchLocationsWithCatalogue } from '../src/catalogue/search.ts';

let catalogue: MemoryLocationCatalogue | null = null;

before(async () => {
  catalogue = new MemoryLocationCatalogue();
});

beforeEach(async () => {
  await catalogue?.clear();
});

describe('catalogue-backed search', () => {
  test('puts favorites first, then ranks by rating', async () => {
    if (!catalogue) return;

    await catalogue.upsert({ id: 'a', name: 'Museo A', category: 'sight', rating: 4.9, rating_count: 100 });
    await catalogue.upsert({ id: 'b', name: 'Museo B', category: 'sight', rating: 3.0, rating_count: 10 });
    await catalogue.upsert({ id: 'c', name: 'Museo C', category: 'sight', rating: 4.5, rating_count: 50 });

    const rows = await searchCatalogue(catalogue, 'museo', {}, 20, new Set(['b']));
    assert.deepEqual(rows.map((r) => r.id), ['b', 'a', 'c']);
  });

  test('drops results outside the 75 km radius when coordinates are given', async () => {
    if (!catalogue) return;
    await catalogue.upsert({ id: 'near', name: 'Museo Cerca', category: 'sight', lat: 8.99, lng: -79.52 });
    await catalogue.upsert({ id: 'far', name: 'Museo Lejos', category: 'sight', lat: 9.99, lng: -79.52 });

    const withCoords = await searchCatalogue(catalogue, 'museo', { lat: 8.98, lng: -79.52 }, 20);
    assert.deepEqual(withCoords.map((r) => r.id), ['near']);

    const withoutCoords = await searchCatalogue(catalogue, 'museo', {}, 20);
    assert.equal(withoutCoords.length, 2);
  });

  test('returns an empty list on a cache miss (no remote provider)', async () => {
    if (!catalogue) return;
    const rows = await searchLocationsWithCatalogue({ catalogue, q: 'inexistente' });
    assert.deepEqual(rows, []);
  });

  test('matches multiple tokens in the name', async () => {
    if (!catalogue) return;
    await catalogue.upsert({ id: 'cn', name: 'CN Tower', category: 'sight', rating: 4.6 });
    await catalogue.upsert({ id: 'rom', name: 'Royal Ontario Museum', category: 'sight', rating: 4.7 });

    const rows = await searchCatalogue(catalogue, 'royal museum', {}, 20);
    assert.deepEqual(rows.map((r) => r.id), ['rom']);
  });
});
