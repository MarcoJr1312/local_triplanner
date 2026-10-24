// Tests de intereses del usuario (M1): normalizacion, reemplazo, tope, UNIQUE,
// aislamiento por usuario, sync best-effort al agente y contexto del viaje.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createServer, type Server } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  normalizeInterests,
  listUserInterests,
  replaceUserInterests,
  MAX_INTERESTS,
} from '../src/interests.ts';
import { resolvers, type Ctx, type PubSub } from '../src/resolvers.ts';
import { createInternalRouter } from '../src/internal.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = fs.readFileSync(path.resolve(__dirname, '..', '..', 'db', 'schema.sql'), 'utf8');

const TOKEN = 'test-internal-token';

function memoryDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO users (id, email, display_name, color) VALUES ('u1', 'ana@test.com', 'Ana', '#111111')").run();
  db.prepare("INSERT INTO users (id, email, display_name, color) VALUES ('u2', 'bob@test.com', 'Bob', '#222222')").run();
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

test('normalizeInterests: trim + lowercase + dedupe preservando orden', () => {
  assert.deepEqual(normalizeInterests(['  Food ', 'food', 'MUSEUMS', '', '  ', 'Nature']), [
    'food',
    'museums',
    'nature',
  ]);
});

test('getMyInterests: vacio para usuario sin intereses', () => {
  const db = memoryDb();
  assert.deepEqual(listUserInterests(db, 'u1'), []);
  assert.deepEqual(
    resolvers.Query.getMyInterests!(null, {}, ctxFor(db, 'u1')) as string[],
    [],
  );
});

test('setMyInterests: guarda normalizado y source=custom', async () => {
  const db = memoryDb();
  const calls: { userId: string; terms: readonly string[] }[] = [];
  const result = await replaceUserInterests(db, 'u1', [' Food ', 'food', 'MUSEUMS'], async (userId, terms) => {
    calls.push({ userId, terms });
  });

  assert.deepEqual(result, ['food', 'museums']);
  assert.deepEqual(listUserInterests(db, 'u1'), ['food', 'museums']);
  assert.deepEqual(calls, [{ userId: 'u1', terms: ['food', 'museums'] }]);

  const rows = db
    .prepare('SELECT term, source FROM user_interests WHERE user_id = ? ORDER BY rowid ASC')
    .all('u1') as { term: string; source: string }[];
  assert.deepEqual(rows.map((r) => r.term), ['food', 'museums']);
  assert.ok(rows.every((r) => r.source === 'custom'));
});

test('setMyInterests: REEMPLAZA la lista (quita terminos viejos)', async () => {
  const db = memoryDb();
  await replaceUserInterests(db, 'u1', ['food', 'museums'], async () => {});
  const result = await replaceUserInterests(db, 'u1', ['nature'], async () => {});

  assert.deepEqual(result, ['nature']);
  assert.deepEqual(listUserInterests(db, 'u1'), ['nature']);
  const count = db.prepare('SELECT COUNT(*) AS c FROM user_interests WHERE user_id = ?').get('u1') as {
    c: number;
  };
  assert.equal(count.c, 1);
});

test(`setMyInterests: maximo ${MAX_INTERESTS} terminos tras normalizar`, async () => {
  const db = memoryDb();
  const terms = Array.from({ length: MAX_INTERESTS + 5 }, (_, i) => ` Term ${i} `);
  const result = await replaceUserInterests(db, 'u1', terms, async () => {});

  assert.equal(result.length, MAX_INTERESTS);
  assert.deepEqual(
    result,
    Array.from({ length: MAX_INTERESTS }, (_, i) => `term ${i}`),
  );
  assert.equal(listUserInterests(db, 'u1').length, MAX_INTERESTS);
});

test('UNIQUE(user_id, term) respetado por la DB', () => {
  const db = memoryDb();
  db.prepare("INSERT INTO user_interests (id, user_id, term) VALUES ('a', 'u1', 'food')").run();
  assert.throws(
    () => db.prepare("INSERT INTO user_interests (id, user_id, term) VALUES ('b', 'u1', 'food')").run(),
    /UNIQUE/i,
  );
  // El mismo termino si puede existir para otro usuario.
  db.prepare("INSERT INTO user_interests (id, user_id, term) VALUES ('c', 'u2', 'food')").run();
});

