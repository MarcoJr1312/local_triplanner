// Tests de suggestion_chats (GraphQL): suggestionChats (solo del usuario) y
// saveSuggestionChat (upsert + validacion de membresia y mensajes).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { GraphQLError } from 'graphql';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolvers, type Ctx } from '../src/resolvers.ts';
import { listSuggestionChats, upsertSuggestionChat } from '../src/chats.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = fs.readFileSync(path.resolve(__dirname, '..', '..', 'db', 'schema.sql'), 'utf8');

function seedDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO users (id, email, display_name, color) VALUES ('u1', 'ana@test.com', 'Ana', '#111')").run();
  db.prepare("INSERT INTO users (id, email, display_name, color) VALUES ('u2', 'bob@test.com', 'Bob', '#222')").run();
  db.prepare("INSERT INTO users (id, email, display_name, color) VALUES ('u3', 'cara@test.com', 'Cara', '#333')").run();
  db.prepare(
    "INSERT INTO locations (id, source, name, category, lat, lng, slug) VALUES ('dest-1', 'seed', 'Toronto', NULL, 43.65, -79.38, 'toronto')"
  ).run();
  db.prepare(
    "INSERT INTO trips (id, name, destination_id, destination_name, start_date, end_date, total_budget, owner_id, invite_code) VALUES ('trip-1', 'Viaje', 'dest-1', 'Toronto', '2026-11-01', '2026-11-04', 100, 'u1', 'CODE123')"
  ).run();
  db.prepare("INSERT INTO trip_members (trip_id, user_id, role) VALUES ('trip-1', 'u1', 'owner')").run();
  db.prepare("INSERT INTO trip_members (trip_id, user_id, role) VALUES ('trip-1', 'u2', 'viewer')").run();
  return db;
}

function ctxFor(db: DatabaseSync, userId: string): Ctx {
  return { db, currentUserId: userId } as unknown as Ctx;
}

function errorCode(err: unknown): string {
  const g = err as GraphQLError;
  return String(g.extensions?.code ?? '');
}

test('chats: saveSuggestionChat upsert (misma fila, mensajes actualizados)', () => {
  const db = seedDb();
  const ctx = ctxFor(db, 'u1');

  const first = resolvers.Mutation.saveSuggestionChat!(null, {
    tripId: 'trip-1',
    day: '2026-11-01',
    messages: [{ role: 'user', content: 'hola' }],
  }, ctx) as { id: string; messages: { content: string }[] };

  const second = resolvers.Mutation.saveSuggestionChat!(null, {
    tripId: 'trip-1',
    day: '2026-11-01',
    messages: [{ role: 'user', content: 'adios' }],
  }, ctx) as { id: string; messages: { content: string }[] };

  assert.equal(second.id, first.id, 'upsert reutiliza el id');
  assert.equal(second.messages[0]?.content, 'adios');

  const count = db.prepare('SELECT COUNT(*) AS c FROM suggestion_chats').get() as { c: number };
  assert.equal(count.c, 1);
});

test('chats: suggestionChats devuelve solo los del usuario', () => {
  const db = seedDb();
  upsertSuggestionChat(db, { tripId: 'trip-1', userId: 'u1', day: '2026-11-01', messages: [{ role: 'user', content: 'a' }] });
  upsertSuggestionChat(db, { tripId: 'trip-1', userId: 'u2', day: '2026-11-01', messages: [{ role: 'user', content: 'b' }] });
  upsertSuggestionChat(db, { tripId: 'trip-1', userId: 'u2', day: '2026-11-02', messages: [{ role: 'user', content: 'c' }] });

  const mine = resolvers.Query.suggestionChats!(null, { tripId: 'trip-1' }, ctxFor(db, 'u1')) as { userId: string; day: string }[];
  assert.equal(mine.length, 1);
  assert.equal(mine[0]?.userId, 'u1');
  assert.equal(mine[0]?.day, '2026-11-01');

  const bob = listSuggestionChats(db, 'trip-1', 'u2');
  assert.equal(bob.length, 2);

  const bobDay2 = resolvers.Query.suggestionChats!(null, { tripId: 'trip-1', day: '2026-11-02' }, ctxFor(db, 'u2')) as { day: string }[];
  assert.equal(bobDay2.length, 1);
  assert.equal(bobDay2[0]?.day, '2026-11-02');
});

test('chats: saveSuggestionChat rechaza no-miembro', () => {
  const db = seedDb();
  assert.throws(
    () =>
      resolvers.Mutation.saveSuggestionChat!(null, {
        tripId: 'trip-1',
        day: '2026-11-01',
        messages: [{ role: 'user', content: 'hola' }],
      }, ctxFor(db, 'u3')),
    (err: unknown) => errorCode(err) === 'NOT_TRIP_MEMBER',
  );
});

test('chats: saveSuggestionChat rechaza trip inexistente', () => {
  const db = seedDb();
  assert.throws(
    () =>
      resolvers.Mutation.saveSuggestionChat!(null, {
        tripId: 'no-existe',
        day: '2026-11-01',
        messages: [{ role: 'user', content: 'hola' }],
      }, ctxFor(db, 'u1')),
    (err: unknown) => errorCode(err) === 'TRIP_NOT_FOUND',
  );
});

test('chats: saveSuggestionChat valida messages', () => {
  const db = seedDb();
  const ctx = ctxFor(db, 'u1');

  assert.throws(
    () =>
      resolvers.Mutation.saveSuggestionChat!(null, {
        tripId: 'trip-1',
        day: '2026-11-01',
        messages: [],
      }, ctx),
    (err: unknown) => errorCode(err) === 'INVALID_MESSAGES',
  );

  assert.throws(
    () =>
      resolvers.Mutation.saveSuggestionChat!(null, {
        tripId: 'trip-1',
        day: '2026-11-01',
        messages: [{ role: 'user' }],
      }, ctx),
    (err: unknown) => errorCode(err) === 'INVALID_MESSAGES',
  );
});
