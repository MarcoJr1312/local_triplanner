// Tests de M1 (smart-join): getTripByCode devuelve el email invitado del
// preview para que el frontend pueda pre-rellenarlo. El codigo de 12 chars
// sigue siendo el unico secreto; aqui solo se expone el email ya normalizado.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolvers, type Ctx, type PubSub } from '../src/resolvers.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = fs.readFileSync(path.resolve(__dirname, '..', '..', 'db', 'schema.sql'), 'utf8');

function memoryDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO users (id, email, display_name, color) VALUES ('u-owner', 'o@x.com', 'Ana', '#6C3BFF')").run();
  db.prepare(`
    INSERT INTO trips (id, name, destination_name, owner_id, start_date, end_date, total_budget, invite_code, created_at, updated_at)
    VALUES ('trip-1', 'Viaje a Panama', 'Panama City', 'u-owner', '2026-11-01', '2026-11-05', 500, 'ABC12345', '2026-10-12T00:00:00Z', '2026-10-12T00:00:00Z')
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
  return { db, currentUserId: 'demo-user', hasdata: null, pubsub };
}

function getTripByCode(db: DatabaseSync, code: string) {
  return (resolvers.Query.getTripByCode as unknown as (
    a: unknown,
    b: unknown,
    c: Ctx,
  ) => unknown)({}, { code }, ctxFor(db));
}

test('getTripByCode: invitacion valida -> preview con invitedEmail', () => {
  const db = memoryDb();
  db.prepare(
    "INSERT INTO invitations (id, trip_id, email, code, role, status, created_by) VALUES ('inv-1', 'trip-1', 'maria@x.com', 'abcdefghijkl', 'viewer', 'pending', 'u-owner')",
  ).run();
  const preview = getTripByCode(db, 'abcdefghijkl') as {
    id: string;
    name: string;
    destinationName: string;
    ownerName: string;
    invitedEmail: string;
  };
  assert.ok(preview);
  assert.equal(preview.id, 'trip-1');
  assert.equal(preview.name, 'Viaje a Panama');
  assert.equal(preview.destinationName, 'Panama City');
  assert.equal(preview.ownerName, 'Ana');
  assert.equal(preview.invitedEmail, 'maria@x.com');
});

test('getTripByCode: invitacion usada/aceptada sigue devolviendo el preview', () => {
  const db = memoryDb();
  db.prepare(
    "INSERT INTO invitations (id, trip_id, email, code, role, status, accepted_at, created_by) VALUES ('inv-2', 'trip-1', 'jose@x.com', 'mnopqrstuvwx', 'editor', 'accepted', '2026-10-13T00:00:00Z', 'u-owner')",
  ).run();
  const preview = getTripByCode(db, 'mnopqrstuvwx') as { invitedEmail: string } | null;
  assert.ok(preview);
  assert.equal(preview?.invitedEmail, 'jose@x.com');
});

test('getTripByCode: codigo invalido -> null', () => {
  const db = memoryDb();
  assert.equal(getTripByCode(db, 'corto'), null);
  assert.equal(getTripByCode(db, 'abc!defghijkl'), null);
});

test('getTripByCode: codigo valido sin invitacion -> null', () => {
  const db = memoryDb();
  assert.equal(getTripByCode(db, 'ABCDEFGHIJKL'), null);
});
