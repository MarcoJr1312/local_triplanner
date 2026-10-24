// Tests de ubicacion manual (M1): trip_items.location_text, migracion
// idempotente y persistencia en addItem/updateItem.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolvers, type Ctx, type PubSub } from '../src/resolvers.ts';
import { migrateItemLocationText } from '../src/db.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = fs.readFileSync(path.resolve(__dirname, '..', '..', 'db', 'schema.sql'), 'utf8');

function memoryDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO users (id, email, display_name, color) VALUES ('u-owner', 'o@x.com', 'Ana', '#6C3BFF')").run();
  db.prepare(`
    INSERT INTO trips (id, name, destination_name, owner_id, start_date, end_date, total_budget, invite_code, created_at, updated_at)
    VALUES ('trip-1', 'Viaje', 'Toronto', 'u-owner', '2026-11-01', '2026-11-05', 500, 'ABC12345', '2026-10-12T00:00:00Z', '2026-10-12T00:00:00Z')
  `).run();
  db.prepare("INSERT INTO trip_members (trip_id, user_id, role) VALUES ('trip-1', 'u-owner', 'owner')").run();
  return db;
}

function ctxFor(db: DatabaseSync): Ctx {
  const pubsub: PubSub = {
    publish() {
      /* noop */
    },
    subscribe() {
      return (async function* () {
        /* sin eventos */
      })();
    },
  };
  return { db, currentUserId: 'u-owner', hasdata: null, pubsub };
}

function addItem(db: DatabaseSync, locationText?: string | null) {
  const input: Record<string, unknown> = {
    title: 'Cena',
    category: 'food',
    cost: 30,
    day: '2026-11-01',
    order: 0,
  };
  if (locationText !== undefined) input.locationText = locationText;
  return resolvers.Mutation.addItem!(
    null,
    { tripId: 'trip-1', input },
    ctxFor(db)
  ) as { id: string; locationText: string | null };
}

function updateItem(db: DatabaseSync, itemId: string, input: Record<string, unknown>) {
  return resolvers.Mutation.updateItem!(
    null,
    { tripId: 'trip-1', itemId, input },
    ctxFor(db)
  ) as { id: string; locationText: string | null };
}

function stored(db: DatabaseSync, itemId: string): string | null {
  return (
    db.prepare('SELECT location_text FROM trip_items WHERE id = ?').get(itemId) as {
      location_text: string | null;
    }
  ).location_text;
}

test('addItem: locationText se persiste con trim', () => {
  const db = memoryDb();
  const item = addItem(db, '  Feria de San Telmo  ');
  assert.equal(item.locationText, 'Feria de San Telmo');
  assert.equal(stored(db, item.id), 'Feria de San Telmo');
});

test('addItem: sin locationText -> null', () => {
  const db = memoryDb();
  const item = addItem(db);
  assert.equal(item.locationText, null);
  assert.equal(stored(db, item.id), null);
});

test('addItem: locationText vacio -> null', () => {
  const db = memoryDb();
  const item = addItem(db, '   ');
  assert.equal(item.locationText, null);
  assert.equal(stored(db, item.id), null);
});

test('addItem: locationText > 200 chars se recorta sin error', () => {
  const db = memoryDb();
  const long = 'x'.repeat(250);
  const item = addItem(db, long);
  assert.equal(item.locationText, 'x'.repeat(200));
  assert.equal(stored(db, item.id), 'x'.repeat(200));
});

test('updateItem: con texto cambia el valor (trim)', () => {
  const db = memoryDb();
  const item = addItem(db, 'Plaza');
  const updated = updateItem(db, item.id, { locationText: '  Mercado Central ' });
  assert.equal(updated.locationText, 'Mercado Central');
  assert.equal(stored(db, item.id), 'Mercado Central');
});

test('updateItem: locationText null explicito limpia', () => {
  const db = memoryDb();
  const item = addItem(db, 'Plaza');
  const updated = updateItem(db, item.id, { locationText: null });
  assert.equal(updated.locationText, null);
  assert.equal(stored(db, item.id), null);
});

test('updateItem: sin locationText no toca el existente', () => {
  const db = memoryDb();
  const item = addItem(db, 'Plaza');
  const updated = updateItem(db, item.id, { title: 'Almuerzo' });
  assert.equal(updated.locationText, 'Plaza');
  assert.equal(stored(db, item.id), 'Plaza');
});

test('getTrip: el GQL del viaje devuelve locationText en cada item', () => {
  const db = memoryDb();
  const withText = addItem(db, 'Museo');
  addItem(db);
  const trip = resolvers.Query.getTrip!(null, { id: 'trip-1' }, ctxFor(db)) as {
    items: { id: string; locationText: string | null }[];
  };
  const byId = new Map(trip.items.map((i) => [i.id, i.locationText]));
  assert.equal(byId.get(withText.id), 'Museo');
  assert.equal([...byId.values()].filter((v) => v === null).length, 1);
});

test('migracion location_text: idempotente sobre tabla legacy', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE trip_items (id TEXT PRIMARY KEY)');
  migrateItemLocationText(db);
  migrateItemLocationText(db);
  const cols = db.prepare("SELECT name FROM pragma_table_info('trip_items')").all() as { name: string }[];
  assert.equal(cols.filter((c) => c.name === 'location_text').length, 1);
});
