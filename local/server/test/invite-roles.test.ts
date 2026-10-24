// Tests de M1: invitaciones con rol elegible (editor/viewer) en sendTripInvite,
// linea de rol en el email, y regresiones de permisos (FORBIDDEN_INVITE /
// FORBIDDEN_EDIT). Resend queda MOCKEADO: cero emails reales.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolvers, type Ctx, type PubSub } from '../src/resolvers.ts';
import { inviteEmailHtml, inviteEmailText } from '../src/email.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = fs.readFileSync(path.resolve(__dirname, '..', '..', 'db', 'schema.sql'), 'utf8');

function memoryDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO users (id, email, display_name, color) VALUES ('u-owner', 'o@x.com', 'Ana', '#6C3BFF')").run();
  db.prepare("INSERT INTO users (id, email, display_name, color) VALUES ('u-editor', 'e@x.com', 'Eli', '#F59E0B')").run();
  db.prepare("INSERT INTO users (id, email, display_name, color) VALUES ('u-viewer', 'v@x.com', 'Vic', '#0EA5E9')").run();
  db.prepare("INSERT INTO users (id, email, display_name, color) VALUES ('u-joiner', 'nuevo@x.com', 'Nuevo', '#10B981')").run();
  db.prepare(`
    INSERT INTO trips (id, name, destination_name, owner_id, start_date, end_date, total_budget, invite_code, created_at, updated_at)
    VALUES ('trip-1', 'Viaje', 'Toronto', 'u-owner', '2026-11-01', '2026-11-05', 500, 'ABC12345', '2026-10-12T00:00:00Z', '2026-10-12T00:00:00Z')
  `).run();
  db.prepare("INSERT INTO trip_members (trip_id, user_id, role) VALUES ('trip-1', 'u-owner', 'owner')").run();
  db.prepare("INSERT INTO trip_members (trip_id, user_id, role) VALUES ('trip-1', 'u-editor', 'editor')").run();
  db.prepare("INSERT INTO trip_members (trip_id, user_id, role) VALUES ('trip-1', 'u-viewer', 'viewer')").run();
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

function call(r: Record<string, unknown>, args: Record<string, unknown>, ctx: Ctx): unknown {
  return (r as unknown as (a: unknown, b: unknown, c: Ctx) => unknown)({}, args, ctx);
}

function errorCodeOfError(e: unknown): string | undefined {
  if (e instanceof Error && 'extensions' in e) {
    const ext = (e as { extensions?: { code?: string } }).extensions;
    return ext?.code;
  }
  return undefined;
}

async function errorCodeOfAsync(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn();
    return undefined;
  } catch (e) {
    return errorCodeOfError(e);
  }
}

function errorCodeOf(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    return errorCodeOfError(e);
  }
}

// Mock de Resend: cualquier POST a /emails devuelve un id valido.
async function withFakeResend<T>(fn: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = 're_test_abc123';
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ id: 'res-test' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
  }
}

function lastInvitationRole(db: DatabaseSync): string | undefined {
  const row = db
    .prepare("SELECT role FROM invitations WHERE trip_id = 'trip-1' ORDER BY rowid DESC LIMIT 1")
    .get() as { role: string } | undefined;
  return row?.role;
}

test('owner invita con role=editor -> invitations.role = editor', async () => {
  const db = memoryDb();
  const res = await withFakeResend(() =>
    call(
      resolvers.Mutation.sendTripInvite as never,
      { tripId: 'trip-1', email: 'Maria@X.com', role: 'editor' },
      ctxFor(db, 'u-owner'),
    ) as Promise<{ invitationId: string }>,
  );
  assert.ok(res.invitationId);
  assert.equal(lastInvitationRole(db), 'editor');
});

test('owner invita con role invalido -> INVALID_INVITE_ROLE (sin crear invitacion)', async () => {
  const db = memoryDb();
  const code = await errorCodeOfAsync(() =>
    call(
      resolvers.Mutation.sendTripInvite as never,
      { tripId: 'trip-1', email: 'x@y.com', role: 'admin' },
      ctxFor(db, 'u-owner'),
    ) as Promise<unknown>,
  );
  assert.equal(code, 'INVALID_INVITE_ROLE');
  const count = db.prepare('SELECT COUNT(*) AS n FROM invitations').get() as { n: number };
  assert.equal(count.n, 0);
});

