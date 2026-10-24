// Tests de visibilidad POR ARCHIVO (M1): viewers, listado filtrado, URLs
// firmadas HMAC, serving con 403 sin firma/vencida y delete solo uploader.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Ctx, PubSub } from '../src/resolvers.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = fs.readFileSync(path.resolve(__dirname, '..', '..', 'db', 'schema.sql'), 'utf8');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'triplanner-attachment-visibility-'));
process.env.TRIPLANNER_UPLOADS_OVERRIDE = tmpDir;
const useTmp = () => {
  process.env.TRIPLANNER_UPLOADS_OVERRIDE = tmpDir;
};

const { resolvers } = await import('../src/resolvers.ts');
const {
  addAttachment,
  canViewAttachment,
  findAttachment,
  getAttachmentForUser,
  listAttachmentsByItem,
} = await import('../src/attachments.ts');
const {
  ATTACHMENT_URL_TTL_SECONDS,
  signAttachmentUrl,
  verifyUploadSignature,
} = await import('../src/attachment-tokens.ts');
const { serveUploads } = await import('../src/uploads.ts');

const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function memoryDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  for (const [id, email, name] of [
    ['u-owner', 'owner@x.com', 'Olivia Owner'],
    ['u-editor', 'editor@x.com', 'Eli Editor'],
    ['u-viewer', 'viewer@x.com', 'Vic Viewer'],
    ['u-other', 'other@x.com', 'Otto Other'],
  ] as const) {
    db.prepare('INSERT INTO users (id, email, display_name, color) VALUES (?, ?, ?, ?)').run(
      id,
      email,
      name,
      '#111'
    );
  }
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

interface UploadResult {
  id: string;
  url: string;
  visibility: 'private' | 'shared';
  viewerIds: string[] | null;
  uploadedByName: string | null;
}

function upload(
  db: DatabaseSync,
  userId: string,
  viewerIds?: string[],
  fileName = 'boleto.png'
): UploadResult {
  return call(
    resolvers.Mutation.addItemAttachment as never,
    { tripId: 'trip-1', itemId: 'item-1', input: { fileName, mimeType: 'image/png', dataUrl: PNG_DATA_URL }, viewerIds },
    ctxFor(db, userId)
  ) as UploadResult;
}

// Mock minimo de ServerResponse para probar serveUploads sin abrir sockets.
class FakeResponse {
  statusCode = 0;
  headers: Record<string, string> = {};
  body: unknown = null;
  writeHead(code: number, headers?: Record<string, string>) {
    this.statusCode = code;
    if (headers) this.headers = headers;
    return this;
  }
  end(chunk?: unknown) {
    this.body = chunk ?? null;
    return this;
  }
}

function serve(url: string): { status: number; headers: Record<string, string>; body: unknown } {
  const res = new FakeResponse();
  const req = { url } as IncomingMessage;
  serveUploads(req, res as unknown as ServerResponse);
  return { status: res.statusCode, headers: res.headers, body: res.body };
}

test('uploader ve su adjunto privado; otros miembros (incluido el owner) NO', () => {
  useTmp();
  const db = memoryDb();
  const att = upload(db, 'u-editor', []);
  assert.equal(att.visibility, 'private');
  assert.deepEqual(att.viewerIds, []);
  assert.equal(att.uploadedByName, 'Eli Editor');
  assert.equal(canViewAttachment(db, att.id, 'u-editor'), true);
  assert.equal(listAttachmentsByItem(db, 'item-1', 'u-editor').length, 1);
  // El owner NO tiene acceso automatico a archivos de un editor.
  assert.equal(canViewAttachment(db, att.id, 'u-owner'), false);
  assert.equal(listAttachmentsByItem(db, 'item-1', 'u-owner').length, 0);
  assert.equal(listAttachmentsByItem(db, 'item-1', 'u-viewer').length, 0);
  assert.equal(getAttachmentForUser(db, att.id, 'u-owner'), null);
});

