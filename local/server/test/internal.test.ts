// Tests de los endpoints internos REST /internal/* (autenticacion por token,
// membresia, trip-context, search-places, places-cache y save-chat).
// Servidor HTTP real en puerto efimero + SQLite en memoria (sin tocar :4000).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createInternalRouter } from '../src/internal.ts';
import { searchLocations } from '../src/hasdata/search.ts';
import { HasDataClient } from '../src/hasdata/client.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = fs.readFileSync(path.resolve(__dirname, '..', '..', 'db', 'schema.sql'), 'utf8');

const TOKEN = 'test-internal-token';

function memoryDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO users (id, email, display_name, color, language) VALUES ('u1', 'ana@test.com', 'Ana', '#111111', 'es')").run();
  db.prepare("INSERT INTO users (id, email, display_name, color, language) VALUES ('u2', 'bob@test.com', 'Bob', '#222222', 'en')").run();
  db.prepare("INSERT INTO users (id, email, display_name, color, language) VALUES ('u3', 'cara@test.com', 'Cara', '#333333', 'es')").run();
  db.prepare(
    "INSERT INTO locations (id, source, name, category, lat, lng, slug) VALUES ('dest-1', 'seed', 'Toronto', NULL, 43.6532, -79.3832, 'toronto')"
  ).run();
  db.prepare(
    "INSERT INTO locations (id, source, name, category, lat, lng, parent_id) VALUES ('loc-1', 'seed', 'CN Tower', 'sight', 43.6426, -79.3871, 'dest-1')"
  ).run();
  db.prepare(
    "INSERT INTO locations (id, source, name, category, lat, lng) VALUES ('loc-2', 'hasdata', 'Pizza Joint', 'food', 43.65, -79.38)"
  ).run();
  db.prepare('INSERT INTO locations_fts (location_id, name, description) VALUES (?,?,?)').run('loc-2', 'Pizza Joint', null);
  db.prepare(
    "INSERT INTO trips (id, name, destination_id, destination_name, start_date, end_date, total_budget, owner_id, invite_code) VALUES ('trip-1', 'Viaje Toronto', 'dest-1', 'Toronto', '2026-11-01', '2026-11-04', 100, 'u1', 'CODE123')"
  ).run();
  db.prepare("INSERT INTO trip_members (trip_id, user_id, role) VALUES ('trip-1', 'u1', 'owner')").run();
  db.prepare("INSERT INTO trip_members (trip_id, user_id, role) VALUES ('trip-1', 'u2', 'viewer')").run();
  db.prepare(
    "INSERT INTO trip_items (id, trip_id, location_id, title, category, cost, day, \"order\", start_time, created_by) VALUES ('item-1', 'trip-1', 'loc-1', 'CN Tower', 'sight', 40, '2026-11-01', 0, '09:00', 'u1')"
  ).run();
  db.prepare(
    "INSERT INTO trip_items (id, trip_id, location_id, title, category, cost, day, \"order\", start_time, created_by) VALUES ('item-2', 'trip-1', NULL, 'Cena', 'food', 25, '2026-11-02', 0, NULL, 'u1')"
  ).run();
  return db;
}

interface TestServer {
  server: Server;
  baseUrl: string;
}

