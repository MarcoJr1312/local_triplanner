// Tests de seguridad (REQ a96d80be): toda lectura/escritura de un viaje exige
// membresía; las escrituras del itinerario exigen owner/editor; los items no
// pueden manipularse desde otro viaje (cross-trip).

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
  db.prepare(`
    INSERT INTO trips (id, name, destination_name, owner_id, start_date, end_date, total_budget, invite_code, created_at, updated_at)
    VALUES ('trip-2', 'Otro viaje', 'Paris', 'u-owner', '2026-12-01', '2026-12-03', 100, 'XYZ98765', '2026-10-12T00:00:00Z', '2026-10-12T00:00:00Z')
  `).run();
  db.prepare("INSERT INTO trip_members (trip_id, user_id, role) VALUES ('trip-1', 'u-owner', 'owner')").run();
  db.prepare("INSERT INTO trip_members (trip_id, user_id, role) VALUES ('trip-1', 'u-editor', 'editor')").run();
  db.prepare("INSERT INTO trip_members (trip_id, user_id, role) VALUES ('trip-1', 'u-viewer', 'viewer')").run();
  db.prepare("INSERT INTO trip_members (trip_id, user_id, role) VALUES ('trip-2', 'u-owner', 'owner')").run();
  db.prepare(`
    INSERT INTO trip_items (id, trip_id, title, category, cost, day, "order")
    VALUES ('item-1', 'trip-1', 'Cena', 'food', 30, '2026-11-01', 0)
  `).run();
  db.prepare(`
    INSERT INTO trip_items (id, trip_id, title, category, cost, day, "order")
    VALUES ('item-2', 'trip-2', 'Museo', 'sight', 10, '2026-12-01', 0)
  `).run();
  return db;
}

function ctxFor(db: DatabaseSync, currentUserId: string): Ctx {
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
  return { db, currentUserId, hasdata: null, pubsub };
}

function errorCodeOf(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    if (e instanceof Error && 'extensions' in e) {
      const ext = (e as { extensions?: { code?: string } }).extensions;
      return ext?.code;
    }
    return undefined;
  }
}

function call(r: Record<string, unknown>, args: Record<string, unknown>, ctx: Ctx): unknown {
  return (r as unknown as (a: unknown, b: unknown, c: Ctx) => unknown)({}, args, ctx);
}

test('no-miembro: getTrip → NOT_TRIP_MEMBER', () => {
  const db = memoryDb();
  const code = errorCodeOf(() => call(resolvers.Query.getTrip as never, { id: 'trip-1' }, ctxFor(db, 'u-other')));
  assert.equal(code, 'NOT_TRIP_MEMBER');
});

test('miembro viewer: getTrip funciona (lectura permitida)', () => {
  const db = memoryDb();
  const trip = call(resolvers.Query.getTrip as never, { id: 'trip-1' }, ctxFor(db, 'u-viewer')) as { id: string };
  assert.equal(trip.id, 'trip-1');
});

test('no-miembro: addItem → NOT_TRIP_MEMBER', () => {
  const db = memoryDb();
  const code = errorCodeOf(() =>
    call(resolvers.Mutation.addItem as never, { tripId: 'trip-1', input: { title: 'X', category: 'food', cost: 1 } }, ctxFor(db, 'u-other')),
  );
  assert.equal(code, 'NOT_TRIP_MEMBER');
});

test('viewer: addItem → FORBIDDEN_EDIT', () => {
  const db = memoryDb();
  const code = errorCodeOf(() =>
    call(resolvers.Mutation.addItem as never, { tripId: 'trip-1', input: { title: 'X', category: 'food', cost: 1 } }, ctxFor(db, 'u-viewer')),
  );
  assert.equal(code, 'FORBIDDEN_EDIT');
});

test('viewer: updateItem/setItemCost/moveItem/removeItem → FORBIDDEN_EDIT', () => {
  const db = memoryDb();
  const viewer = ctxFor(db, 'u-viewer');
  const cases: (() => unknown)[] = [
    () => call(resolvers.Mutation.updateItem as never, { tripId: 'trip-1', itemId: 'item-1', input: { title: 'Y' } }, viewer),
    () => call(resolvers.Mutation.setItemCost as never, { tripId: 'trip-1', itemId: 'item-1', cost: 99 }, viewer),
    () => call(resolvers.Mutation.moveItem as never, { tripId: 'trip-1', itemId: 'item-1', day: '2026-11-02', order: 1 }, viewer),
    () => call(resolvers.Mutation.removeItem as never, { tripId: 'trip-1', itemId: 'item-1' }, viewer),
  ];
  for (const fn of cases) assert.equal(errorCodeOf(fn), 'FORBIDDEN_EDIT');
});