test('owner invita SIN role -> invitations.role = viewer (default)', async () => {
  const db = memoryDb();
  await withFakeResend(() =>
    call(
      resolvers.Mutation.sendTripInvite as never,
      { tripId: 'trip-1', email: 'x@y.com' },
      ctxFor(db, 'u-owner'),
    ) as Promise<unknown>,
  );
  assert.equal(lastInvitationRole(db), 'viewer');
});

test('editor tambien puede invitar (rol editor emitido)', async () => {
  const db = memoryDb();
  await withFakeResend(() =>
    call(
      resolvers.Mutation.sendTripInvite as never,
      { tripId: 'trip-1', email: 'x@y.com', role: 'editor' },
      ctxFor(db, 'u-editor'),
    ) as Promise<unknown>,
  );
  assert.equal(lastInvitationRole(db), 'editor');
});

test('joinTripWithCode con invitacion editor -> trip_members.role = editor', () => {
  const db = memoryDb();
  db.prepare(
    "INSERT INTO invitations (id, trip_id, email, code, role, status, created_by) VALUES ('inv-1', 'trip-1', 'nuevo@x.com', 'abcdefghijkl', 'editor', 'pending', 'u-owner')",
  ).run();
  call(
    resolvers.Mutation.joinTripWithCode as never,
    { code: 'abcdefghijkl', email: 'nuevo@x.com' },
    ctxFor(db, 'u-joiner'),
  );
  const row = db
    .prepare("SELECT role FROM trip_members WHERE trip_id = 'trip-1' AND user_id = 'u-joiner'")
    .get() as { role: string } | undefined;
  assert.equal(row?.role, 'editor');
});

test('viewer NO puede invitar -> FORBIDDEN_INVITE', async () => {
  const db = memoryDb();
  const code = await errorCodeOfAsync(() =>
    call(
      resolvers.Mutation.sendTripInvite as never,
      { tripId: 'trip-1', email: 'x@y.com', role: 'viewer' },
      ctxFor(db, 'u-viewer'),
    ) as Promise<unknown>,
  );
  assert.equal(code, 'FORBIDDEN_INVITE');
});

test('viewer NO puede addItem -> FORBIDDEN_EDIT (regresion hotfix)', () => {
  const db = memoryDb();
  const code = errorCodeOf(() =>
    call(
      resolvers.Mutation.addItem as never,
      { tripId: 'trip-1', input: { title: 'X', category: 'food', cost: 1 } },
      ctxFor(db, 'u-viewer'),
    ),
  );
  assert.equal(code, 'FORBIDDEN_EDIT');
});

test('inviteEmailHtml: linea de rol (editor, viewer y default)', () => {
  const base = { tripName: 'Viaje', ownerName: 'Ana', code: 'ABCD1234EFGH', joinUrl: 'http://x/join' };
  assert.ok(inviteEmailHtml({ ...base, role: 'editor' }).includes('Rol: Editor'));
  const viewer = inviteEmailHtml({ ...base, role: 'viewer' });
  assert.ok(viewer.includes('Rol: Lector'));
  assert.ok(!viewer.includes('Rol: Editor'));
  assert.ok(inviteEmailHtml(base).includes('Rol: Lector'), 'sin role -> viewer por defecto');
});

test('inviteEmailText: linea de rol (editor, viewer y default)', () => {
  const base = { tripName: 'Viaje', ownerName: 'Ana', code: 'ABCD1234EFGH', joinUrl: 'http://x/join' };
  assert.ok(inviteEmailText({ ...base, role: 'editor' }).includes('Rol: Editor — puede editar el itinerario e invitar'));
  assert.ok(inviteEmailText({ ...base, role: 'viewer' }).includes('Rol: Lector — solo lectura'));
  assert.ok(inviteEmailText(base).includes('Rol: Lector — solo lectura'));
});