test('viewer otorgado ve; viewerIds solo se expone al uploader', () => {
  useTmp();
  const db = memoryDb();
  const att = upload(db, 'u-editor', ['u-viewer'], 'compartido.png');
  assert.equal(att.visibility, 'shared');
  assert.deepEqual(att.viewerIds, ['u-viewer']);
  assert.equal(canViewAttachment(db, att.id, 'u-viewer'), true);
  const forViewer = listAttachmentsByItem(db, 'item-1', 'u-viewer');
  assert.equal(forViewer.length, 1);
  assert.equal(forViewer[0]?.viewerIds, null, 'viewerIds solo para el uploader');
  assert.equal(forViewer[0]?.uploadedByName, 'Eli Editor');

  const forOwner = listAttachmentsByItem(db, 'item-1', 'u-owner');
  assert.equal(forOwner.length, 0, 'el owner no fue otorgado');
  assert.equal(canViewAttachment(db, att.id, 'u-owner'), false);
});

test('owner ve lo propio y puede elegir viewers', () => {
  useTmp();
  const db = memoryDb();
  const att = upload(db, 'u-owner', ['u-editor'], 'mio.png');
  assert.equal(canViewAttachment(db, att.id, 'u-owner'), true);
  assert.equal(canViewAttachment(db, att.id, 'u-editor'), true);
  assert.equal(canViewAttachment(db, att.id, 'u-viewer'), false);
  assert.equal(listAttachmentsByItem(db, 'item-1', 'u-owner').length, 1);
});

test('legacy (sin filas de viewers) visible para cualquier miembro', () => {
  useTmp();
  const db = memoryDb();
  const legacy = addAttachment(db, 'item-1', 'u-editor', {
    fileName: 'legacy.png',
    mimeType: 'image/png',
    dataUrl: PNG_DATA_URL,
  });
  const rows = db
    .prepare('SELECT COUNT(*) AS c FROM attachment_viewers WHERE attachment_id = ?')
    .get(legacy.id) as { c: number };
  assert.equal(rows.c, 0, 'legacy no tiene filas de viewers');

  for (const member of ['u-owner', 'u-editor', 'u-viewer']) {
    assert.equal(canViewAttachment(db, legacy.id, member), true, `legacy visible para ${member}`);
    assert.equal(listAttachmentsByItem(db, 'item-1', member).length, 1);
  }
  assert.equal(canViewAttachment(db, legacy.id, 'u-other'), false, 'no-miembro no ve el legacy');
});

test('url firmada: solo se entrega a viewers; exp ~15 min y uid ligado al caller', () => {
  useTmp();
  const db = memoryDb();
  const att = upload(db, 'u-editor', ['u-viewer']);
  const row = findAttachment(db, att.id);
  assert.ok(row);
  const forUploader = getAttachmentForUser(db, att.id, 'u-editor');
  const forViewer = getAttachmentForUser(db, att.id, 'u-viewer');
  assert.ok(forUploader && forViewer);
  assert.equal(forUploader.url.split('?')[0], row.path);
  const params = new URLSearchParams(forViewer.url.split('?')[1]);
  assert.equal(params.get('uid'), 'u-viewer');
  assert.ok(params.get('sig'));
  const exp = Number(params.get('exp'));
  const ttl = exp - Math.floor(Date.now() / 1000);
  assert.ok(ttl > ATTACHMENT_URL_TTL_SECONDS - 30 && ttl <= ATTACHMENT_URL_TTL_SECONDS, `ttl=${ttl}`);
  assert.equal(verifyUploadSignature(row.path, 'u-viewer', params.get('exp'), params.get('sig')), true);
  assert.equal(verifyUploadSignature(row.path, 'u-owner', params.get('exp'), params.get('sig')), false);
  assert.equal(getAttachmentForUser(db, att.id, 'u-owner'), null, 'sin URL para no-viewer');
});

