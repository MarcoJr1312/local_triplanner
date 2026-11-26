// Postgres port of attachments.ts. Bytes go through Storage; the DB stores the
// storage key, and the public/signed URL is derived from it.

import { randomUUID } from 'node:crypto';
import { signAttachmentUrl } from '../attachment-tokens.ts';
import {
  decodeDataUrl,
  type AddAttachmentInput,
  type AttachmentGql,
  type AttachmentRow,
  type AttachmentVisibility,
  type AttachmentVisibilityMode,
} from '../attachments.ts';
import type { Storage } from '../storage.ts';
import type { AsyncDb } from './db.ts';

interface AttachmentRowWithUploader extends AttachmentRow {}

/** Resolves display names through the users store; never reads users here. */
export type UploaderNames = (ids: readonly string[]) => Promise<Map<string, string>>;

const ATTACHMENT_SELECT = 'SELECT a.* FROM item_attachments a';

export async function listAttachmentViewerIds(db: AsyncDb, attachmentId: string): Promise<string[]> {
  const rows = await db
    .prepare('SELECT user_id FROM attachment_viewers WHERE attachment_id = ? ORDER BY user_id ASC')
    .all<{ user_id: string }>(attachmentId);
  return rows.map((r) => r.user_id);
}

async function hasViewerRows(db: AsyncDb, attachmentId: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS ok FROM attachment_viewers WHERE attachment_id = ? LIMIT 1')
    .get(attachmentId);
  return Boolean(row);
}

// Central visibility rule (unchanged):
// - uploader always sees it
// - granted viewer sees it
// - legacy attachment with no viewer rows: any trip member sees it
// - otherwise nobody (not even the owner)
//
// Membership lives in the trips service, so the caller supplies the check.
export async function canViewAttachment(
  db: AsyncDb,
  attachmentId: string,
  userId: string,
  isMember: (tripId: string) => Promise<boolean>,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT created_by, visibility, trip_id
         FROM item_attachments
        WHERE id = ?`,
    )
    .get<{ created_by: string; visibility: AttachmentVisibilityMode; trip_id: string | null }>(
      attachmentId,
    );
  if (!row) return false;
  if (row.created_by === userId) return true;

  const isViewer = await db
    .prepare('SELECT 1 AS ok FROM attachment_viewers WHERE attachment_id = ? AND user_id = ?')
    .get(attachmentId, userId);
  if (isViewer) return true;

  if (row.visibility === 'legacy' && row.trip_id) {
    return isMember(row.trip_id);
  }
  return false;
}

export async function toAttachmentGql(
  db: AsyncDb,
  storage: Storage,
  row: AttachmentRowWithUploader,
  callerUserId: string | null,
  uploadedByName: string | null,
  signUrls = Boolean(callerUserId),
): Promise<AttachmentGql> {
  const isUploader = callerUserId !== null && callerUserId === row.created_by;
  const viewerIds = isUploader ? await listAttachmentViewerIds(db, row.id) : null;
  const publicPath = storage.publicPath(row.path);
  return {
    id: row.id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    url: callerUserId && signUrls ? signAttachmentUrl(publicPath, callerUserId) : publicPath,
    createdAt: row.created_at,
    uploadedByName,
    viewerIds,
    visibility: row.visibility === 'legacy' || (await hasViewerRows(db, row.id)) ? 'shared' : 'private',
    createdBy: row.created_by,
  };
}

export async function listAttachmentsByItem(
  db: AsyncDb,
  storage: Storage,
  itemId: string,
  userId?: string | null,
  isMember?: (tripId: string) => Promise<boolean>,
  resolveUploaders?: UploaderNames,
): Promise<AttachmentGql[]> {
  const rows = await db
    .prepare(`${ATTACHMENT_SELECT} WHERE a.item_id = ? ORDER BY a.created_at ASC`)
    .all<AttachmentRowWithUploader>(itemId);

  const uploaders = resolveUploaders
    ? await resolveUploaders([...new Set(rows.map((row) => row.created_by))])
    : new Map<string, string>();

  const visible: AttachmentGql[] = [];
  for (const row of rows) {
    if (userId && !(await canViewAttachment(db, row.id, userId, isMember ?? (async () => false)))) {
      continue;
    }
    visible.push(
      await toAttachmentGql(
        db,
        storage,
        row,
        userId ?? null,
        uploaders.get(row.created_by) ?? null,
      ),
    );
  }
  return visible;
}

export async function findAttachment(db: AsyncDb, attachmentId: string): Promise<AttachmentRowWithUploader | null> {
  const row = await db
    .prepare(`${ATTACHMENT_SELECT} WHERE a.id = ?`)
    .get<AttachmentRowWithUploader>(attachmentId);
  return row ?? null;
}

export async function getAttachmentForUser(
  db: AsyncDb,
  storage: Storage,
  attachmentId: string,
  userId: string,
  isMember: (tripId: string) => Promise<boolean>,
  resolveUploaders?: UploaderNames,
): Promise<AttachmentGql | null> {
  const row = await findAttachment(db, attachmentId);
  if (!row) return null;
  if (!(await canViewAttachment(db, attachmentId, userId, isMember))) return null;
  const uploaders = resolveUploaders
    ? await resolveUploaders([row.created_by])
    : new Map<string, string>();
  return toAttachmentGql(
    db,
    storage,
    row,
    userId,
    uploaders.get(row.created_by) ?? null,
    true,
  );
}

export async function addAttachment(
  db: AsyncDb,
  storage: Storage,
  tripId: string,
  itemId: string,
  createdBy: string,
  input: AddAttachmentInput,
  viewerIds?: readonly string[],
): Promise<AttachmentGql> {
  const name = input.fileName.trim().slice(0, 120) || 'archivo';
  const { ext, buffer } = decodeDataUrl(input.dataUrl);
  const id = randomUUID();
  const key = `attachments/${itemId}/${id}.${ext}`;
  await storage.put(key, buffer, input.mimeType);

  // Uploader is an implicit viewer: no row for them. Omitting viewerIds keeps
  // the legacy flow (visible to trip members); passing it (even empty) means
  // explicit visibility (empty -> private).
  const explicitVisibility = viewerIds !== undefined;
  const uniqueViewers = [...new Set(viewerIds ?? [])].filter((viewerId) => viewerId !== createdBy);
  const visibility: AttachmentVisibilityMode = !explicitVisibility
    ? 'legacy'
    : uniqueViewers.length > 0
      ? 'shared'
      : 'private';

  await db
    .prepare(
      `INSERT INTO item_attachments
         (id, trip_id, item_id, file_name, mime_type, size_bytes, path, created_by, visibility)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, tripId, itemId, name, input.mimeType, buffer.length, key, createdBy, visibility);

  for (const viewerId of uniqueViewers) {
    await db
      .prepare('INSERT INTO attachment_viewers (attachment_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING')
      .run(id, viewerId);
  }

  const row = await findAttachment(db, id);
  if (!row) throw new Error('No se pudo guardar el adjunto');
  // Internal call: relative URL; the resolver re-reads a signed one for the caller.
  return toAttachmentGql(db, storage, row, createdBy, null, false);
}

