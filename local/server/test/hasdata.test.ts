// Tests con MOCK para la integracion HasData (sin gastar creditos).
// node --test test/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { mapTypeToCategory } from '../src/hasdata/category.ts';
import { normalizeHasDataPlace } from '../src/hasdata/normalize.ts';
import { HasDataClient } from '../src/hasdata/client.ts';
import {
  buildFtsQuery,
  searchLocal,
  extractResults,
  searchLocations,
  webResultsToSocialLinks,
} from '../src/hasdata/search.ts';
import { openDb } from '../src/db.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(__dirname, '..', '..', 'db', 'schema.sql');
const SCHEMA = fs.readFileSync(SCHEMA_PATH, 'utf8');

function memoryDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  return db;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

type FakeFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

// ---- M3 T3: mapeo de categorias ----

test('mapTypeToCategory: mapeo keyword-based', () => {
  assert.equal(mapTypeToCategory('Restaurant'), 'food');
  assert.equal(mapTypeToCategory('Pizza restaurant'), 'food');
  assert.equal(mapTypeToCategory('Museum'), 'sight');
  assert.equal(mapTypeToCategory('Tourist attraction'), 'sight');
  assert.equal(mapTypeToCategory('Night club'), 'nightlife');
  assert.equal(mapTypeToCategory('Cocktail bar'), 'nightlife');
  assert.equal(mapTypeToCategory('Gastropub'), 'food'); // bar/pub gastro -> food
  assert.equal(mapTypeToCategory('Park'), 'activity'); // default
  assert.equal(mapTypeToCategory('Gym'), 'activity');
  assert.equal(mapTypeToCategory(null), 'activity');
  assert.equal(mapTypeToCategory(undefined), 'activity');
});

// ---- M3 T3: normalizacion ----

test('normalizeHasDataPlace: campos y raw_type', () => {
  const raw = {
    title: 'Pizzeria Libretto',
    address: '221 Ossington Ave',
    latitude: 43.6541,
    longitude: -79.4192,
    rating: 4.5,
    reviews: 1200,
    workingHours: { mon: '11:00-22:00' },
    website: 'https://pizzerialibretto.com',
    phone: '+1 416-532-8000',
    type: 'Pizza restaurant',
    description: 'Wood-fired Neapolitan pizza',
    priceLevel: '$$',
    placeId: 'PLACE_123',
    dataId: 'DATA_456',
  };
  const loc = normalizeHasDataPlace(raw);
  assert.equal(loc.source, 'hasdata');
  assert.equal(loc.place_id, 'PLACE_123');
  assert.equal(loc.data_id, 'DATA_456');
  assert.equal(loc.name, 'Pizzeria Libretto');
  assert.equal(loc.category, 'food');
  assert.equal(loc.raw_type, 'Pizza restaurant');
  assert.equal(loc.rating, 4.5);
  assert.equal(loc.rating_count, 1200);
  assert.equal(loc.lat, 43.6541);
  assert.equal(loc.lng, -79.4192);
  assert.equal(loc.phone, '+1 416-532-8000');
  assert.equal(loc.price_level, '$$');
  assert.equal(loc.hours_json, JSON.stringify({ mon: '11:00-22:00' }));
});

// ---- M3 T1: cliente HTTP (mock) ----

test('HasDataClient.search: construye URL y envia x-api-key', async () => {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fakeFetch: FakeFetch = async (input, init) => {
    calls.push({ url: String(input), headers: (init?.headers ?? {}) as Record<string, string> });
    return jsonResponse({ localResults: [] });
  };
  const client = new HasDataClient({ apiKey: 'test-key', fetchImpl: fakeFetch });
  await client.search('pizza Toronto', { lat: 43.65, lng: -79.38, start: 0 });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.headers['x-api-key'], 'test-key');
  const u = new URL(calls[0]!.url);
  assert.equal(u.searchParams.get('q'), 'pizza Toronto');
  assert.equal(u.searchParams.get('ll'), '@43.65,-79.38,14z');
  assert.equal(u.searchParams.get('start'), '0');
});

test('HasDataClient: lanza error en HTTP no-OK (sin filtrar key)', async () => {
  const client = new HasDataClient({
    apiKey: 'test-key',
    fetchImpl: (async () => jsonResponse({ error: 'unauthorized' }, 401)) as FakeFetch,
  });
  await assert.rejects(() => client.search('x'), /HasData HTTP 401/);
});

// ---- M3 T2: cache-first (FTS5 -> miss -> HasData -> upsert) ----