test('serveUploads: archivo firmado -> 200 con Cache-Control private, no-store', () => {
  useTmp();
  const db = memoryDb();
  const att = upload(db, 'u-editor', []);
  const row = findAttachment(db, att.id);
  assert.ok(row);
  const abs = path.join(tmpDir, row.path.replace(/^\/uploads\//, ''));
  assert.ok(fs.existsSync(abs));
  const res = serve(att.url);
  assert.equal(res.status, 200);
  assert.equal(res.headers['Cache-Control'], 'private, no-store');
  assert.equal(res.headers['Content-Type'], 'image/png');
});

test('serveUploads: sin firma / firma invalida -> 403', () => {
  useTmp();
  const db = memoryDb();
  const att = upload(db, 'u-editor', []);
  const row = findAttachment(db, att.id);
  assert.ok(row);

  assert.equal(serve(row.path).status, 403, 'sin sig/exp -> 403');
  const sig = new URL(att.url, 'http://x').searchParams.get('sig')!;
  const exp = new URL(att.url, 'http://x').searchParams.get('exp')!;
  const tampered = `${row.path}?uid=u-editor&exp=${exp}&sig=${sig.slice(0, -1)}0`;
  assert.equal(serve(tampered).status, 403, 'firma alterada -> 403');
  assert.equal(
    serve(`${row.path}?uid=u-editor&exp=${exp}`).status,
    403,
    'sin sig -> 403'
  );
});

test('serveUploads: firma vencida -> 403', () => {
  useTmp();
  const db = memoryDb();
  const att = upload(db, 'u-editor', []);
  const row = findAttachment(db, att.id);
  assert.ok(row);
  const expired = signAttachmentUrl(row.path, 'u-editor', {
    exp: Math.floor(Date.now() / 1000) - 1,
  });
  assert.equal(serve(expired).status, 403);
});

test('delete: solo el uploader; otro miembro -> FORBIDDEN_ATTACHMENT', () => {
  useTmp();
  const db = memoryDb();
  const att = upload(db, 'u-editor', ['u-viewer']);
  const code = errorCodeOf(() =>
    call(resolvers.Mutation.removeItemAttachment as never, { attachmentId: att.id }, ctxFor(db, 'u-owner'))
  );
  assert.equal(code, 'FORBIDDEN_ATTACHMENT');
  assert.ok(findAttachment(db, att.id), 'el archivo sigue existiendo');

  // El uploader si puede.
  const removed = call(
    resolvers.Mutation.removeItemAttachment as never,
    { attachmentId: att.id },
    ctxFor(db, 'u-editor')
  ) as { id: string } | null;
  assert.equal(removed?.id, att.id);
  assert.equal(findAttachment(db, att.id), null);
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS c FROM attachment_viewers WHERE attachment_id = ?').get(att.id) as { c: number }).c,
    0,
    'viewers borrados junto al adjunto'
  );
});

test('addItemAttachment: viewer no-miembro -> INVALID_VIEWER (sin escribir archivo)', () => {
  useTmp();
  const db = memoryDb();
  const code = errorCodeOf(() => upload(db, 'u-editor', ['u-other']));
  assert.equal(code, 'INVALID_VIEWER');
  assert.equal(listAttachmentsByItem(db, 'item-1').length, 0);
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS c FROM item_attachments').get() as { c: number }).c,
    0,
    'no se inserta el adjunto si la validacion falla'
  );
});

test('viewerIds duplicados no generan filas duplicadas y el uploader no se auto-lista', () => {
  useTmp();
  const db = memoryDb();
  const att = upload(db, 'u-editor', ['u-viewer', 'u-viewer', 'u-editor']);
  const rows = db
    .prepare('SELECT user_id FROM attachment_viewers WHERE attachment_id = ? ORDER BY user_id')
    .all(att.id) as unknown as { user_id: string }[];
  assert.deepEqual(rows.map((r) => r.user_id), ['u-viewer']);
  assert.equal(att.visibility, 'shared');
});

function updateViewers(
  db: DatabaseSync,
  userId: string,
  attachmentId: string,
  viewerIds?: string[]
): UploadResult {
  return call(
    resolvers.Mutation.updateAttachmentViewers as never,
    { attachmentId, viewerIds },
    ctxFor(db, userId)
  ) as UploadResult;
}

