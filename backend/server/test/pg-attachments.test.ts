import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { connectPg, deleteUser, insertUser } from './helpers/pg.ts';
import type { PgDb } from '../src/pg/db.ts';
import { LocalDiskStorage } from '../src/storage.ts';
import {
  addAttachment,
  canViewAttachment,
  getAttachmentForUser,
  listAttachmentsByItem,
  removeAttachment,
  removeAttachmentsByTrip,
  replaceAttachmentViewers,
} from '../src/pg/attachments.ts';

let db: PgDb | null = null;
let storage: LocalDiskStorage;
let root: string;

const TRIP_ID = 'test-trip';
const ITEM_ID = 'test-item';
const PDF = Buffer.from('%PDF-1.4 test attachment').toString('base64');
const pdfInput = { fileName: 'boleto.pdf', mimeType: 'application/pdf', dataUrl: `data:application/pdf;base64,${PDF}` };

before(async () => {
  db = await connectPg();
  root = mkdtempSync(path.join(tmpdir(), 'triplanner-attachments-'));
  storage = new LocalDiskStorage(root);
});

after(async () => {
  if (db) await removeAttachmentsByTrip(db, storage, TRIP_ID);
  await db?.close();
  rmSync(root, { recursive: true, force: true });
});

async function users(conn: PgDb) {
  const owner = await insertUser(conn, 'Owner');
  const member = await insertUser(conn, 'Member');
  return { owner, member, members: new Set([owner, member]) };
}

/** Mirrors the trips service membership check the API passes in. */
function memberCheck(userId: string, members: Set<string>) {
  return async (tripId: string) => tripId === TRIP_ID && members.has(userId);
}

async function cleanup(conn: PgDb, owner: string, member: string) {
  await removeAttachmentsByTrip(conn, storage, TRIP_ID);
  await deleteUser(conn, owner);
  await deleteUser(conn, member);
}