async function startServer(db: DatabaseSync): Promise<TestServer> {
  const router = createInternalRouter({ db, hasdata: null, internalToken: TOKEN });
  const server = createServer((req, res) => {
    void router(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
}

async function get(baseUrl: string, p: string, headers: Record<string, string> = {}) {
  const res = await fetch(baseUrl + p, { headers });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function post(baseUrl: string, p: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(baseUrl + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const authHeaders = { 'x-internal-token': TOKEN };

test('internal: 401 sin X-Internal-Token', async () => {
  const db = memoryDb();
  const { server, baseUrl } = await startServer(db);
  try {
    const r = await get(baseUrl, '/internal/trip-context/trip-1', { 'x-user-id': 'u1' });
    assert.equal(r.status, 401);
    assert.equal(r.body.error, 'UNAUTHORIZED');
  } finally {
    await close(server);
  }
});

test('internal: 403 no-miembro en trip-context y places-cache', async () => {
  const db = memoryDb();
  const { server, baseUrl } = await startServer(db);
  try {
    const tc = await get(baseUrl, '/internal/trip-context/trip-1', { ...authHeaders, 'x-user-id': 'u3' });
    assert.equal(tc.status, 403);
    assert.equal(tc.body.error, 'NOT_TRIP_MEMBER');

    const pc = await get(baseUrl, '/internal/places-cache/trip-1', { ...authHeaders, 'x-user-id': 'u3' });
    assert.equal(pc.status, 403);
    assert.equal(pc.body.error, 'NOT_TRIP_MEMBER');
  } finally {
    await close(server);
  }
});

test('internal: trip-context correcto (spent, items por dia, language, coords)', async () => {
  const db = memoryDb();
  const { server, baseUrl } = await startServer(db);
  try {
    const r = await get(baseUrl, '/internal/trip-context/trip-1', { ...authHeaders, 'x-user-id': 'u2' });
    assert.equal(r.status, 200);
    const body = r.body as {
      trip: { id: string; lat: number; lng: number; spent: number; totalBudget: number; destinationName: string };
      days: { date: string; items: { id: string; title: string; startTime: string | null }[] }[];
      members: { userId: string; role: string }[];
      userLanguage: string;
    };
    assert.equal(body.trip.id, 'trip-1');
    assert.equal(body.trip.destinationName, 'Toronto');
    assert.equal(body.trip.lat, 43.6532);
    assert.equal(body.trip.lng, -79.3832);
    assert.equal(body.trip.totalBudget, 100);
    assert.equal(body.trip.spent, 65);
    assert.equal(body.userLanguage, 'en');

    assert.equal(body.days.length, 2);
    const d1 = body.days.find((d) => d.date === '2026-11-01');
    const d2 = body.days.find((d) => d.date === '2026-11-02');
    assert.ok(d1);
    assert.ok(d2);
    assert.equal(d1.items.length, 1);
    assert.equal(d1.items[0]?.title, 'CN Tower');
    assert.equal(d1.items[0]?.startTime, '09:00');
    assert.equal(d2.items.length, 1);
    assert.equal(d2.items[0]?.title, 'Cena');

    assert.deepEqual(body.members.map((m) => m.userId).sort(), ['u1', 'u2']);
  } finally {
    await close(server);
  }
});

test('internal: search-places == searchLocations (cache-first, favoritos)', async () => {
  const db = memoryDb();
  const { server, baseUrl } = await startServer(db);
  try {
    const r = await post(baseUrl, '/internal/search-places', { q: 'pizza', tripId: 'trip-1', userId: 'u1' }, authHeaders);
    assert.equal(r.status, 200);
    const places = r.body as unknown as { id: string; name: string; category: string; isFavorite: boolean }[];
    assert.equal(places.length, 1);
    assert.equal(places[0]?.id, 'loc-2');
    assert.equal(places[0]?.name, 'Pizza Joint');
    assert.equal(places[0]?.category, 'food');
    assert.equal(places[0]?.isFavorite, false);

    const direct = await searchLocations({ db, client: null, q: 'pizza', lat: 43.6532, lng: -79.3832, userId: 'u1' });
    assert.equal(places[0]?.id, direct[0]?.id);
  } finally {
    await close(server);
  }
});

test('internal: places-cache con contentHash estable', async () => {
  const db = memoryDb();
  const { server, baseUrl } = await startServer(db);
  try {
    const headers = { ...authHeaders, 'x-user-id': 'u1' };
    const r1 = await get(baseUrl, '/internal/places-cache/trip-1', headers);
    assert.equal(r1.status, 200);
    const b1 = r1.body as { places: { id: string }[]; contentHash: string };
    assert.ok(b1.contentHash.length > 0);
    const ids = b1.places.map((p) => p.id).sort();
    assert.deepEqual(ids, ['loc-1', 'loc-2']);

    const r2 = await get(baseUrl, '/internal/places-cache/trip-1', headers);
    const b2 = r2.body as { places: { id: string }[]; contentHash: string };
    assert.equal(b1.contentHash, b2.contentHash, 'contentHash debe ser estable');
  } finally {
    await close(server);
  }
});

test('internal: save-chat upsert (segunda vez actualiza la fila)', async () => {
  const db = memoryDb();
  const { server, baseUrl } = await startServer(db);
  try {
    const first = await post(
      baseUrl,
      '/internal/save-chat',
      { tripId: 'trip-1', userId: 'u1', day: '2026-11-01', messages: [{ role: 'user', content: 'hola' }] },
      authHeaders,
    );
    assert.equal(first.status, 200);
    const id1 = (first.body as { id: string }).id;

    const second = await post(
      baseUrl,
      '/internal/save-chat',
      { tripId: 'trip-1', userId: 'u1', day: '2026-11-01', messages: [{ role: 'user', content: 'adios' }] },
      authHeaders,
    );
    assert.equal(second.status, 200);
    assert.equal((second.body as { id: string }).id, id1, 'upsert debe reutilizar el mismo id');

    const count = db
      .prepare('SELECT COUNT(*) AS c FROM suggestion_chats')
      .get() as { c: number };
    assert.equal(count.c, 1);
    const row = db
      .prepare("SELECT messages FROM suggestion_chats WHERE trip_id = 'trip-1' AND user_id = 'u1'")
      .get() as { messages: string };
    assert.equal(JSON.parse(row.messages)[0].content, 'adios');
  } finally {
    await close(server);
  }
});

test('internal: place-details requiere HasData (503 sin key)', async () => {
  const db = memoryDb();
  const { server, baseUrl } = await startServer(db);
  try {
    const r = await post(baseUrl, '/internal/place-details', { placeId: 'PLACE_1' }, authHeaders);
    assert.equal(r.status, 503);
    assert.equal(r.body.error, 'HASDATA_UNAVAILABLE');
  } finally {
    await close(server);
  }
});

// Place-details con HasData mockeado devuelve el JSON reducido.
test('internal: place-details con HasData devuelve JSON reducido', async () => {
  const db = memoryDb();
  const fakeFetch = async () =>
    new Response(
      JSON.stringify({
        data: {
          title: 'Pizzeria Libretto',
          description: 'Wood-fired',
          rating: 4.5,
          reviews: 1200,
          phone: '+1 416',
          website: 'https://pizzeria.com',
          address: '221 Ossington',
          workingHours: { mon: '11:00-22:00' },
          photos: ['https://img/1.jpg'],
        },
        webResults: [{ title: 'Instagram', link: 'https://instagram.com/x' }],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  const hasdata = new HasDataClient({ apiKey: 'test-key', fetchImpl: fakeFetch as typeof fetch });
  const router = createInternalRouter({ db, hasdata, internalToken: TOKEN });
  const server = createServer((req, res) => {
    void router(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/internal/place-details`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-token': TOKEN },
      body: JSON.stringify({ placeId: 'PLACE_1' }),
    });
    const body = (await res.json()) as {
      name: string;
      rating: number;
      ratingCount: number;
      hours: { mon: string };
      photos: string[];
      socialLinks: { title: string; url: string }[];
    };
    assert.equal(res.status, 200);
    assert.equal(body.name, 'Pizzeria Libretto');
    assert.equal(body.rating, 4.5);
    assert.equal(body.ratingCount, 1200);
    assert.equal(body.hours.mon, '11:00-22:00');
    assert.equal(body.photos[0], 'https://img/1.jpg');
    assert.equal(body.socialLinks[0]?.url, 'https://instagram.com/x');
  } finally {
    await close(server);
  }
});
