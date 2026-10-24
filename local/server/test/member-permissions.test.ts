// Tests de permisos de miembros (REQ 936c57ce): solo el propietario cambia
// roles o elimina miembros; protecciones del owner y autogestión.

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
  db.prepare("INSERT INTO users (id, email, display_name, color) VALUES ('u-editor', 'e@x.com', 'Eli', '#F59E0B')").run();
  db.prepare("INSERT INTO users (id, email, display_name, color) VALUES ('u-viewer', 'v@x.com', 'Vic', '#0EA5E9')").run();
  db.prepare("INSERT INTO users (id, email, display_name, color) VALUES ('u-other', 'x@x.com', 'Cid', '#10B981')").run();
  db.prepare(`
    INSERT INTO trips (id, name, destination_name, owner_id, start_date, end_date, total_budget, invite_code, created_at, updated_at)
    VALUES ('trip-1', 'Viaje', 'Toronto', 'u-owner', '2026-11-01', '2026-11-05', 500, 'ABC12345', '2026-10-12T00:00:00Z', '2026-10-12T00:00:00Z')
  `).run();
  db.prepare("INSERT INTO trip_members (trip_id, user_id, role) VALUES ('trip-1', 'u-owner', 'owner')").run();
  db.prepare("INSERT INTO trip_members (trip_id, user_id, role) VALUES ('trip-1', 'u-editor', 'editor')").run();
  db.prepare("INSERT INTO trip_members (trip_id, user_id, role) VALUES ('trip-1', 'u-viewer', 'viewer')").run();
  return db;
}

function ctxFor(db: DatabaseSync, currentUserId: string): Ctx {
  const pubsub: PubSub = {
    publish() {},
    subscribe() {
      return (async function* () {})();
    },
  };
  return { db, currentUserId, hasdata: null, pubsub };
}

function call(r: Record<string, unknown>, args: Record<string, unknown>, ctx: Ctx): unknown {
  return (r as unknown as (a: unknown, b: unknown, c: Ctx) => unknown)({}, args, ctx);
}

function errorCodeOf(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    if (e instanceof Error && 'extensions' in e) {
      return (e as { extensions?: { code?: string } }).extensions?.code;
    }
    return undefined;
  }
}

test('owner cambia editor→viewer OK', () => {
  const db = memoryDb();
  const trip = call(
    resolvers.Mutation.updateMemberRole as never,
    { tripId: 'trip-1', userId: 'u-editor', role: 'viewer' },
    ctxFor(db, 'u-owner'),
  ) as { members: { userId: string; role: string }[] };
  const editor = trip.members.find((m) => m.userId === 'u-editor');
  assert.equal(editor?.role, 'viewer');
});

test('editor NO puede cambiar roles → NOT_TRIP_OWNER', () => {
  const db = memoryDb();
  const code = errorCodeOf(() =>
    call(resolvers.Mutation.updateMemberRole as never, { tripId: 'trip-1', userId: 'u-viewer', role: 'editor' }, ctxFor(db, 'u-editor')),
  );
  assert.equal(code, 'NOT_TRIP_OWNER');
});

test('no-miembro NO puede cambiar roles → NOT_TRIP_MEMBER', () => {
  const db = memoryDb();
  const code = errorCodeOf(() =>
    call(resolvers.Mutation.updateMemberRole as never, { tripId: 'trip-1', userId: 'u-viewer', role: 'editor' }, ctxFor(db, 'u-other')),
  );
  assert.equal(code, 'NOT_TRIP_MEMBER');
});

test('rol inválido → INVALID_MEMBER_ROLE', () => {
  const db = memoryDb();
  const code = errorCodeOf(() =>
    call(resolvers.Mutation.updateMemberRole as never, { tripId: 'trip-1', userId: 'u-viewer', role: 'admin' }, ctxFor(db, 'u-owner')),
  );
  assert.equal(code, 'INVALID_MEMBER_ROLE');
});

test('cambiar el rol del owner → OWNER_ROLE_PROTECTED', () => {
  const db = memoryDb();
  const code = errorCodeOf(() =>
    call(resolvers.Mutation.updateMemberRole as never, { tripId: 'trip-1', userId: 'u-owner', role: 'viewer' }, ctxFor(db, 'u-owner')),
  );
  assert.equal(code, 'OWNER_ROLE_PROTECTED');
});

test('owner elimina a un viewer OK', () => {
  const db = memoryDb();
  const trip = call(resolvers.Mutation.removeMember as never, { tripId: 'trip-1', userId: 'u-viewer' }, ctxFor(db, 'u-owner')) as {
    members: { userId: string }[];
  };
  assert.equal(trip.members.some((m) => m.userId === 'u-viewer'), false);
});

test('editor NO puede eliminar → NOT_TRIP_OWNER', () => {
  const db = memoryDb();
  const code = errorCodeOf(() =>
    call(resolvers.Mutation.removeMember as never, { tripId: 'trip-1', userId: 'u-viewer' }, ctxFor(db, 'u-editor')),
  );
  assert.equal(code, 'NOT_TRIP_OWNER');
});

test('eliminar al owner → OWNER_CANNOT_BE_REMOVED', () => {
  const db = memoryDb();
  const code = errorCodeOf(() =>
    call(resolvers.Mutation.removeMember as never, { tripId: 'trip-1', userId: 'u-owner' }, ctxFor(db, 'u-owner')),
  );
  assert.equal(code, 'OWNER_CANNOT_BE_REMOVED');
});

test('auto-eliminarse vía removeMember (editor) → NOT_TRIP_OWNER', () => {
  const db = memoryDb();
  const code = errorCodeOf(() =>
    call(resolvers.Mutation.removeMember as never, { tripId: 'trip-1', userId: 'u-editor' }, ctxFor(db, 'u-editor')),
  );
  assert.equal(code, 'NOT_TRIP_OWNER');
});

test('eliminar a un no-miembro del viaje → MEMBER_NOT_FOUND', () => {
  const db = memoryDb();
  const code = errorCodeOf(() =>
    call(resolvers.Mutation.removeMember as never, { tripId: 'trip-1', userId: 'u-other' }, ctxFor(db, 'u-owner')),
  );
  assert.equal(code, 'MEMBER_NOT_FOUND');
});