describe('attachments on Postgres', () => {
  test('stores bytes through the storage backend and keeps a relative URL', async () => {
    if (!db) return;
    const { owner, member, members } = await users(db);

    const attachment = await addAttachment(db, storage, TRIP_ID, ITEM_ID, owner, pdfInput, []);
    assert.equal(attachment.visibility, 'private');
    assert.match(attachment.url, /^\/uploads\/attachments\//);

    const row = await db
      .prepare('SELECT trip_id, path, size_bytes FROM item_attachments WHERE id = ?')
      .get<{ trip_id: string; path: string; size_bytes: number }>(attachment.id);
    assert.equal(row?.trip_id, TRIP_ID);
    assert.ok(row?.path.startsWith(`attachments/${ITEM_ID}/`));
    assert.equal(row?.size_bytes, Buffer.from(PDF, 'base64').length);
    assert.deepEqual(await storage.read(row?.path ?? ''), Buffer.from(PDF, 'base64'));

    assert.equal(await canViewAttachment(db, attachment.id, owner, memberCheck(owner, members)), true);
    assert.equal(await canViewAttachment(db, attachment.id, member, memberCheck(member, members)), false);

    await cleanup(db, owner, member);
  });

  test('shares with explicit viewers only', async () => {
    if (!db) return;
    const { owner, member, members } = await users(db);

    const attachment = await addAttachment(db, storage, TRIP_ID, ITEM_ID, owner, pdfInput, [member]);
    assert.equal(attachment.visibility, 'shared');
    assert.deepEqual(attachment.viewerIds, [member]);
    assert.equal(await canViewAttachment(db, attachment.id, member, memberCheck(member, members)), true);

    await replaceAttachmentViewers(db, attachment.id, []);
    assert.equal(await canViewAttachment(db, attachment.id, member, memberCheck(member, members)), false);

    const listed = await listAttachmentsByItem(
      db,
      storage,
      ITEM_ID,
      member,
      memberCheck(member, members),
    );
    assert.equal(listed.length, 0);

    await cleanup(db, owner, member);
  });

  test('legacy attachments are visible to every trip member', async () => {
    if (!db) return;
    const { owner, member, members } = await users(db);

    const attachment = await addAttachment(db, storage, TRIP_ID, ITEM_ID, owner, pdfInput); // no viewerIds
    const row = await db
      .prepare('SELECT visibility FROM item_attachments WHERE id = ?')
      .get<{ visibility: string }>(attachment.id);
    assert.equal(row?.visibility, 'legacy');
    assert.equal(await canViewAttachment(db, attachment.id, member, memberCheck(member, members)), true);

    await cleanup(db, owner, member);
  });

  test('signed URLs are returned to the owner but not to anonymous callers', async () => {
    if (!db) return;
    const { owner, member, members } = await users(db);
    const attachment = await addAttachment(db, storage, TRIP_ID, ITEM_ID, owner, pdfInput, [member]);

    const signed = await getAttachmentForUser(
      db,
      storage,
      attachment.id,
      member,
      memberCheck(member, members),
    );
    assert.match(signed?.url ?? '', /\?uid=.*&exp=.*&sig=/);

    const anonymous = await listAttachmentsByItem(db, storage, ITEM_ID, null);
    assert.match(anonymous[0]?.url ?? '', /^\/uploads\//);

    await cleanup(db, owner, member);
  });

  test('does not grant access to a non-member and rejects unsupported types', async () => {
    if (!db) return;
    const { owner, member, members } = await users(db);
    const stranger = await insertUser(db, 'Stranger');

    const legacy = await addAttachment(db, storage, TRIP_ID, ITEM_ID, owner, pdfInput);
    assert.equal(
      await canViewAttachment(db, legacy.id, stranger, memberCheck(stranger, members)),
      false,
    );

    await assert.rejects(
      () =>
        addAttachment(
          db as PgDb,
          storage,
          TRIP_ID,
          ITEM_ID,
          owner,
          { ...pdfInput, mimeType: 'text/plain', dataUrl: 'data:text/plain;base64,aGk=' },
          [],
        ),
      /Formato no permitido/,
    );

    await removeAttachmentsByTrip(db, storage, TRIP_ID);
    await deleteUser(db, owner);
    await deleteUser(db, member);
    await deleteUser(db, stranger);
  });

  test('removing an attachment deletes its bytes', async () => {
    if (!db) return;
    const { owner, member } = await users(db);
    const attachment = await addAttachment(db, storage, TRIP_ID, ITEM_ID, owner, pdfInput, []);
    const row = await db
      .prepare('SELECT path FROM item_attachments WHERE id = ?')
      .get<{ path: string }>(attachment.id);

    await removeAttachment(db, storage, attachment.id);
    assert.equal(await storage.read(row?.path ?? ''), null);
    assert.equal(await db.prepare('SELECT 1 FROM item_attachments WHERE id = ?').get(attachment.id), undefined);

    await cleanup(db, owner, member);
  });

  test('removes every attachment of a trip', async () => {
    if (!db) return;
    const { owner, member } = await users(db);
    const first = await addAttachment(db, storage, TRIP_ID, ITEM_ID, owner, pdfInput, []);
    const second = await addAttachment(db, storage, TRIP_ID, ITEM_ID, owner, pdfInput, []);
    const paths = (
      await db
        .prepare('SELECT path FROM item_attachments WHERE id = ANY(?)')
        .all<{ path: string }>(`{${first.id},${second.id}}`)
    ).map((r) => r.path);

    await removeAttachmentsByTrip(db, storage, TRIP_ID);

    for (const p of paths) assert.equal(await storage.read(p), null);
    const { c } = (await db
      .prepare('SELECT count(*)::int AS c FROM item_attachments WHERE trip_id = ?')
      .get<{ c: number }>(TRIP_ID)) ?? { c: 0 };
    assert.equal(c, 0);

    await cleanup(db, owner, member);
  });
});
