import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { connectPg } from './helpers/pg.ts';
import { connectMongo } from './helpers/mongo.ts';
import type { PgDb } from '../src/pg/db.ts';
import type { MongoLocationCatalogue } from '../src/catalogue/mongo.ts';
import { seedAll, type SeedData } from '../src/seed.ts';

const data: SeedData = {
  destinations: [
    {
      slug: 'dest-x',
      name: 'Destino X',
      country: 'Panamá',
      description: 'Destino de prueba',
      lat: 8.98,
      lng: -79.52,
      activities: [
        { id: 'act-x', name: 'Actividad X', category: 'sight', lat: 8.99, lng: -79.51, rating: 4.5 },
      ],
    },
  ],
};

let db: PgDb | null = null;
let catalogue: MongoLocationCatalogue | null = null;

async function cleanDemo(conn: PgDb) {
  await conn.prepare("DELETE FROM trip_items WHERE trip_id = 'demo-trip'").run();
  await conn.prepare("DELETE FROM trip_members WHERE trip_id = 'demo-trip'").run();
  await conn.prepare("DELETE FROM trips WHERE id = 'demo-trip'").run();
  await conn.prepare("DELETE FROM users WHERE id = 'demo-user'").run();
  await conn.prepare("DELETE FROM users WHERE id = 'demo-friend'").run();
}

before(async () => {
  db = await connectPg();
  catalogue = await connectMongo('locations_seed_test');
  await catalogue?.clear();
  if (db) await cleanDemo(db);
});

after(async () => {
  await catalogue?.clear();
  await catalogue?.close();
  if (db) await cleanDemo(db);
  await db?.close();
});

describe('seed on Postgres + MongoDB', () => {
  test('writes catalogue and demo data, and is idempotent', async () => {
    if (!db || !catalogue) return;

    const first = await seedAll(catalogue, db, data);
    assert.equal(first, 2);

    const destinations = await catalogue.listDestinations();
    assert.deepEqual(destinations.map((d) => d.slug), ['dest-x']);
    assert.deepEqual((await catalogue.listByParent('dest-x')).map((a) => a.id), ['act-x']);

    const counts = async () =>
      db!
        .prepare(
          `SELECT
             (SELECT count(*)::int FROM users WHERE id IN ('demo-user','demo-friend')) AS users,
             (SELECT count(*)::int FROM trips WHERE id = 'demo-trip') AS trips,
             (SELECT count(*)::int FROM trip_members WHERE trip_id = 'demo-trip') AS members,
             (SELECT count(*)::int FROM trip_items WHERE trip_id = 'demo-trip') AS items`,
        )
        .get<Record<string, number>>();

    const before = await counts();
    assert.deepEqual(before, { users: 2, trips: 1, members: 1, items: 2 });

    await seedAll(catalogue, db, data);
    assert.deepEqual(await counts(), before);
    assert.equal((await catalogue.listDestinations()).length, 1);
    assert.equal((await catalogue.listByParent('dest-x')).length, 1);
  });
});
