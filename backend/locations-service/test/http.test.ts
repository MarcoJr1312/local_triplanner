// HTTP contract tests with an in-memory catalogue; no Mongo required.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, type SeedState } from '../src/http.ts';
import type { LocationsSettingsProvider, PublicLocationsSettings } from '../src/settings.ts';
import type { LocationCatalogue, LocationRow, SearchOptions, UpsertLocationInput } from '../src/catalogue/types.ts';

function row(partial: Partial<LocationRow> & { id: string; name: string }): LocationRow {
  return {
    source: 'seed',
    place_id: null,
    data_id: null,
    slug: null,
    category: null,
    raw_type: null,
    country: null,
    description: null,
    lat: null,
    lng: null,
    address: null,
    rating: null,
    rating_count: null,
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
    version: 1,
    content_hash: '',
    created_at: null,
    expires_at: null,
    ...partial,
  };
}

class FakeCatalogue implements LocationCatalogue {
  pingOk = true;
  destinations: LocationRow[] = [row({ id: 'toronto', name: 'Toronto', slug: 'toronto' })];
  places: LocationRow[] = [
    row({ id: 'cn-tower', name: 'CN Tower', category: 'sight', parent_id: 'toronto', rating: 4.7 }),
    row({ id: 'rom', name: 'ROM', category: 'sight', parent_id: 'toronto', rating: 4.9 }),
    row({ id: 'pai', name: 'Pai Northern Thai', category: 'food', parent_id: 'toronto', rating: 4.6 }),
  ];

  async ping(): Promise<void> {
    if (!this.pingOk) throw new Error('down');
  }

  async getById(id: string): Promise<LocationRow | null> {
    return [...this.destinations, ...this.places].find((item) => item.id === id) ?? null;
  }

  async getByPlaceId(placeId: string): Promise<LocationRow | null> {
    return this.places.find((item) => item.place_id === placeId) ?? null;
  }

  async getByDataId(dataId: string): Promise<LocationRow | null> {
    return this.places.find((item) => item.data_id === dataId) ?? null;
  }

  async search(q: string, options: SearchOptions = {}): Promise<LocationRow[]> {
    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    return this.places
      .filter((item) => tokens.every((token) => item.name.toLowerCase().includes(token)))
      .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
      .slice(0, options.limit ?? 100);
  }

  async listDestinations(): Promise<LocationRow[]> {
    return [...this.destinations].sort((a, b) => a.name.localeCompare(b.name));
  }

  async listByParent(parentId: string, limit = 50): Promise<LocationRow[]> {
    return this.places
      .filter((item) => item.parent_id === parentId)
      .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
      .slice(0, limit);
  }

  async listPlaces(): Promise<LocationRow[]> {
    return [...this.places];
  }

  async countPlaces(): Promise<number> {
    return this.places.length;
  }

  async upsert(loc: UpsertLocationInput): Promise<LocationRow> {
    const existing = this.places.find((item) => item.id === loc.id);
    const priceLevel = typeof loc.price_level === 'number' ? loc.price_level : (existing?.price_level ?? null);
    const next = row({
      ...(existing ?? {}),
      ...loc,
      price_level: priceLevel,
      id: loc.id,
      name: loc.name,
    });
    if (existing) this.places = this.places.map((item) => (item.id === loc.id ? next : item));
    else this.places.push(next);
    return next;
  }

  async delete(id: string): Promise<LocationRow | null> {
    const existing = [...this.destinations, ...this.places].find((item) => item.id === id);
    if (!existing) return null;
    this.destinations = this.destinations.filter((item) => item.id !== id);
    this.places = this.places.filter((item) => item.id !== id);
    return { ...existing, version: existing.version + 1 };
  }

  async clear(): Promise<void> {
    this.destinations = [];
    this.places = [];
  }

  async close(): Promise<void> {}
}

class FakeSettings implements LocationsSettingsProvider {
  provider: 'preloaded' | 'hasdata' = 'preloaded';
  apiKey = '';

  get() {
    return { provider: this.provider, apiKey: this.apiKey };
  }