test('aislamiento: otro usuario no ve mis intereses', async () => {
  const db = memoryDb();
  await replaceUserInterests(db, 'u1', ['food', 'museums'], async () => {});
  assert.deepEqual(listUserInterests(db, 'u2'), []);
});

test('auth: sin identidad o usuario inexistente -> AUTH_REQUIRED', () => {
  const db = memoryDb();
  assert.equal(
    errorCodeOf(() => resolvers.Query.getMyInterests!(null, {}, ctxFor(db, ''))),
    'AUTH_REQUIRED',
  );
  assert.equal(
    errorCodeOf(() => resolvers.Query.getMyInterests!(null, {}, ctxFor(db, 'ghost'))),
    'AUTH_REQUIRED',
  );
  assert.equal(
    errorCodeOf(() => resolvers.Mutation.setMyInterests!(null, { terms: ['food'] }, ctxFor(db, ''))),
    'AUTH_REQUIRED',
  );
});

test('resolver setMyInterests usa ctx.syncInterests (inyectado)', async () => {
  const db = memoryDb();
  const calls: { userId: string; terms: readonly string[] }[] = [];
  const ctx: Ctx = {
    ...ctxFor(db, 'u1'),
    syncInterests: async (userId, terms) => {
      calls.push({ userId, terms });
    },
  };
  const result = (await resolvers.Mutation.setMyInterests!(
    null,
    { terms: [' Food ', 'MUSEUMS', 'food'] },
    ctx,
  )) as string[];

  assert.deepEqual(result, ['food', 'museums']);
  assert.deepEqual(calls, [{ userId: 'u1', terms: ['food', 'museums'] }]);
  assert.deepEqual(
    resolvers.Query.getMyInterests!(null, {}, ctx) as string[],
    ['food', 'museums'],
  );
});

test('sync fallido NO rompe el guardado', async () => {
  const db = memoryDb();
  const result = await replaceUserInterests(db, 'u1', ['food'], async () => {
    throw new Error('agente caido');
  });

  assert.deepEqual(result, ['food']);
  assert.deepEqual(listUserInterests(db, 'u1'), ['food']);
});

test('trip-context incluye interests[] del usuario que pide sugerencias', async () => {
  const db = memoryDb();
  db.prepare(
    "INSERT INTO trips (id, name, destination_name, start_date, end_date, total_budget, owner_id, invite_code) VALUES ('trip-1', 'Viaje', 'Toronto', '2026-11-01', '2026-11-04', 100, 'u1', 'CODE123')",
  ).run();
  db.prepare("INSERT INTO trip_members (trip_id, user_id, role) VALUES ('trip-1', 'u1', 'owner')").run();
  db.prepare("INSERT INTO trip_members (trip_id, user_id, role) VALUES ('trip-1', 'u2', 'viewer')").run();
  await replaceUserInterests(db, 'u1', ['food', 'museums'], async () => {});
  await replaceUserInterests(db, 'u2', ['nature'], async () => {});

  const router = createInternalRouter({ db, hasdata: null, internalToken: TOKEN });
  const server: Server = createServer((req, res) => {
    void router(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const base = `http://127.0.0.1:${port}`;

  try {
    const r = await fetch(`${base}/internal/trip-context/trip-1`, {
      headers: { 'x-internal-token': TOKEN, 'x-user-id': 'u1' },
    });
    assert.equal(r.status, 200);
    const body = (await r.json()) as { userId: string; interests: string[] };
    assert.equal(body.userId, 'u1');
    assert.deepEqual(body.interests, ['food', 'museums']);

    const r2 = await fetch(`${base}/internal/trip-context/trip-1`, {
      headers: { 'x-internal-token': TOKEN, 'x-user-id': 'u2' },
    });
    const body2 = (await r2.json()) as { interests: string[] };
    assert.deepEqual(body2.interests, ['nature'], 'los intereses son del usuario del header');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
});
