import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { connectPg, deleteUser, insertUser } from './helpers/pg.ts';
import type { PgDb } from '../src/pg/db.ts';
import { addItem, createTrip, deleteTripCascade, inviteMember } from '../src/pg/trips.ts';
import { LocalDiskStorage } from '../src/storage.ts';
import {
  addAttachment,
  canViewAttachment,
  getAttachmentForUser,
  invalidAttachmentViewers,
  listAttachmentsByItem,
  removeAttachment,
  removeAttachmentsByTrip,
  replaceAttachmentViewers,
} from '../src/pg/attachments.ts';

let db: PgDb | null = null;
let storage: LocalDiskStorage;
let root: string;

const PDF = Buffer.from('%PDF-1.4 test attachment').toString('base64');
const pdfInput = { fileName: 'boleto.pdf', mimeType: 'application/pdf', dataUrl: `data:application/pdf;base64,${PDF}` };

before(async () => {
  db = await connectPg();
  root = mkdtempSync(path.join(tmpdir(), 'triplanner-attachments-'));
  storage = new LocalDiskStorage(root);
});

after(async () => {
  await db?.close();
  rmSync(root, { recursive: true, force: true });
});

async function tripWithItem(conn: PgDb) {
  const owner = await insertUser(conn, 'Owner');
  const member = await insertUser(conn, 'Member');
  const trip = await createTrip(conn, owner, { name: 'Viaje', startDate: '2030-01-01', endDate: '2030-01-02' });
  await inviteMember(conn, trip.id, member, 'viewer');
  const item = await addItem(conn, trip.id, owner, { title: 'Museo', category: 'sight', day: '2030-01-01' });
  return { owner, member, trip, item };
}

describe('attachments on Postgres', () => {
  test('stores bytes through the storage backend and keeps a relative URL', async () => {
    if (!db) return;
    const { owner, member, trip, item } = await tripWithItem(db);

    const attachment = await addAttachment(db, storage, item.id, owner, pdfInput, []);
    assert.equal(attachment.visibility, 'private');
    assert.match(attachment.url, /^\/uploads\/attachments\//);

    const row = await db
      .prepare('SELECT path, size_bytes FROM item_attachments WHERE id = ?')
      .get<{ path: string; size_bytes: number }>(attachment.id);
    assert.ok(row?.path.startsWith(`attachments/${item.id}/`));
    assert.equal(row?.size_bytes, Buffer.from(PDF, 'base64').length);
    assert.deepEqual(await storage.read(row?.path ?? ''), Buffer.from(PDF, 'base64'));

    // Uploader sees it; another member does not (explicit private).
    assert.equal(await canViewAttachment(db, attachment.id, owner), true);
    assert.equal(await canViewAttachment(db, attachment.id, member), false);

    await deleteTripCascade(db, trip.id);
    await deleteUser(db, owner);
    await deleteUser(db, member);
  });

  test('shares with explicit viewers only', async () => {
    if (!db) return;
    const { owner, member, trip, item } = await tripWithItem(db);

    const attachment = await addAttachment(db, storage, item.id, owner, pdfInput, [member]);
    assert.equal(attachment.visibility, 'shared');
    assert.deepEqual(attachment.viewerIds, [member]);
    assert.equal(await canViewAttachment(db, attachment.id, member), true);

    await replaceAttachmentViewers(db, attachment.id, []);
    assert.equal(await canViewAttachment(db, attachment.id, member), false);

    const listed = await listAttachmentsByItem(db, storage, item.id, member);
    assert.equal(listed.length, 0);

    await deleteTripCascade(db, trip.id);
    await deleteUser(db, owner);
    await deleteUser(db, member);
  });

  test('legacy attachments are visible to every trip member', async () => {
    if (!db) return;
    const { owner, member, trip, item } = await tripWithItem(db);

    const attachment = await addAttachment(db, storage, item.id, owner, pdfInput); // no viewerIds
    const row = await db
      .prepare('SELECT visibility FROM item_attachments WHERE id = ?')
      .get<{ visibility: string }>(attachment.id);
    assert.equal(row?.visibility, 'legacy');
    assert.equal(await canViewAttachment(db, attachment.id, member), true);

    await deleteTripCascade(db, trip.id);
    await deleteUser(db, owner);
    await deleteUser(db, member);
  });

  test('signed URLs are returned to the owner but not to anonymous callers', async () => {
    if (!db) return;
    const { owner, member, trip, item } = await tripWithItem(db);
    const attachment = await addAttachment(db, storage, item.id, owner, pdfInput, [member]);

    const signed = await getAttachmentForUser(db, storage, attachment.id, member);
    assert.match(signed?.url ?? '', /\?uid=.*&exp=.*&sig=/);

    const anonymous = await listAttachmentsByItem(db, storage, item.id, null);
    assert.match(anonymous[0]?.url ?? '', /^\/uploads\//);

    await deleteTripCascade(db, trip.id);
    await deleteUser(db, owner);
    await deleteUser(db, member);
  });

  test('rejects non-member viewers and unsupported types', async () => {
    if (!db) return;
    const { owner, member, trip, item } = await tripWithItem(db);
    const stranger = await insertUser(db, 'Stranger');

    assert.deepEqual(await invalidAttachmentViewers(db, trip.id, [member, stranger]), [stranger]);

    await assert.rejects(
      () => addAttachment(db as PgDb, storage, item.id, owner, { ...pdfInput, mimeType: 'text/plain', dataUrl: 'data:text/plain;base64,aGk=' }, []),
      /Formato no permitido/,
    );

    await deleteTripCascade(db, trip.id);
    await deleteUser(db, owner);
    await deleteUser(db, member);
    await deleteUser(db, stranger);
  });

  test('removing an attachment deletes its bytes', async () => {
    if (!db) return;
    const { owner, member, trip, item } = await tripWithItem(db);
    const attachment = await addAttachment(db, storage, item.id, owner, pdfInput, []);
    const row = await db
      .prepare('SELECT path FROM item_attachments WHERE id = ?')
      .get<{ path: string }>(attachment.id);

    await removeAttachment(db, storage, attachment.id);
    assert.equal(await storage.read(row?.path ?? ''), null);
    assert.equal(await db.prepare('SELECT 1 FROM item_attachments WHERE id = ?').get(attachment.id), undefined);

    await deleteTripCascade(db, trip.id);
    await deleteUser(db, owner);
    await deleteUser(db, member);
  });

  test('removes every attachment of a trip', async () => {
    if (!db) return;
    const { owner, member, trip, item } = await tripWithItem(db);
    const first = await addAttachment(db, storage, item.id, owner, pdfInput, []);
    const second = await addAttachment(db, storage, item.id, owner, pdfInput, []);
    const paths = (
      await db
        .prepare('SELECT path FROM item_attachments WHERE id = ANY(?)')
        .all<{ path: string }>(`{${first.id},${second.id}}`)
    ).map((r) => r.path);

    await removeAttachmentsByTrip(db, storage, trip.id);

    for (const p of paths) assert.equal(await storage.read(p), null);
    const { c } = (await db
      .prepare('SELECT count(*)::int AS c FROM item_attachments WHERE item_id = ?')
      .get<{ c: number }>(item.id)) ?? { c: 0 };
    assert.equal(c, 0);

    await deleteTripCascade(db, trip.id);
    await deleteUser(db, owner);
    await deleteUser(db, member);
  });
});
