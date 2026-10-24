// Tests del perfil editable (nombre + foto) sin red: escritura de archivo en tmp.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(__dirname, '..', '..', 'db', 'schema.sql');
const SCHEMA = fs.readFileSync(SCHEMA_PATH, 'utf8');

// Redirigir uploads a un dir temporal para no tocar el repo.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'triplanner-profile-'));
process.env.TRIPLANNER_UPLOADS_OVERRIDE = tmpDir;
const useTmp = () => {
  process.env.TRIPLANNER_UPLOADS_OVERRIDE = tmpDir;
};

const { updateMyProfile, validateDisplayName } = await import('../src/profile.ts');

function memoryDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO users (id, email, display_name, color) VALUES ('u1', 'a@b.com', 'Ana', '#6C3BFF')").run();
  return db;
}

// PNG 1x1 valido (base64)
const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_DATA_URL = `data:image/png;base64,${PNG_1PX}`;

test('validateDisplayName: limites 1-40', () => {
  useTmp();
  assert.equal(validateDisplayName('  Marco  '), 'Marco');
  assert.throws(() => validateDisplayName('   '), /no puede estar vacío/);
  assert.throws(() => validateDisplayName('x'.repeat(41)), /40 caracteres/);
});

test('updateMyProfile: solo nombre (sin foto)', () => {
  useTmp();
  const db = memoryDb();
  const row = updateMyProfile(db, 'u1', { displayName: 'Marco2' });
  assert.equal(row.display_name, 'Marco2');
  assert.equal(row.avatar_url, null);
  assert.equal(row.email, 'a@b.com', 'email intocable');
});

test('updateMyProfile: foto valida -> archivo + avatar_url relativo', () => {
  useTmp();
  const db = memoryDb();
  const row = updateMyProfile(db, 'u1', { displayName: 'Ana', avatarDataUrl: PNG_DATA_URL });
  assert.ok(row.avatar_url, 'avatar_url debe quedar seteado');
  assert.match(row.avatar_url!, /^\/uploads\/avatars\/u1\.png$/);
  const file = path.join(tmpDir, 'avatars', 'u1.png');
  assert.ok(fs.existsSync(file), 'el archivo debe existir');
  const buf = fs.readFileSync(file);
  assert.ok(buf.length > 0);
  assert.deepEqual([...buf.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], 'firma PNG');
});

test('updateMyProfile: foto no permitida (mime/size/data invalida)', () => {
  useTmp();
  const db = memoryDb();
  db.prepare("INSERT INTO users (id, email, display_name, color) VALUES ('u2', 'b@b.com', 'Bea', '#000000')").run();
  // gif no permitido
  assert.throws(
    () => updateMyProfile(db, 'u2', { displayName: 'B', avatarDataUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }),
    /Formato no permitido/
  );
  // data URL invalida
  assert.throws(
    () => updateMyProfile(db, 'u2', { displayName: 'B', avatarDataUrl: 'hola' }),
    /base64 válida/
  );
  // mas de 5MB (7MB en base64 ≈ 5.25MB decodificados)
  const big = `data:image/png;base64,${'A'.repeat(7 * 1024 * 1024)}`;
  assert.throws(() => updateMyProfile(db, 'u2', { displayName: 'B', avatarDataUrl: big }), /5MB/);
  // sin efectos secundarios: ningun archivo u2.* debe quedar
  const avDir = path.join(tmpDir, 'avatars');
  const leftovers = fs.existsSync(avDir) ? fs.readdirSync(avDir).filter((n) => n.startsWith('u2.')) : [];
  assert.equal(leftovers.length, 0);
});

test('updateMyProfile: avatarRemove borra archivo y pone null', () => {
  useTmp();
  const db = memoryDb();
  updateMyProfile(db, 'u1', { displayName: 'Ana', avatarDataUrl: PNG_DATA_URL });
  const file = path.join(tmpDir, 'avatars', 'u1.png');
  assert.ok(fs.existsSync(file));
  const row = updateMyProfile(db, 'u1', { displayName: 'Ana', avatarRemove: true });
  assert.equal(row.avatar_url, null);
  assert.ok(!fs.existsSync(file), 'el archivo debe borrarse');
});

test('updateMyProfile: foto nueva reemplaza archivos previos (cambio de ext)', () => {
  useTmp();
  const db = memoryDb();
  updateMyProfile(db, 'u1', { displayName: 'A', avatarDataUrl: PNG_DATA_URL });
  const oldFile = path.join(tmpDir, 'avatars', 'u1.png');
  assert.ok(fs.existsSync(oldFile));
  // jpg 1x1 min
  const jpg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAAAAAAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
  updateMyProfile(db, 'u1', { displayName: 'A', avatarDataUrl: jpg });
  assert.ok(!fs.existsSync(oldFile), 'png previo debe borrarse');
  assert.ok(fs.existsSync(path.join(tmpDir, 'avatars', 'u1.jpg')));
});
