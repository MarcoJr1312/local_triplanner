// Tests de coordenadas para rutas: TripItem.lat/lng y Trip.destinationLat/Lng
// se resuelven por JOIN a locations; null cuando no hay ubicacion/destino.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { searchLocal } from '../src/hasdata/search.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = fs.readFileSync(path.resolve(__dirname, '..', '..', 'db', 'schema.sql'), 'utf8');

function memoryDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO users (id, email, display_name, color) VALUES ('u1', 'a@b.com', 'Ana', '#6C3BFF')").run();
  db.prepare(
    "INSERT INTO locations (id, source, name, category, lat, lng) VALUES ('dest-1', 'seed', 'Toronto', NULL, 43.6532, -79.3832)"
  ).run();
  db.prepare(
    "INSERT INTO locations (id, source, name, category, lat, lng) VALUES ('loc-1', 'seed', 'Sushi', 'food', 43.65, -79.38)"
  ).run();
  db.prepare(
    "INSERT INTO trips (id, name, destination_id, destination_name, start_date, end_date, total_budget, owner_id, invite_code) VALUES ('trip-1', 'Viaje', 'dest-1', 'Toronto', '2026-11-01', '2026-11-04', 100, 'u1', 'CODE123')"
  ).run();
  return db;
}

function tripItemRow(db: DatabaseSync, locationId: string | null, title: string) {
  const row = db
    .prepare(
      "INSERT INTO trip_items (id, trip_id, location_id, title, category, cost, day, \"order\", created_by) VALUES (?, 'trip-1', ?, ?, 'food', 0, '2026-11-01', 0, 'u1') RETURNING id"
    )
    .get(crypto.randomUUID(), locationId, title) as { id: string };
  return row.id;
}

test('TripItem.lat/lng: coords del location, null para manuales', () => {
  const db = memoryDb();
  const withLoc = tripItemRow(db, 'loc-1', 'Sushi');
  const manual = tripItemRow(db, null, 'Cena');
  // simular los resolvers (JOIN por activityId/location_id)
  const lat = (id: string) => {
    const item = db.prepare('SELECT location_id FROM trip_items WHERE id = ?').get(id) as {
      location_id: string | null;
    };
    if (!item.location_id) return null;
    return (db.prepare('SELECT lat FROM locations WHERE id = ?').get(item.location_id) as { lat: number | null }).lat;
  };
  assert.equal(lat(withLoc), 43.65);
  assert.equal(lat(manual), null);
});

test('Trip.destinationLat/Lng: coords del destino', () => {
  const db = memoryDb();
  const trip = db.prepare("SELECT destination_id FROM trips WHERE id = 'trip-1'").get() as {
    destination_id: string;
  };
  const row = db.prepare('SELECT lat, lng FROM locations WHERE id = ?').get(trip.destination_id) as {
    lat: number;
    lng: number;
  };
  assert.equal(row.lat, 43.6532);
  assert.equal(row.lng, -79.3832);
});

test('searchLocal sigue funcionando con el esquema ampliado', () => {
  const db = memoryDb();
  db.prepare(
    "INSERT INTO locations (id, source, name, category, lat, lng, description) VALUES ('loc-2', 'hasdata', 'Sushi A', 'food', 43.65, -79.38, 'sushi')"
  ).run();
  db.prepare('INSERT INTO locations_fts (location_id, name, description) VALUES (?,?,?)').run('loc-2', 'Sushi A', 'sushi');
  const res = searchLocal(db, 'sushi', {}, 20, 'u1');
  assert.equal(res.length, 1);
  assert.equal(res[0]?.id, 'loc-2');
});