test('owner: updateItem con item de OTRO viaje → ITEM_NOT_FOUND (sin cambios)', () => {
  const db = memoryDb();
  const owner = ctxFor(db, 'u-owner');
  const code = errorCodeOf(() =>
    call(resolvers.Mutation.updateItem as never, { tripId: 'trip-2', itemId: 'item-1', input: { title: 'Robo' } }, owner),
  );
  assert.equal(code, 'ITEM_NOT_FOUND');
  const row = db.prepare("SELECT title FROM trip_items WHERE id = 'item-1'").get() as { title: string };
  assert.equal(row.title, 'Cena');
});

test('no-miembro: requestSuggestions → NOT_TRIP_MEMBER', () => {
  const db = memoryDb();
  const code = errorCodeOf(() =>
    call(resolvers.Mutation.requestSuggestions as never, { tripId: 'trip-1', day: '2026-11-01' }, ctxFor(db, 'u-other')),
  );
  assert.equal(code, 'NOT_TRIP_MEMBER');
});

test('no-miembro: touchPresence → NOT_TRIP_MEMBER', () => {
  const db = memoryDb();
  const code = errorCodeOf(() =>
    call(
      resolvers.Mutation.touchPresence as never,
      { input: { tripId: 'trip-1', displayName: 'Cid', color: null, editingItemId: null } },
      ctxFor(db, 'u-other'),
    ),
  );
  assert.equal(code, 'NOT_TRIP_MEMBER');
});

test('no-miembro: subscriptions onTripChanged/onPresenceChanged → NOT_TRIP_MEMBER', () => {
  const db = memoryDb();
  const other = ctxFor(db, 'u-other');
  const code1 = errorCodeOf(() =>
    call(resolvers.Subscription.onTripChanged!.subscribe as never, { tripId: 'trip-1' }, other),
  );
  const code2 = errorCodeOf(() =>
    call(resolvers.Subscription.onPresenceChanged!.subscribe as never, { tripId: 'trip-1' }, other),
  );
  assert.equal(code1, 'NOT_TRIP_MEMBER');
  assert.equal(code2, 'NOT_TRIP_MEMBER');
});

test('owner: flujo normal intacto (getTrip/addItem/updateItem/removeItem/subscription)', () => {
  const db = memoryDb();
  const owner = ctxFor(db, 'u-owner');

  const trip = call(resolvers.Query.getTrip as never, { id: 'trip-1' }, owner) as { id: string };
  assert.equal(trip.id, 'trip-1');

  const added = call(
    resolvers.Mutation.addItem as never,
    { tripId: 'trip-1', input: { title: 'Almuerzo', category: 'food', cost: 15, day: '2026-11-01', order: -1 } },
    owner,
  ) as { title: string; id?: string };
  assert.equal(added.title, 'Almuerzo');

  const updated = call(
    resolvers.Mutation.updateItem as never,
    { tripId: 'trip-1', itemId: added.id ?? '', input: { title: 'Almuerzo XL' } },
    owner,
  ) as { title: string };
  assert.equal(updated.title, 'Almuerzo XL');

  const removed = call(resolvers.Mutation.removeItem as never, { tripId: 'trip-1', itemId: added.id ?? '' }, owner);
  assert.ok(removed);

  const sub = call(resolvers.Subscription.onTripChanged!.subscribe as never, { tripId: 'trip-1' }, owner);
  assert.ok(sub && typeof (sub as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function');
});

test('editor: puede modificar el itinerario', () => {
  const db = memoryDb();
  const editor = ctxFor(db, 'u-editor');
  const updated = call(
    resolvers.Mutation.updateItem as never,
    { tripId: 'trip-1', itemId: 'item-1', input: { title: 'Cena editada' } },
    editor,
  ) as { title: string };
  assert.equal(updated.title, 'Cena editada');
});