test('searchLocations: FTS5 hit NO llama a HasData', async () => {
  const db = memoryDb();
  db.prepare(`
    INSERT INTO locations (id, source, name, category, lat, lng, description)
    VALUES ('tor-cn-tower', 'seed', 'CN Tower', 'sight', 43.6426, -79.3871, 'Iconic tower')
  `).run();
  db.prepare('INSERT INTO locations_fts (location_id, name, description) VALUES (?,?,?)')
    .run('tor-cn-tower', 'CN Tower', 'Iconic tower');

  let fetched = false;
  const client = new HasDataClient({
    apiKey: 'test-key',
    fetchImpl: (async () => { fetched = true; return jsonResponse({}); }) as FakeFetch,
  });

  const rows = await searchLocations({ db, client, q: 'tower' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.id, 'tor-cn-tower');
  assert.equal(fetched, false, 'no debe llamar a HasData si FTS5 tiene resultados');
});

test('searchLocations: FTS5 miss -> HasData -> normaliza + upsert', async () => {
  const db = memoryDb();
  const client = new HasDataClient({
    apiKey: 'test-key',
    fetchImpl: (async () => jsonResponse({
      localResults: [
        { title: 'Pizza Joint', type: 'Pizza restaurant', latitude: 43.65, longitude: -79.38, placeId: 'P1' },
      ],
    })) as FakeFetch,
  });

  const rows = await searchLocations({ db, client, q: 'pizza' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.name, 'Pizza Joint');
  assert.equal(rows[0]?.source, 'hasdata');
  assert.equal(rows[0]?.category, 'food');

  // verificamos upsert en DB
  const saved = db.prepare('SELECT * FROM locations WHERE place_id = ?').get('P1');
  assert.ok(saved);
  // cache-first: una segunda busqueda no vuelve a llamar a HasData
  let calls = 0;
  const client2 = new HasDataClient({
    apiKey: 'test-key',
    fetchImpl: (async () => { calls++; return jsonResponse({}); }) as FakeFetch,
  });
  const rows2 = await searchLocations({ db, client: client2, q: 'pizza' });
  assert.ok(rows2.length >= 1);
  assert.equal(calls, 0);
});

// ---- misc ----

test('buildFtsQuery: tokens seguros con prefijo', () => {
  assert.equal(buildFtsQuery('pizza Toronto'), '"pizza"* OR "toronto"*');
  assert.equal(buildFtsQuery('   '), null);
});

test('extractResults: maneja localResults/placeResults y fallback', () => {
  assert.equal(extractResults({ localResults: [{ a: 1 }], placeResults: [{ b: 2 }] }).length, 2);
  assert.equal(extractResults({ results: [{ c: 3 }] }).length, 1);
  assert.equal(extractResults({}).length, 0);
});

test('webResultsToSocialLinks: convierte a social_links_json', () => {
  const data = { webResults: [{ title: 'Instagram', link: 'https://instagram.com/x' }] };
  assert.equal(webResultsToSocialLinks(data), JSON.stringify([{ title: 'Instagram', url: 'https://instagram.com/x' }]));
  assert.equal(webResultsToSocialLinks({}), null);
});

test('searchLocal: usa FTS5 y excluye destinos', () => {
  const db = memoryDb();
  db.prepare(`INSERT INTO locations (id, source, name, category, lat, lng) VALUES ('toronto', 'seed', 'Toronto', NULL, 43.65, -79.38)`).run();
  db.prepare('INSERT INTO locations_fts (location_id, name, description) VALUES (?,?,?)').run('toronto', 'Toronto', null);
  const res = searchLocal(db, 'toronto');
  assert.equal(res.length, 0, 'los destinos (category NULL) no aparecen en la busqueda de lugares');
});

test('searchLocations: dedupe de lugares repetidos de HasData (mismo place_id)', async () => {
  const db = memoryDb();
  const client = new HasDataClient({
    apiKey: 'test-key',
    fetchImpl: (async () => jsonResponse({
      localResults: [
        { title: 'Pizza Joint', type: 'Pizza restaurant', latitude: 43.65, longitude: -79.38, placeId: 'P1' },
      ],
      placeResults: [
        { title: 'Pizza Joint', type: 'Pizza restaurant', latitude: 43.65, longitude: -79.38, placeId: 'P1' },
      ],
    })) as FakeFetch,
  });

  const rows = await searchLocations({ db, client, q: 'pizza' });
  assert.equal(rows.length, 1, 'el mismo place_id no debe devolverse dos veces');
  assert.equal(rows[0]?.name, 'Pizza Joint');
});
