// Cache-first orchestration tests with in-memory catalogue and HasData fakes.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { CatalogueService, isFresh } from '../src/catalogue/service.ts';
import type {
  LocationCatalogue,
  LocationRow,
  SearchOptions,
  UpsertLocationInput,
} from '../src/catalogue/types.ts';
import type { HasDataClient } from '../src/hasdata.ts';
import type {
  LocationsRuntimeSettings,
  LocationsSettingsProvider,
  PublicLocationsSettings,
} from '../src/settings.ts';

const DAY = 24 * 60 * 60 * 1000;

function row(partial: Partial<LocationRow> & { id: string; name: string }): LocationRow {
  return {
    source: 'seed',
    place_id: null,
    data_id: null,
    slug: null,
    category: 'sight',
    raw_type: null,
    country: null,
    description: null,
    lat: 43.65,
    lng: -79.38,
    address: null,
    rating: 4.5,
    rating_count: 10,
    hours_json: null,
    website_url: null,
    social_links_json: null,
    phone: null,
    price_level: null,
    image_url: null,
    cost: null,
    tags_json: null,
    duration_hours: null,
    parent_id: null,
    last_updated: null,
    created_at: null,
    expires_at: null,
    ...partial,
  };
}

class FakeStore implements LocationCatalogue {
  rows: LocationRow[] = [];
  destinations: LocationRow[] = [row({ id: 'toronto', name: 'Toronto', slug: 'toronto' })];
  upserts: UpsertLocationInput[] = [];

  async ping(): Promise<void> {}

  async getById(id: string): Promise<LocationRow | null> {
    return this.rows.find((item) => item.id === id) ?? null;
  }

  async getByPlaceId(placeId: string): Promise<LocationRow | null> {
    return this.rows.find((item) => item.place_id === placeId) ?? null;
  }

  async getByDataId(dataId: string): Promise<LocationRow | null> {
    return this.rows.find((item) => item.data_id === dataId) ?? null;
  }

  async search(q: string, options: SearchOptions = {}): Promise<LocationRow[]> {
    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    return this.rows
      .filter((item) => item.category != null)
      .filter((item) => tokens.every((token) => item.name.toLowerCase().includes(token)))
      .slice(0, options.limit ?? 20);
  }

  async listDestinations(): Promise<LocationRow[]> {
    return this.destinations;
  }

  async listByParent(parentId: string, limit = 50): Promise<LocationRow[]> {
    return this.rows.filter((item) => item.parent_id === parentId).slice(0, limit);
  }

  async listPlaces(): Promise<LocationRow[]> {
    return this.rows;
  }

  async countPlaces(): Promise<number> {
    return this.rows.length;
  }

  async upsert(loc: UpsertLocationInput): Promise<LocationRow> {
    this.upserts.push(loc);
    const existing = this.rows.find((item) => item.id === loc.id);
    const next = row({
      ...(existing ?? {}),
      ...loc,
      price_level: typeof loc.price_level === 'number' ? loc.price_level : (existing?.price_level ?? null),
      id: loc.id,
      name: loc.name,
    });
    this.rows = existing
      ? this.rows.map((item) => (item.id === loc.id ? next : item))
      : [...this.rows, next];
    return next;
  }

  async clear(): Promise<void> {
    this.rows = [];
  }

  async close(): Promise<void> {}
}

class FakeSettings implements LocationsSettingsProvider {
  provider: 'preloaded' | 'hasdata' = 'preloaded';
  apiKey = '';

  get(): LocationsRuntimeSettings {
    return { provider: this.provider, apiKey: this.apiKey };
  }

  public(): PublicLocationsSettings {
    return {
      provider: this.provider,
      hasKey: this.apiKey.length > 0,
      ready: this.provider === 'preloaded' || this.apiKey.length > 0,
    };
  }

  update(): PublicLocationsSettings {
    return this.public();
  }
}

function makeService() {
  const store = new FakeStore();
  const settings = new FakeSettings();
  const calls = { search: 0, place: 0 };
  const hasdata = {
    async search() {
      calls.search++;
      return [
        {
          id: 'tor-hd-1',
          name: 'HasData Place',
          source: 'hasdata',
          category: 'food',
          lat: 43.66,
          lng: -79.39,
          rating: 4.9,
          expires_at: new Date(Date.now() + 5 * DAY).toISOString(),
        } satisfies UpsertLocationInput,
      ];
    },
    async getPlace(placeId: string) {
      calls.place++;
      return {
        id: `tor-${placeId}`,
        place_id: placeId,
        name: 'HasData Details',
        source: 'hasdata',
        category: 'sight',
        lat: 43.67,
        lng: -79.4,
        expires_at: new Date(Date.now() + 5 * DAY).toISOString(),
      } satisfies UpsertLocationInput;
    },
  } as unknown as HasDataClient;

  const service = new CatalogueService({
    store,
    settings,
    hasdata,
    cacheTtlMs: 5 * DAY,
  });
  return { service, store, settings, calls, hasdata };
}

