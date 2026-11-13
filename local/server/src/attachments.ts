// Adjuntos de actividades (boletos/PDFs/imagenes).
// - Data URL -> archivo en uploads/attachments/<itemId>/<uuid>.<ext> (uuid evita
//   colisiones); file_name original se guarda para mostrar.
// - path en DB SIEMPRE relativo (/uploads/attachments/...).
// - Visibilidad POR ARCHIVO: el uploader es viewer implicito; los demas solo si
//   tienen fila en attachment_viewers. Los adjuntos legacy (visibility='legacy')
//   siguen visibles para cualquier miembro del viaje.

import { mkdirSync, unlinkSync, existsSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Db } from './schema-types.ts';
import { UPLOADS_DIR } from './profile.ts';
import { signAttachmentUrl } from './attachment-tokens.ts';

export { signAttachmentUrl, verifyUploadSignature } from './attachment-tokens.ts';

const ATTACHMENTS_DIR = () => {
  const base = process.env.TRIPLANNER_UPLOADS_OVERRIDE
    ? path.resolve(process.env.TRIPLANNER_UPLOADS_OVERRIDE)
    : UPLOADS_DIR;
  return path.join(base, 'attachments');
};

const ALLOWED_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10MB

// 'legacy' = subido antes de M1 (visible para todos los miembros).
// 'private' = solo uploader; 'shared' = uploader + filas de attachment_viewers.
export type AttachmentVisibilityMode = 'private' | 'shared' | 'legacy';

export interface AttachmentRow {
  id: string;
  item_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  path: string;
  created_by: string;
  created_at: string;
  visibility: AttachmentVisibilityMode;
}

interface AttachmentRowWithUploader extends AttachmentRow {
  uploaded_by_name: string | null;
}

export type AttachmentVisibility = 'private' | 'shared';

export interface AttachmentGql {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  createdAt: string;
  uploadedByName: string | null;
  viewerIds: string[] | null;
  visibility: AttachmentVisibility;
  createdBy: string;
}

export interface AddAttachmentInput {
  fileName: string;
  mimeType: string;
  dataUrl: string;
}

function ensureAttachmentsDir(): void {
  mkdirSync(ATTACHMENTS_DIR(), { recursive: true });
}

export function decodeDataUrl(dataUrl: string): { ext: string; buffer: Buffer } {
  const m = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,(.+)$/.exec(dataUrl.trim());
  if (!m) throw new Error('El archivo debe venir en base64.');
  const mime = m[1]!;
  const ext = ALLOWED_MIME[mime];
  if (!ext) throw new Error('Formato no permitido: usa PDF, PNG, JPG o WebP.');
  let buffer: Buffer;
  try {
    buffer = Buffer.from(m[2]!, 'base64');
  } catch {
    throw new Error('El archivo no se pudo decodificar.');
  }
  if (buffer.length === 0) throw new Error('El archivo está vacío.');
  if (buffer.length > MAX_ATTACHMENT_BYTES) throw new Error('El archivo supera los 10MB.');
  return { ext, buffer };
}

export function saveAttachmentFile(itemId: string, dataUrl: string): { relPath: string; bytes: number } {
  ensureAttachmentsDir();
  const { ext, buffer } = decodeDataUrl(dataUrl);
  const itemDir = path.join(ATTACHMENTS_DIR(), itemId);
  mkdirSync(itemDir, { recursive: true });
  const fileName = `${randomUUID()}.${ext}`;
  const abs = path.join(itemDir, fileName);
  writeFileSync(abs, buffer);
  return { relPath: `/uploads/attachments/${itemId}/${fileName}`, bytes: buffer.length };
}