  public(): PublicLocationsSettings {
    return {
      provider: this.provider,
      hasKey: this.apiKey.length > 0,
      ready: this.provider === 'preloaded' || this.apiKey.length > 0,
    };
  }

  update(input: { provider: string; apiKey?: string | null; clearKey?: boolean | null }): PublicLocationsSettings {
    this.provider = input.provider === 'hasdata' ? 'hasdata' : 'preloaded';
    if (input.clearKey) this.apiKey = '';
    else if (input.apiKey) this.apiKey = input.apiKey;
    return this.public();
  }
}

function makeHandler(overrides: { seedState?: Partial<SeedState>; seed?: () => Promise<number> } = {}) {
  const catalogue = new FakeCatalogue();
  const settings = new FakeSettings();
  const seedState: SeedState = {
    enabled: true,
    seeded: true,
    count: 3,
    lastError: null,
    ...overrides.seedState,
  };
  const handler = createHandler({
    catalogue,
    settings,
    verifyToken: (token) => token === 'secret',
    seed: overrides.seed,
    seedState,
  });
  return { handler, catalogue, settings, seedState };
}

function req(path: string, init: RequestInit = {}): Request {
  return new Request(`http://localhost${path}`, {
    ...init,
    headers: { 'x-internal-token': 'secret', ...(init.headers ?? {}) },
  });
}

