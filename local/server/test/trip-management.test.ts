// Tests de gestion del viaje (M1): deleteTrip / leaveTrip / updateTripCover.
// Archivos (adjuntos + portadas) en tmp via TRIPLANNER_UPLOADS_OVERRIDE.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolvers, type Ctx, type PubSub } from '../src/resolvers.ts';
import { addAttachment } from '../src/attachments.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = fs.readFileSync(path.resolve(__dirname, '..', '..', 'db', 'schema.sql'), 'utf8');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'triplanner-tripmgmt-'));
process.env.TRIPLANNER_UPLOADS_OVERRIDE = tmpDir;

const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function memoryDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO users (id, email, display_name, color) VALUES ('u-owner', 'o@x.com', 'Ana', '#6C3BFF')").run();
  db.prepare("INSERT INTO users (id, email, display_name, color) VALUES ('u-member', 'm@x.com', 'Bea', '#0EA5E9')").run();
  db.prepare("INSERT INTO users (id, email, display_name, color) VALUES ('u-other', 'x@x.com', 'Cid', '#10B981')").run();
  db.prepare(`
    INSERT INTO trips (id, name, destination_name, owner_id, start_date, end_date, total_budget, invite_code, created_at, updated_at)
    VALUES ('trip-1', 'Viaje', 'Toronto', 'u-owner', '2026-11-01', '2026-11-05', 500, 'ABC12345', '2026-10-12T00:00:00Z', '2026-10-12T00:00:00Z')
  `).run();
  db.prepare("INSERT INTO trip_members (trip_id, user_id, role) VALUES ('trip-1', 'u-owner', 'owner')").run();
  db.prepare("INSERT INTO trip_members (trip_id, user_id, role) VALUES ('trip-1', 'u-member', 'viewer')").run();
  db.prepare(`
    INSERT INTO trip_items (id, trip_id, title, category, cost, day, "order")
    VALUES ('item-1', 'trip-1', 'Cena', 'food', 30, '2026-11-01', 0)
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
    return (e as { extensions?: { code?: string } }).extensions?.code;
  }
}

function count(db: DatabaseSync, sql: string): number {
  return (db.prepare(sql).get() as { c: number }).c;
}

// ---- deleteTrip ----

test('deleteTrip: owner borra trip + items + members + invitations + adjuntos del disco', () => {
  const db = memoryDb();
  const att = addAttachment(db, 'item-1', 'u-owner', {
    fileName: 'boleto.pdf',
    mimeType: 'image/png',
    dataUrl: PNG_DATA_URL,
  });
  const abs = path.join(tmpDir, 'attachments', 'item-1', path.basename(att.url));
  assert.ok(fs.existsSync(abs), 'adjunto creado en disco');

  const res = resolvers.Mutation.deleteTrip!(null, { tripId: 'trip-1' }, ctxFor(db, 'u-owner'));
  assert.equal(res, 'trip-1');
  assert.equal(count(db, "SELECT COUNT(*) AS c FROM trips"), 0);
  assert.equal(count(db, "SELECT COUNT(*) AS c FROM trip_items"), 0);
  assert.equal(count(db, "SELECT COUNT(*) AS c FROM trip_members"), 0);
  assert.equal(count(db, "SELECT COUNT(*) AS c FROM invitations"), 0);
  assert.equal(count(db, "SELECT COUNT(*) AS c FROM item_attachments"), 0);
  assert.ok(!fs.existsSync(abs), 'archivo de adjunto borrado del disco');
});

test('deleteTrip: miembro no-owner -> NOT_TRIP_OWNER', () => {
  const db = memoryDb();
  const code = errorCodeOf(() => resolvers.Mutation.deleteTrip!(null, { tripId: 'trip-1' }, ctxFor(db, 'u-member')));
  assert.equal(code, 'NOT_TRIP_OWNER');
  assert.equal(count(db, "SELECT COUNT(*) AS c FROM trips"), 1);
});

test('deleteTrip: no-miembro -> NOT_TRIP_MEMBER', () => {
  const db = memoryDb();
  const code = errorCodeOf(() => resolvers.Mutation.deleteTrip!(null, { tripId: 'trip-1' }, ctxFor(db, 'u-other')));
  assert.equal(code, 'NOT_TRIP_MEMBER');
  assert.equal(count(db, "SELECT COUNT(*) AS c FROM trips"), 1);
});

test('deleteTrip: trip inexistente -> TRIP_NOT_FOUND', () => {
  const db = memoryDb();
  const code = errorCodeOf(() => resolvers.Mutation.deleteTrip!(null, { tripId: 'nope' }, ctxFor(db, 'u-owner')));
  assert.equal(code, 'TRIP_NOT_FOUND');
});

// ---- leaveTrip ----

test('leaveTrip: miembro no-owner sale del viaje', () => {
  const db = memoryDb();
  const res = resolvers.Mutation.leaveTrip!(null, { tripId: 'trip-1' }, ctxFor(db, 'u-member')) as {
    id: string;
    ownerId: string;
  };
  assert.equal(res.id, 'trip-1');
  assert.equal(res.ownerId, 'u-owner');
  const row = db.prepare("SELECT 1 FROM trip_members WHERE trip_id = 'trip-1' AND user_id = 'u-member'").get();
  assert.equal(row, undefined, 'miembro fuera de trip_members');
});

test('leaveTrip: owner sin newOwnerId -> OWNER_MUST_TRANSFER', () => {
  const db = memoryDb();
  const code = errorCodeOf(() => resolvers.Mutation.leaveTrip!(null, { tripId: 'trip-1' }, ctxFor(db, 'u-owner')));
  assert.equal(code, 'OWNER_MUST_TRANSFER');
});

test('leaveTrip: owner transfiere -> owner_id cambia y saliente fuera', () => {
  const db = memoryDb();
  const res = resolvers.Mutation.leaveTrip!(null, { tripId: 'trip-1', newOwnerId: 'u-member' }, ctxFor(db, 'u-owner')) as {
    ownerId: string;
  };
  assert.equal(res.ownerId, 'u-member');
  const trip = db.prepare("SELECT owner_id FROM trips WHERE id = 'trip-1'").get() as { owner_id: string };
  assert.equal(trip.owner_id, 'u-member');
  const role = db.prepare("SELECT role FROM trip_members WHERE trip_id = 'trip-1' AND user_id = 'u-member'").get() as { role: string };
  assert.equal(role.role, 'owner', 'nuevo owner con rol owner en trip_members');
  const gone = db.prepare("SELECT 1 FROM trip_members WHERE trip_id = 'trip-1' AND user_id = 'u-owner'").get();
  assert.equal(gone, undefined, 'owner saliente fuera de trip_members');
});

test('leaveTrip: owner sin otros miembros -> NO_MEMBERS_TO_TRANSFER', () => {
  const db = memoryDb();
  db.prepare(`
    INSERT INTO trips (id, name, destination_name, owner_id, start_date, end_date, total_budget, invite_code, created_at, updated_at)
    VALUES ('solo', 'Solo', 'Paris', 'u-other', '2026-12-01', '2026-12-03', 0, 'SOLOCODE', '2026-10-12T00:00:00Z', '2026-10-12T00:00:00Z')
  `).run();
  db.prepare("INSERT INTO trip_members (trip_id, user_id, role) VALUES ('solo', 'u-other', 'owner')").run();
  const code = errorCodeOf(() =>
    resolvers.Mutation.leaveTrip!(null, { tripId: 'solo', newOwnerId: 'u-owner' }, ctxFor(db, 'u-other'))
  );
  assert.equal(code, 'NO_MEMBERS_TO_TRANSFER');
});

test('leaveTrip: target no-miembro -> INVALID_TRANSFER_TARGET', () => {
  const db = memoryDb();
  const code = errorCodeOf(() =>
    resolvers.Mutation.leaveTrip!(null, { tripId: 'trip-1', newOwnerId: 'u-other' }, ctxFor(db, 'u-owner'))
  );
  assert.equal(code, 'INVALID_TRANSFER_TARGET');
});

test('leaveTrip: no-miembro -> NOT_TRIP_MEMBER', () => {
  const db = memoryDb();
  const code = errorCodeOf(() => resolvers.Mutation.leaveTrip!(null, { tripId: 'trip-1' }, ctxFor(db, 'u-other')));
  assert.equal(code, 'NOT_TRIP_MEMBER');
});

// ---- updateTripCover ----

test('updateTripCover: preset valido + limpia foto anterior', () => {
  const db = memoryDb();
  const coverDir = path.join(tmpDir, 'covers', 'trip-1');
  resolvers.Mutation.updateTripCover!(null, { tripId: 'trip-1', input: { coverPhotoDataUrl: PNG_DATA_URL } }, ctxFor(db, 'u-owner'));
  assert.equal(fs.existsSync(coverDir) ? fs.readdirSync(coverDir).length : 0, 1, 'foto previa en disco');

  const res = resolvers.Mutation.updateTripCover!(null, { tripId: 'trip-1', input: { coverPreset: 'ocean-dawn' } }, ctxFor(db, 'u-owner')) as {
    coverPreset: string | null;
    coverPhotoUrl: string | null;
  };
  assert.equal(res.coverPreset, 'ocean-dawn');
  assert.equal(res.coverPhotoUrl, null);
  assert.equal(fs.existsSync(coverDir) ? fs.readdirSync(coverDir).length : 0, 0, 'foto anterior borrada');
});

test('updateTripCover: preset invalido -> INVALID_COVER_PRESET', () => {
  const db = memoryDb();
  const code = errorCodeOf(() =>
    resolvers.Mutation.updateTripCover!(null, { tripId: 'trip-1', input: { coverPreset: 'nope' } }, ctxFor(db, 'u-owner'))
  );
  assert.equal(code, 'INVALID_COVER_PRESET');
});

test('updateTripCover: foto ok -> archivo creado + URL correcta', () => {
  const db = memoryDb();
  const res = resolvers.Mutation.updateTripCover!(null, { tripId: 'trip-1', input: { coverPhotoDataUrl: PNG_DATA_URL } }, ctxFor(db, 'u-owner')) as {
    coverPreset: string | null;
    coverPhotoUrl: string | null;
  };
  assert.equal(res.coverPreset, null);
  assert.match(res.coverPhotoUrl ?? '', /^\/uploads\/covers\/trip-1\/[0-9a-f-]+\.png$/);
  const abs = path.join(tmpDir, 'covers', 'trip-1', path.basename(res.coverPhotoUrl!));
  assert.ok(fs.existsSync(abs), 'archivo de portada en disco');
});

test('updateTripCover: foto mime invalido -> INVALID_IMAGE', () => {
  const db = memoryDb();
  const code = errorCodeOf(() =>
    resolvers.Mutation.updateTripCover!(
      null,
      { tripId: 'trip-1', input: { coverPhotoDataUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' } },
      ctxFor(db, 'u-owner')
    )
  );
  assert.equal(code, 'INVALID_IMAGE');
});

test('updateTripCover: removePhoto borra el archivo', () => {
  const db = memoryDb();
  const res = resolvers.Mutation.updateTripCover!(null, { tripId: 'trip-1', input: { coverPhotoDataUrl: PNG_DATA_URL } }, ctxFor(db, 'u-owner')) as {
    coverPhotoUrl: string | null;
  };
  const abs = path.join(tmpDir, 'covers', 'trip-1', path.basename(res.coverPhotoUrl!));
  assert.ok(fs.existsSync(abs));

  const after = resolvers.Mutation.updateTripCover!(null, { tripId: 'trip-1', input: { removePhoto: true } }, ctxFor(db, 'u-owner')) as {
    coverPhotoUrl: string | null;
  };
  assert.equal(after.coverPhotoUrl, null);
  assert.ok(!fs.existsSync(abs), 'foto borrada del disco');
});

test('updateTripCover: no-owner -> NOT_TRIP_OWNER', () => {
  const db = memoryDb();
  const code = errorCodeOf(() =>
    resolvers.Mutation.updateTripCover!(null, { tripId: 'trip-1', input: { coverPreset: 'ocean-dawn' } }, ctxFor(db, 'u-member'))
  );
  assert.equal(code, 'NOT_TRIP_OWNER');
});