describe('cache-first catalogue service', () => {
  test('uses only Mongo when the provider is preloaded', async () => {
    const { service, store, calls } = makeService();
    store.rows = [row({ id: 'cached', name: 'Cached Place', parent_id: 'toronto' })];

    const rows = await service.search('cached');
    assert.deepEqual(rows.map((r) => r.id), ['cached']);
    assert.equal(calls.search, 0);
  });

  test('calls HasData on a cache miss and caches the result with a parent and 5-day expiry', async () => {
    const { service, store, settings, calls } = makeService();
    settings.provider = 'hasdata';
    settings.apiKey = 'hd_key';

    const rows = await service.search('new place');
    assert.equal(calls.search, 1);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.id, 'tor-hd-1');
    assert.equal(store.upserts.length, 1);
    assert.equal(store.upserts[0]!.parent_id, 'toronto');
    assert.equal(store.upserts[0]!.source, 'hasdata');

    const expires = new Date(String(store.upserts[0]!.expires_at)).getTime();
    assert.ok(expires > Date.now() + 5 * DAY - 60_000);
    assert.ok(expires < Date.now() + 5 * DAY + 60_000);
  });

  test('serves fresh cached rows without calling HasData', async () => {
    const { service, store, settings, calls } = makeService();
    settings.provider = 'hasdata';
    settings.apiKey = 'hd_key';
    store.rows = [
      row({
        id: 'fresh',
        name: 'Fresh Place',
        expires_at: new Date(Date.now() + DAY).toISOString(),
      }),
    ];

    const rows = await service.search('fresh');
    assert.deepEqual(rows.map((r) => r.id), ['fresh']);
    assert.equal(calls.search, 0);
  });

  test('refreshes expired cache rows and falls back to them if HasData fails', async () => {
    const { service, store, settings, calls } = makeService();
    settings.provider = 'hasdata';
    settings.apiKey = 'hd_key';
    store.rows = [
      row({
        id: 'stale',
        name: 'Stale Place',
        expires_at: new Date(Date.now() - DAY).toISOString(),
      }),
    ];

    assert.equal(isFresh(store.rows[0]!), false);
    const rows = await service.search('stale');
    assert.equal(calls.search, 1);
    assert.deepEqual(rows.map((r) => r.id).sort(), ['stale', 'tor-hd-1']);
  });

  test('falls back to the cache when HasData throws', async () => {
    const { service, store, settings } = makeService();
    settings.provider = 'hasdata';
    settings.apiKey = 'hd_key';
    store.rows = [
      row({
        id: 'stale',
        name: 'Stale Place',
        expires_at: new Date(Date.now() - DAY).toISOString(),
      }),
    ];

    (service as unknown as { hasdata: { search: () => Promise<never> } }).hasdata.search = async () => {
      throw new Error('HasData down');
    };
    const rows = await service.search('stale');
    assert.deepEqual(rows.map((r) => r.id), ['stale']);
  });

  test('refreshes a stale place by place id and caches it', async () => {
    const { service, store, settings, calls } = makeService();
    settings.provider = 'hasdata';
    settings.apiKey = 'hd_key';
    store.rows = [
      row({
        id: 'old',
        place_id: 'place-1',
        name: 'Old Details',
        expires_at: new Date(Date.now() - DAY).toISOString(),
      }),
    ];

    const refreshed = await service.getByPlaceId('place-1');
    assert.equal(calls.place, 1);
    assert.equal(refreshed?.name, 'HasData Details');
    assert.equal(store.upserts.length, 1);
  });

  test('uses fresh place details without a HasData call', async () => {
    const { service, store, settings, calls } = makeService();
    settings.provider = 'hasdata';
    settings.apiKey = 'hd_key';
    store.rows = [
      row({
        id: 'fresh',
        place_id: 'place-1',
        name: 'Fresh Details',
        expires_at: new Date(Date.now() + DAY).toISOString(),
      }),
    ];

    const found = await service.getByPlaceId('place-1');
    assert.equal(found?.name, 'Fresh Details');
    assert.equal(calls.place, 0);
  });

  test('keeps an enriched seed row permanent instead of giving it a TTL', async () => {
    const { service, store, settings } = makeService();
    settings.provider = 'hasdata';
    settings.apiKey = 'hd_key';
    store.rows = [
      row({
        id: 'tor-place-1',
        place_id: 'place-1',
        name: 'Seed Details',
        source: 'seed',
        expires_at: new Date(Date.now() - DAY).toISOString(),
      }),
    ];

    const refreshed = await service.getByPlaceId('place-1');
    assert.equal(refreshed?.name, 'HasData Details');
    assert.equal(store.upserts[0]!.expires_at, null);
    assert.equal(store.rows[0]!.expires_at, null);
  });
});
