// Attachment types and data-URL validation. Persistence lives in pg/attachments.

export type AttachmentVisibilityMode = 'private' | 'shared' | 'legacy';

export interface AttachmentRow {
  id: string;
  trip_id: string | null;
  item_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  path: string;
  created_by: string;
  created_at: string;
  visibility: AttachmentVisibilityMode;
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

const ALLOWED_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

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
