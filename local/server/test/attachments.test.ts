// Tests de adjuntos (boletos) — archivos en tmp via TRIPLANNER_UPLOADS_OVERRIDE.

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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'triplanner-attachments-'));
process.env.TRIPLANNER_UPLOADS_OVERRIDE = tmpDir;
const useTmp = () => {
  process.env.TRIPLANNER_UPLOADS_OVERRIDE = tmpDir;
};

const { addAttachment, removeAttachment, listAttachmentsByItem, findItemTrip, isTripMember } =
  await import('../src/attachments.ts');

function memoryDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO users (id, email, display_name, color) VALUES ('u1', 'a@b.com', 'Ana', '#6C3BFF')").run();
  db.prepare("INSERT INTO users (id, email, display_name, color) VALUES ('u2', 'c@d.com', 'Bea', '#0EA5E9')").run();
  db.prepare(`
    INSERT INTO trips (id, name, destination_name, owner_id, start_date, end_date, total_budget, invite_code, created_at, updated_at)
    VALUES ('trip-1', 'Viaje', 'Toronto', 'u1', '2026-11-01', '2026-11-05', 500, 'ABC12345', '2026-10-12T00:00:00Z', '2026-10-12T00:00:00Z')
  `).run();
  db.prepare("INSERT INTO trip_members (trip_id, user_id, role) VALUES ('trip-1', 'u1', 'owner')").run();
  db.prepare("INSERT INTO trip_members (trip_id, user_id, role) VALUES ('trip-1', 'u2', 'viewer')").run();
  db.prepare(`
    INSERT INTO trip_items (id, trip_id, title, category, cost, day, "order")
    VALUES ('item-1', 'trip-1', 'Cena', 'food', 30, '2026-11-01', 0)
  `).run();
  return db;
}

const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
// PDF minimo valido
const PDF_BASE64 =
  'JVBERi0xLjQKMSAwIG9iago8PC9UeXBlIC9DYXRhbG9nIC9QYWdlcyAyIDAgUj4+CmVuZG9iago0IDAgb2JqCjw8L1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhPj4KZW5kb2JqCjIgMCBvYmoKPDwvVHlwZSAvUGFnZXMgL0tpZHMgWzMgMCBSXSAvQ291bnQgMT4+CmVuZG9iagozIDAgb2JqCjw8L1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvUmVzb3VyY2VzIDw8L0ZvbnQgPDwvRjEgNCAwIFI+PiAvUHJvY1NldCA2IDAgUj4+IC9Db250ZW50cyA1IDAgUj4+CmVuZG9iago1IDAgb2JqCjw8L0xlbmd0aCA0ND4+CnN0cmVhbQpCVAovRjEgMjQgVGYKxMjAgNzI4IFRkCihUcmlwbGFubmVyIFRpY2tldCBUZXN0KSBUagpFVAplbmRzdHJlYW0KZW5kb2JqCjYgMCBvYmoKWy9QREYgL1RleHRdCmVuZG9iagp4cmVmCjAgNwoKdHJhaWxlcgo8PC9Sb290IDEgMCBSIC9TaXplIDc+PgpzdGFydHhyZWYKMTY5CiUlRU9G';
const PDF_DATA_URL = `data:application/pdf;base64,${PDF_BASE64}`;

test('addAttachment: PDF valido -> fila + archivo en disco', () => {
  useTmp();
  const db = memoryDb();
  const att = addAttachment(db, 'item-1', 'u1', {
    fileName: 'boleto-avion.pdf',
    mimeType: 'application/pdf',
    dataUrl: PDF_DATA_URL,
  });
  assert.equal(att.fileName, 'boleto-avion.pdf');
  assert.equal(att.mimeType, 'application/pdf');
  assert.ok(att.sizeBytes > 0);
  assert.match(att.url, /^\/uploads\/attachments\/item-1\/[0-9a-f-]+\.pdf$/);
  const abs = path.join(tmpDir, 'attachments', 'item-1', path.basename(att.url));
  assert.ok(fs.existsSync(abs), 'archivo pdf en disco');
  assert.ok(fs.readFileSync(abs).length > 0);
});

test('addAttachment: imagen png -> ext .png', () => {
  useTmp();
  const db = memoryDb();
  const att = addAttachment(db, 'item-1', 'u1', {
    fileName: 'screenshot.png',
    mimeType: 'image/png',
    dataUrl: PNG_DATA_URL,
  });
  assert.match(att.url, /\.png$/);
});

test('addAttachment: formatos/tamano invalidos rechazados', () => {
  useTmp();
  const db = memoryDb();
  assert.throws(
    () =>
      addAttachment(db, 'item-1', 'u1', {
        fileName: 'x.gif',
        mimeType: 'image/gif',
        dataUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
      }),
    /Formato no permitido/
  );
  // sin efectos: ningun archivo nuevo del item tras los rechazos
  const itemDir = path.join(tmpDir, 'attachments', 'item-1');
  const before = fs.existsSync(itemDir) ? fs.readdirSync(itemDir).length : 0;
  assert.throws(
    () =>
      addAttachment(db, 'item-1', 'u1', {
        fileName: 'x.pdf',
        mimeType: 'application/pdf',
        dataUrl: `data:application/pdf;base64,${Buffer.alloc(11 * 1024 * 1024).toString('base64')}`,
      }),
    /10MB/
  );
  const after = fs.existsSync(itemDir) ? fs.readdirSync(itemDir).length : 0;
  assert.equal(after, before, 'los rechazos no deben escribir archivos');
});

test('listAttachmentsByItem: devuelve en orden y con url relativa', () => {
  useTmp();
  const db = memoryDb();
  addAttachment(db, 'item-1', 'u1', { fileName: 'a.png', mimeType: 'image/png', dataUrl: PNG_DATA_URL });
  addAttachment(db, 'item-1', 'u1', { fileName: 'b.pdf', mimeType: 'application/pdf', dataUrl: PDF_DATA_URL });
  const list = listAttachmentsByItem(db, 'item-1');
  assert.equal(list.length, 2);
  assert.equal(list[0]?.fileName, 'a.png');
  assert.equal(list[1]?.fileName, 'b.pdf');
  assert.ok(list[0]?.url.startsWith('/uploads/attachments/'));
});

test('removeAttachment: borra fila y archivo', () => {
  useTmp();
  const db = memoryDb();
  const att = addAttachment(db, 'item-1', 'u1', { fileName: 'a.pdf', mimeType: 'application/pdf', dataUrl: PDF_DATA_URL });
  const abs = path.join(tmpDir, 'attachments', 'item-1', path.basename(att.url));
  assert.ok(fs.existsSync(abs));
  const removed = removeAttachment(db, att.id);
  assert.ok(removed);
  assert.ok(!fs.existsSync(abs), 'archivo borrado del disco');
  assert.equal(listAttachmentsByItem(db, 'item-1').length, 0);
});

test('membresia: findItemTrip + isTripMember', () => {
  useTmp();
  const db = memoryDb();
  assert.equal(findItemTrip(db, 'item-1'), 'trip-1');
  assert.equal(findItemTrip(db, 'no-existe'), null);
  assert.ok(isTripMember(db, 'trip-1', 'u2'));
  assert.ok(!isTripMember(db, 'trip-1', 'u3'));
});
