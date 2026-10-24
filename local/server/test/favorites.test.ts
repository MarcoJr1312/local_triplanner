// Tests de favoritos: toggle idempotente + orden favoritos-primero en FTS.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { setFavorite, isFavorite, favoriteIdsForUser } from '../src/favorites.ts';
import { searchLocal } from '../src/hasdata/search.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = fs.readFileSync(path.resolve(__dirname, '..', '..', 'db', 'schema.sql'), 'utf8');

function memoryDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO users (id, email, display_name, color) VALUES ('u1', 'a@b.com', 'Ana', '#6C3BFF')").run();
  db.prepare("INSERT INTO users (id, email, display_name, color) VALUES ('u2', 'c@d.com', 'Bea', '#0EA5E9')").run();
  for (const [id, name] of [['loc-a', 'Cafe A'], ['loc-b', 'Cafe B'], ['loc-c', 'Cafe C']] as const) {
    db.prepare("INSERT INTO locations (id, source, name, category, lat, lng, description) VALUES (?, 'hasdata', ?, 'food', 43.65, -79.38, 'cafe')").run(id, name);
    db.prepare('INSERT INTO locations_fts (location_id, name, description) VALUES (?,?,?)').run(id, name, 'cafe');
  }
  return db;
}

test('setFavorite: marcar/desmarcar idempotente', () => {
  const db = memoryDb();
  assert.equal(setFavorite(db, 'u1', 'loc-a', true), true);
  assert.ok(isFavorite(db, 'u1', 'loc-a'));
  assert.ok(!isFavorite(db, 'u2', 'loc-a'), 'favorito es por usuario');
  // idempotente
  assert.equal(setFavorite(db, 'u1', 'loc-a', true), true);
  assert.equal((db.prepare('SELECT COUNT(*) c FROM user_favorites').get() as { c: number }).c, 1);
  assert.equal(setFavorite(db, 'u1', 'loc-a', false), false);
  assert.ok(!isFavorite(db, 'u1', 'loc-a'));
  assert.equal((db.prepare('SELECT COUNT(*) c FROM user_favorites').get() as { c: number }).c, 0);
});

test('setFavorite: lugar inexistente -> error', () => {
  const db = memoryDb();
  assert.throws(() => setFavorite(db, 'u1', 'no-existe', true), /Lugar no encontrado/);
});

test('favoriteIdsForUser: set de ids por usuario', () => {
  const db = memoryDb();
  setFavorite(db, 'u1', 'loc-a', true);
  setFavorite(db, 'u1', 'loc-c', true);
  setFavorite(db, 'u2', 'loc-b', true);
  const ids = favoriteIdsForUser(db, 'u1');
  assert.deepEqual([...ids].sort(), ['loc-a', 'loc-c']);
});

test('searchLocal: favoritos del usuario SIEMPRE primero', () => {
  const db = memoryDb();
  // sin favoritos: orden por bm25 (los tres empatan; orden de insercion/estable)
  const base = searchLocal(db, 'cafe', {}, 20, 'u1');
  assert.equal(base.length, 3);
  setFavorite(db, 'u1', 'loc-c', true);
  const res = searchLocal(db, 'cafe', {}, 20, 'u1');
  assert.equal(res[0]?.id, 'loc-c', 'el favorito debe salir primero');
  // otros usuarios no ven el favorito de u1 arriba
  const resU2 = searchLocal(db, 'cafe', {}, 20, 'u2');
  assert.notEqual(resU2[0]?.id, 'loc-c', 'el favorito es personal');
});