// Borra el archivo SIEMPRE que el path quede dentro de attachments/ (seguridad).
export function removeAttachmentFile(relPath: string): void {
  const base = path.resolve(ATTACHMENTS_DIR());
  const rel = relPath.replace(/^\/uploads\/attachments\//, '');
  const abs = path.resolve(base, rel);
  if (abs !== base && !abs.startsWith(base + path.sep)) return; // fuera de attachments/: no tocar
  if (!existsSync(abs)) return;
  try {
    unlinkSync(abs);
  } catch {
    // ya no existe o en uso: ignorar
  }
}

const ATTACHMENT_SELECT = `
  SELECT a.*, u.display_name AS uploaded_by_name
  FROM item_attachments a
  LEFT JOIN users u ON u.id = a.created_by
`;

export function listAttachmentViewerIds(db: Db, attachmentId: string): string[] {
  const rows = db
    .prepare('SELECT user_id FROM attachment_viewers WHERE attachment_id = ? ORDER BY user_id ASC')
    .all(attachmentId) as unknown as { user_id: string }[];
  return rows.map((r) => r.user_id);
}

function hasViewerRows(db: Db, attachmentId: string): boolean {
  return Boolean(
    db.prepare('SELECT 1 FROM attachment_viewers WHERE attachment_id = ? LIMIT 1').get(attachmentId)
  );
}

// Regla central de visibilidad (STD):
// - uploader siempre ve
// - viewer otorgado ve
// - adjunto legacy SIN filas de viewers: cualquier miembro del viaje ve
// - si hay filas y el caller no es uploader ni viewer: NO ve (incluido el owner)
export function canViewAttachment(
  db: Db,
  attachmentId: string,
  userId: string,
  tripId?: string | null
): boolean {
  const row = db
    .prepare(`
      SELECT a.created_by AS created_by, a.visibility AS visibility, i.trip_id AS trip_id
      FROM item_attachments a
      JOIN trip_items i ON i.id = a.item_id
      WHERE a.id = ?
    `)
    .get(attachmentId) as
    | { created_by: string; visibility: AttachmentVisibilityMode; trip_id: string }
    | undefined;
  if (!row) return false;
  if (row.created_by === userId) return true;

  const isViewer = db
    .prepare('SELECT 1 FROM attachment_viewers WHERE attachment_id = ? AND user_id = ?')
    .get(attachmentId, userId);
  if (isViewer) return true;

  // Legacy (subido antes de M1): visible para miembros del viaje.
  if (row.visibility === 'legacy') {
    return isTripMember(db, row.trip_id, userId);
  }
  return false;
}

export function listAttachmentsByItem(db: Db, itemId: string, userId?: string | null): AttachmentGql[] {
  const rows = db
    .prepare(`${ATTACHMENT_SELECT} WHERE a.item_id = ? ORDER BY a.created_at ASC`)
    .all(itemId) as unknown as AttachmentRowWithUploader[];
  return rows
    .filter((row) => !userId || canViewAttachment(db, row.id, userId))
    .map((row) => toAttachmentGql(db, row, userId ?? null));
}

export function toAttachmentGql(
  db: Db,
  row: AttachmentRowWithUploader,
  callerUserId: string | null,
  signUrls = Boolean(callerUserId)
): AttachmentGql {
  const isUploader = callerUserId !== null && callerUserId === row.created_by;
  const viewerIds = isUploader ? listAttachmentViewerIds(db, row.id) : null;
  return {
    id: row.id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    url: callerUserId && signUrls ? signAttachmentUrl(row.path, callerUserId) : row.path,
    createdAt: row.created_at,
    uploadedByName: row.uploaded_by_name ?? null,
    viewerIds,
    // Legacy se comparte con todos los miembros (aunque no tenga filas de viewers).
    visibility: row.visibility === 'legacy' || hasViewerRows(db, row.id) ? 'shared' : 'private',
    createdBy: row.created_by,
  };
}

export function findAttachment(db: Db, attachmentId: string): AttachmentRowWithUploader | null {
  const row = db.prepare(`${ATTACHMENT_SELECT} WHERE a.id = ?`).get(attachmentId) as
    | AttachmentRowWithUploader
    | undefined;
  return row ?? null;
}

export function getAttachmentForUser(
  db: Db,
  attachmentId: string,
  userId: string
): AttachmentGql | null {
  const row = findAttachment(db, attachmentId);
  if (!row) return null;
  if (!canViewAttachment(db, attachmentId, userId)) return null;
  return toAttachmentGql(db, row, userId, true);
}

export function addAttachment(
  db: Db,
  itemId: string,
  createdBy: string,
  input: AddAttachmentInput,
  viewerIds?: readonly string[]
): AttachmentGql {
  const name = input.fileName.trim().slice(0, 120) || 'archivo';
  const { relPath, bytes } = saveAttachmentFile(itemId, input.dataUrl);
  const id = randomUUID();

  // El uploader es viewer implicito: no se guarda fila propia. Dedupe por PK.
  // Omitir viewerIds = flujo legacy (visible para miembros); pasarlo (aunque sea
  // vacio) = visibilidad explicita del flujo M1 (vacio -> privado).
  const explicitVisibility = viewerIds !== undefined;
  const uniqueViewers = [...new Set(viewerIds ?? [])].filter((viewerId) => viewerId !== createdBy);
  const visibility: AttachmentVisibilityMode = !explicitVisibility
    ? 'legacy'
    : uniqueViewers.length > 0
      ? 'shared'
      : 'private';

  db.prepare(`
    INSERT INTO item_attachments (id, item_id, file_name, mime_type, size_bytes, path, created_by, visibility)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, itemId, name, input.mimeType, bytes, relPath, createdBy, visibility);

  for (const viewerId of uniqueViewers) {
    db.prepare(
      'INSERT OR IGNORE INTO attachment_viewers (attachment_id, user_id) VALUES (?, ?)'
    ).run(id, viewerId);
  }

  const row = db.prepare(`${ATTACHMENT_SELECT} WHERE a.id = ?`).get(id) as unknown as AttachmentRowWithUploader;
  // Llamada interna: url relativa (el resolver la re-consulta firmada para el caller).
  return toAttachmentGql(db, row, createdBy, false);
}

// Devuelve los ids que NO son miembros del viaje (para INVALID_VIEWER).
export function invalidAttachmentViewers(
  db: Db,
  tripId: string,
  viewerIds: readonly string[]
): string[] {
  return [...new Set(viewerIds)].filter((viewerId) => !isTripMember(db, tripId, viewerId));
}

// Reemplaza el set de viewers de un adjunto existente (solo uploader; el
// resolver valida permisos y membresia). Uploader implicito: no lleva fila.
// Transaccion: borrar filas, insertar nuevas y ajustar visibility.
export function replaceAttachmentViewers(
  db: Db,
  attachmentId: string,
  viewerIds: readonly string[]
): void {
  const uniqueViewers = [...new Set(viewerIds)];
  const visibility: AttachmentVisibilityMode = uniqueViewers.length > 0 ? 'shared' : 'private';
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM attachment_viewers WHERE attachment_id = ?').run(attachmentId);
    const insert = db.prepare(
      'INSERT OR IGNORE INTO attachment_viewers (attachment_id, user_id) VALUES (?, ?)'
    );
    for (const viewerId of uniqueViewers) insert.run(attachmentId, viewerId);
    db.prepare('UPDATE item_attachments SET visibility = ? WHERE id = ?').run(visibility, attachmentId);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function removeAttachment(db: Db, attachmentId: string): AttachmentRow | null {
  const row = db.prepare('SELECT * FROM item_attachments WHERE id = ?').get(attachmentId) as
    | unknown as AttachmentRow
    | undefined;
  if (!row) return null;
  db.prepare('DELETE FROM attachment_viewers WHERE attachment_id = ?').run(attachmentId);
  db.prepare('DELETE FROM item_attachments WHERE id = ?').run(attachmentId);
  removeAttachmentFile(row.path);
  return row;
}

export function findAttachmentItemTrip(db: Db, attachmentId: string): { itemId: string; tripId: string } | null {
  return (db.prepare(`
    SELECT a.item_id AS itemId, i.trip_id AS tripId
    FROM item_attachments a
    JOIN trip_items i ON i.id = a.item_id
    WHERE a.id = ?
  `).get(attachmentId) as { itemId: string; tripId: string } | undefined) ?? null;
}

export function findItemTrip(db: Db, itemId: string): string | null {
  const row = db.prepare('SELECT trip_id FROM trip_items WHERE id = ?').get(itemId) as
    | { trip_id: string }
    | undefined;
  return row?.trip_id ?? null;
}

// Borra TODOS los adjuntos de un viaje (archivos en disco + filas) para deleteTrip.
export function removeAttachmentsByTrip(db: Db, tripId: string): void {
  const rows = db.prepare(`
    SELECT a.path AS path FROM item_attachments a
    JOIN trip_items i ON i.id = a.item_id
    WHERE i.trip_id = ?
  `).all(tripId) as unknown as { path: string }[];
  for (const row of rows) removeAttachmentFile(row.path);
  db.prepare(`
    DELETE FROM attachment_viewers WHERE attachment_id IN (
      SELECT a.id FROM item_attachments a
      JOIN trip_items i ON i.id = a.item_id
      WHERE i.trip_id = ?
    )
  `).run(tripId);
  db.prepare(`
    DELETE FROM item_attachments WHERE item_id IN (SELECT id FROM trip_items WHERE trip_id = ?)
  `).run(tripId);
}

// Check de membresia: el usuario debe ser miembro del trip del item.
export function isTripMember(db: Db, tripId: string, userId: string): boolean {
  const row = db.prepare('SELECT 1 FROM trip_members WHERE trip_id = ? AND user_id = ?').get(tripId, userId);
  return Boolean(row);
}