export async function replaceAttachmentViewers(
  db: AsyncDb,
  attachmentId: string,
  viewerIds: readonly string[],
): Promise<void> {
  const uniqueViewers = [...new Set(viewerIds)];
  const visibility: AttachmentVisibilityMode = uniqueViewers.length > 0 ? 'shared' : 'private';

  await db.transaction(async (tx) => {
    await tx.prepare('DELETE FROM attachment_viewers WHERE attachment_id = ?').run(attachmentId);
    for (const viewerId of uniqueViewers) {
      await tx
        .prepare('INSERT INTO attachment_viewers (attachment_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING')
        .run(attachmentId, viewerId);
    }
    await tx.prepare('UPDATE item_attachments SET visibility = ? WHERE id = ?').run(visibility, attachmentId);
  });
}

export async function removeAttachment(
  db: AsyncDb,
  storage: Storage,
  attachmentId: string,
): Promise<AttachmentRow | null> {
  const row = await db
    .prepare('SELECT * FROM item_attachments WHERE id = ?')
    .get<AttachmentRow>(attachmentId);
  if (!row) return null;
  await db.prepare('DELETE FROM attachment_viewers WHERE attachment_id = ?').run(attachmentId);
  await db.prepare('DELETE FROM item_attachments WHERE id = ?').run(attachmentId);
  await storage.delete(row.path);
  return row;
}

export async function findAttachmentItemTrip(
  db: AsyncDb,
  attachmentId: string,
): Promise<{ itemId: string; tripId: string } | null> {
  const row = await db
    .prepare('SELECT item_id, trip_id FROM item_attachments WHERE id = ?')
    .get<{ item_id: string; trip_id: string | null }>(attachmentId);
  if (!row?.trip_id) return null;
  return { itemId: row.item_id, tripId: row.trip_id };
}

// Removes every attachment of a trip: rows first, then bytes (best effort).
export async function removeAttachmentsByTrip(db: AsyncDb, storage: Storage, tripId: string): Promise<void> {
  const rows = await db
    .prepare('SELECT path FROM item_attachments WHERE trip_id = ?')
    .all<{ path: string }>(tripId);

  await db.transaction(async (tx) => {
    await tx
      .prepare(
        'DELETE FROM attachment_viewers WHERE attachment_id IN (SELECT id FROM item_attachments WHERE trip_id = ?)',
      )
      .run(tripId);
    await tx.prepare('DELETE FROM item_attachments WHERE trip_id = ?').run(tripId);
  });

  for (const row of rows) await storage.delete(row.path);
}

// Removes every attachment of one item before the item leaves the trips
// service. Metadata lives here; the service only knows the item id.
export async function removeAttachmentsByItem(
  db: AsyncDb,
  storage: Storage,
  tripId: string,
  itemId: string,
): Promise<void> {
  const rows = await db
    .prepare('SELECT path FROM item_attachments WHERE trip_id = ? AND item_id = ?')
    .all<{ path: string }>(tripId, itemId);

  await db.transaction(async (tx) => {
    await tx
      .prepare(
        'DELETE FROM attachment_viewers WHERE attachment_id IN (SELECT id FROM item_attachments WHERE trip_id = ? AND item_id = ?)',
      )
      .run(tripId, itemId);
    await tx
      .prepare('DELETE FROM item_attachments WHERE trip_id = ? AND item_id = ?')
      .run(tripId, itemId);
  });

  for (const row of rows) await storage.delete(row.path);
}
