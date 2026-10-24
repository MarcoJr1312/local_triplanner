// Tests de i18n backend: users.language (default 'es', validacion, persistencia)
// + extensions.code estable en los GraphQLError representativos.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { updateMyProfile, isValidLanguage } from '../src/profile.ts';
import { toProfile } from '../src/auth.ts';
import { resolvers, type Ctx, type PubSub } from '../src/resolvers.ts';
import { migrateUserLanguage } from '../src/db.ts';
import type { UserRow } from '../src/schema-types.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = fs.readFileSync(path.resolve(__dirname, '..', '..', 'db', 'schema.sql'), 'utf8');

// Redirigir uploads a tmp (updateMyProfile puede tocar disco).
process.env.TRIPLANNER_UPLOADS_OVERRIDE = fs.mkdtempSync(path.join(os.tmpdir(), 'triplanner-i18n-'));

function memoryDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO users (id, email, display_name, color) VALUES ('u1', 'a@b.com', 'Ana', '#6C3BFF')").run();
  return db;
}

function ctxFor(db: DatabaseSync): Ctx {
  const pubsub: PubSub = {
    publish() {
      /* noop en tests */
    },
    subscribe() {
      return (async function* () {
        /* sin eventos */
      })();
    },
  };
  return { db, currentUserId: 'u1', hasdata: null, pubsub };
}

// Ejecuta fn (sync o async) y devuelve el extensions.code del error lanzado.
async function errorCodeOf(fn: () => unknown): Promise<string | undefined> {
  try {
    await fn();
    return undefined;
  } catch (e) {
    return (e as { extensions?: { code?: string } }).extensions?.code;
  }
}

test('migración users.language: idempotente sobre tabla legacy (ALTER TABLE)', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(
    'CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, color TEXT, avatar_url TEXT)'
  );
  db.prepare("INSERT INTO users (id, email, display_name) VALUES ('u9', 'z@z.com', 'Zoe')").run();
  migrateUserLanguage(db);
  migrateUserLanguage(db); // segunda pasada no debe fallar
  const cols = db.prepare("SELECT name FROM pragma_table_info('users')").all() as { name: string }[];
  assert.ok(cols.some((c) => c.name === 'language'), 'columna language creada');
  const row = db.prepare("SELECT language FROM users WHERE id = 'u9'").get() as { language: string };
  assert.equal(row.language, 'es', 'las filas existentes heredan el default');
});

test("users.language: default 'es' en un usuario creado", () => {
  const db = memoryDb();
  const row = db.prepare("SELECT * FROM users WHERE id = 'u1'").get() as unknown as UserRow;
  assert.equal(row.language, 'es');
  assert.equal(toProfile(row).language, 'es');
});

test('isValidLanguage: solo es|en', () => {
  assert.ok(isValidLanguage('es'));
  assert.ok(isValidLanguage('en'));
  assert.ok(!isValidLanguage('fr'));
  assert.ok(!isValidLanguage(''));
  assert.ok(!isValidLanguage(null));
  assert.ok(!isValidLanguage(2));
});

test("updateMyProfile: language 'en' persiste y se conserva si no se reenvia", () => {
  const db = memoryDb();
  const saved = updateMyProfile(db, 'u1', { displayName: 'Ana', language: 'en' });
  assert.equal(saved.language, 'en');
  const again = updateMyProfile(db, 'u1', { displayName: 'Ana2' });
  assert.equal(again.language, 'en', 'no reenviar language conserva el valor');
  assert.equal(again.display_name, 'Ana2');
});

test("updateMyProfile: omite language -> mantiene el default 'es'", () => {
  const db = memoryDb();
  const row = updateMyProfile(db, 'u1', { displayName: 'Ana' });
  assert.equal(row.language, 'es');
});

test('updateMyProfile (resolver): language inválido -> INVALID_LANGUAGE', async () => {
  const db = memoryDb();
  const code = await errorCodeOf(() =>
    resolvers.Mutation.updateMyProfile!(null, { input: { displayName: 'Ana', language: 'fr' } }, ctxFor(db))
  );
  assert.equal(code, 'INVALID_LANGUAGE');
  // no debe haber persistido nada
  const row = db.prepare("SELECT language FROM users WHERE id = 'u1'").get() as { language: string };
  assert.equal(row.language, 'es');
});

test('updateMyProfile (resolver): language en -> UserProfile.language', async () => {
  const db = memoryDb();
  const profile = (await resolvers.Mutation.updateMyProfile!(
    null,
    { input: { displayName: 'Ana', language: 'en' } },
    ctxFor(db)
  )) as { language?: string | null };
  assert.equal(profile.language, 'en');
});

test('extensions.code: errores representativos devuelven su código', async () => {
  const db = memoryDb();
  // código de invitación inválido (sync) -> INVALID_INVITE_CODE
  assert.equal(
    await errorCodeOf(() =>
      resolvers.Mutation.joinTripWithCode!(null, { code: 'malo', email: 'a@b.com' }, ctxFor(db))
    ),
    'INVALID_INVITE_CODE'
  );
  // adjunto a item inexistente -> ITEM_NOT_FOUND
  assert.equal(
    await errorCodeOf(() =>
      resolvers.Mutation.addItemAttachment!(
        null,
        {
          itemId: 'no-existe',
          input: { fileName: 'x.pdf', mimeType: 'application/pdf', dataUrl: 'data:application/pdf;base64,AA==' },
        },
        ctxFor(db)
      )
    ),
    'ITEM_NOT_FOUND'
  );
  // favorito a lugar inexistente -> FAVORITE_SAVE_FAILED
  assert.equal(
    await errorCodeOf(() =>
      resolvers.Mutation.favoriteLocation!(null, { locationId: 'no-existe', favorite: true }, ctxFor(db))
    ),
    'FAVORITE_SAVE_FAILED'
  );
  // email inválido en sendTripInvite (async) -> INVALID_EMAIL
  assert.equal(
    await errorCodeOf(() =>
      resolvers.Mutation.sendTripInvite!(null, { tripId: 'trip-x', email: 'no-es-email' }, ctxFor(db))
    ),
    'INVALID_EMAIL'
  );
});