describe('locations HTTP surface', () => {
  test('health and ready are unauthenticated', async () => {
    const { handler } = makeHandler();
    assert.equal((await handler(new Request('http://localhost/health'))).status, 200);
    const ready = await handler(new Request('http://localhost/ready'));
    assert.equal(ready.status, 200);
    assert.deepEqual(await ready.json(), {
      status: 'ready',
      mongo: 'ok',
      seeded: true,
      places: 3,
      provider: 'preloaded',
    });
  });

  test('ready is 503 when Mongo is down or the seed is incomplete', async () => {
    const { handler, catalogue, seedState } = makeHandler();
    catalogue.pingOk = false;
    assert.equal((await handler(new Request('http://localhost/ready'))).status, 503);
    catalogue.pingOk = true;
    seedState.seeded = false;
    assert.equal((await handler(new Request('http://localhost/ready'))).status, 503);
  });

  test('internal routes reject missing or wrong tokens', async () => {
    const { handler } = makeHandler();
    assert.equal((await handler(new Request('http://localhost/internal/v1/destinations'))).status, 401);
    assert.equal(
      (await handler(req('/internal/v1/destinations', { headers: { 'x-internal-token': 'nope' } }))).status,
      401,
    );
  });

  test('lists destinations and filtered activities', async () => {
    const { handler } = makeHandler();
    const destinations = await handler(req('/internal/v1/destinations'));
    assert.equal(destinations.status, 200);
    assert.deepEqual(((await destinations.json()) as { items: LocationRow[] }).items.map((i) => i.id), ['toronto']);

    const all = await handler(req('/internal/v1/destinations/toronto/activities'));
    assert.deepEqual(((await all.json()) as { items: LocationRow[] }).items.map((i) => i.id), ['rom', 'cn-tower', 'pai']);

    const food = await handler(req('/internal/v1/destinations/toronto/activities?category=food'));
    assert.deepEqual(((await food.json()) as { items: LocationRow[] }).items.map((i) => i.id), ['pai']);
  });

  test('search validates coordinates and limit', async () => {
    const { handler } = makeHandler();
    const ok = await handler(req('/internal/v1/locations/search?q=cn'));
    assert.equal(ok.status, 200);
    assert.deepEqual(((await ok.json()) as { items: LocationRow[] }).items.map((i) => i.id), ['cn-tower']);

    assert.equal((await handler(req('/internal/v1/locations/search?q=cn&lat=43.6'))).status, 400);
    assert.equal((await handler(req('/internal/v1/locations/search?q=cn&limit=0'))).status, 400);
    assert.equal((await handler(req('/internal/v1/locations/search?q=cn&lat=x&lng=1'))).status, 400);
  });

  test('gets by id and place id, including 404s', async () => {
    const { handler, catalogue } = makeHandler();
    catalogue.places[0]!.place_id = 'place-cn';

    const byId = await handler(req('/internal/v1/locations/cn-tower'));
    assert.equal(byId.status, 200);
    const byPlace = await handler(req('/internal/v1/locations/by-place/place-cn'));
    assert.equal(byPlace.status, 200);
    assert.equal((await handler(req('/internal/v1/locations/missing'))).status, 404);
    assert.equal((await handler(req('/internal/v1/locations/by-place/missing'))).status, 404);
    assert.equal((await handler(req('/internal/v1/locations/by-data/missing'))).status, 404);
  });

  test('lists all places for the agent cache', async () => {
    const { handler } = makeHandler();
    const response = await handler(req('/internal/v1/locations'));
    assert.equal(response.status, 200);
    assert.equal(((await response.json()) as { items: LocationRow[] }).items.length, 3);
  });

  test('upserts a location and validates the body', async () => {
    const { handler } = makeHandler();
    const bad = await handler(req('/internal/v1/locations', { method: 'POST', body: JSON.stringify({ id: 'x' }) }));
    assert.equal(bad.status, 400);

    const ok = await handler(
      req('/internal/v1/locations', {
        method: 'POST',
        body: JSON.stringify({ id: 'new-place', name: 'New Place', category: 'sight', parent_id: 'toronto' }),
      }),
    );
    assert.equal(ok.status, 200);
    assert.equal(((await ok.json()) as { item: LocationRow }).item.name, 'New Place');
  });

  test('seed is guarded and updates state', async () => {
    const disabled = makeHandler({ seedState: { enabled: false } });
    assert.equal(
      (await disabled.handler(req('/internal/v1/seed', { method: 'POST' }))).status,
      403,
    );

    let calls = 0;
    const enabled = makeHandler({
      seedState: { seeded: false },
      seed: async () => {
        calls++;
        return 42;
      },
    });
    const response = await enabled.handler(req('/internal/v1/seed', { method: 'POST' }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { seeded: 42 });
    assert.equal(calls, 1);
    assert.equal(enabled.seedState.seeded, true);
    assert.equal(enabled.seedState.count, 42);
  });

  test('settings config is public for reads and guarded for writes', async () => {
    const { handler } = makeHandler();

    const read = await handler(new Request('http://localhost/api/locations/config'));
    assert.equal(read.status, 200);
    const readBody = (await read.json()) as {
      provider: string;
      hasKey: boolean;
      cachedPlaces: number;
    };
    assert.equal(readBody.provider, 'preloaded');
    assert.equal(readBody.hasKey, false);
    assert.equal(readBody.cachedPlaces, 3);

    const unauthorized = await handler(
      new Request('http://localhost/api/locations/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'hasdata', apiKey: 'hd_secret' }),
      }),
    );
    assert.equal(unauthorized.status, 401);

    const saved = await handler(
      req('/api/locations/config', {
        method: 'POST',
        body: JSON.stringify({ provider: 'hasdata', apiKey: 'hd_secret' }),
      }),
    );
    assert.equal(saved.status, 200);
    const savedText = await saved.text();
    assert.equal(savedText.includes('hd_secret'), false);
    const savedBody = JSON.parse(savedText) as { provider: string; hasKey: boolean };
    assert.equal(savedBody.provider, 'hasdata');
    assert.equal(savedBody.hasKey, true);

    const cleared = await handler(
      req('/api/locations/config', {
        method: 'POST',
        body: JSON.stringify({ provider: 'preloaded', clearKey: true }),
      }),
    );
    const clearedBody = (await cleared.json()) as { provider: string; hasKey: boolean };
    assert.equal(clearedBody.provider, 'preloaded');
    assert.equal(clearedBody.hasKey, false);
  });

  test('unknown routes return 404', async () => {
    const { handler } = makeHandler();
    assert.equal((await handler(req('/internal/v1/nope'))).status, 404);
    assert.equal((await handler(new Request('http://localhost/nope'))).status, 404);
  });
});