test('updateAttachmentViewers: uploader agrega viewer (private -> shared)', () => {
  useTmp();
  const db = memoryDb();
  const att = upload(db, 'u-editor', []);
  assert.equal(att.visibility, 'private');
  assert.equal(canViewAttachment(db, att.id, 'u-viewer'), false);

  const updated = updateViewers(db, 'u-editor', att.id, ['u-viewer']);
  assert.equal(updated.visibility, 'shared');
  assert.deepEqual(updated.viewerIds, ['u-viewer']);
  assert.equal(canViewAttachment(db, att.id, 'u-viewer'), true);
  assert.equal(canViewAttachment(db, att.id, 'u-owner'), false, 'el owner no fue otorgado');
  assert.equal(listAttachmentsByItem(db, 'item-1', 'u-viewer').length, 1);
  // Dedupe + uploader implicito (no se guarda fila propia).
  const deduped = updateViewers(db, 'u-editor', att.id, ['u-viewer', 'u-viewer', 'u-editor']);
  assert.deepEqual(deduped.viewerIds, ['u-viewer']);
  const rows = db
    .prepare('SELECT user_id FROM attachment_viewers WHERE attachment_id = ? ORDER BY user_id')
    .all(att.id) as unknown as { user_id: string }[];
  assert.deepEqual(rows.map((r) => r.user_id), ['u-viewer']);
});

test('updateAttachmentViewers: uploader quita todos (shared -> private)', () => {
  useTmp();
  const db = memoryDb();
  const att = upload(db, 'u-editor', ['u-viewer']);
  assert.equal(att.visibility, 'shared');
  assert.equal(canViewAttachment(db, att.id, 'u-viewer'), true);

  const updated = updateViewers(db, 'u-editor', att.id, []);
  assert.equal(updated.visibility, 'private');
  assert.deepEqual(updated.viewerIds, []);
  assert.equal(canViewAttachment(db, att.id, 'u-viewer'), false);
  assert.equal(listAttachmentsByItem(db, 'item-1', 'u-viewer').length, 0);
  assert.equal(canViewAttachment(db, att.id, 'u-editor'), true);
});

test('updateAttachmentViewers: no-uploader -> FORBIDDEN_ATTACHMENT (sin cambios)', () => {
  useTmp();
  const db = memoryDb();
  const att = upload(db, 'u-editor', ['u-viewer']);

  const code = errorCodeOf(() => updateViewers(db, 'u-owner', att.id, []));
  assert.equal(code, 'FORBIDDEN_ATTACHMENT');
  assert.deepEqual(listAttachmentsByItem(db, 'item-1', 'u-viewer').length, 1, 'viewer no fue quitado');
  assert.equal(canViewAttachment(db, att.id, 'u-viewer'), true);
});

test('updateAttachmentViewers: viewer no-miembro -> INVALID_VIEWER (sin cambios)', () => {
  useTmp();
  const db = memoryDb();
  const att = upload(db, 'u-editor', ['u-viewer']);

  const code = errorCodeOf(() => updateViewers(db, 'u-editor', att.id, ['u-other']));
  assert.equal(code, 'INVALID_VIEWER');
  assert.equal(
    canViewAttachment(db, att.id, 'u-viewer'),
    true,
    'la validacion falla antes de reemplazar el set'
  );
  assert.equal(canViewAttachment(db, att.id, 'u-other'), false);
  const rows = db
    .prepare('SELECT user_id FROM attachment_viewers WHERE attachment_id = ? ORDER BY user_id')
    .all(att.id) as unknown as { user_id: string }[];
  assert.deepEqual(rows.map((r) => r.user_id), ['u-viewer']);
});

test('updateAttachmentViewers: retorno del Attachment incluye url firmada del uploader', () => {
  useTmp();
  const db = memoryDb();
  const att = upload(db, 'u-editor', []);
  const updated = updateViewers(db, 'u-editor', att.id, ['u-viewer']);
  const row = findAttachment(db, att.id);
  assert.ok(row);

  assert.equal(updated.url.split('?')[0], row.path);
  const params = new URLSearchParams(updated.url.split('?')[1]);
  assert.equal(params.get('uid'), 'u-editor');
  assert.ok(params.get('sig'));
  assert.equal(updated.uploadedByName, 'Eli Editor');
  assert.equal(updated.id, att.id);
});
