// Profile update on Postgres. Avatars go through Storage, so the same code
// works with local disk and S3.

import type { UserRow } from '../schema-types.ts';
import type { AsyncDb } from './db.ts';
import type { Storage } from '../storage.ts';

export const SUPPORTED_LANGUAGES = ['es', 'en'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

const AVATAR_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const AVATAR_EXTS = ['png', 'jpg', 'webp'];

export function isValidLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

export function decodeAvatarDataUrl(dataUrl: string): { ext: string; buffer: Buffer } {
  const m = /^data:(image\/[a-z+]+);base64,(.+)$/.exec(dataUrl.trim());
  if (!m) throw new Error('La foto debe ser una imagen en base64 válida.');
  const mime = m[1]!;
  const ext = AVATAR_MIME[mime];
  if (!ext) throw new Error('Formato no permitido: usa PNG, JPG o WebP.');
  let buffer: Buffer;
  try {
    buffer = Buffer.from(m[2]!, 'base64');
  } catch {
    throw new Error('La foto no se pudo decodificar.');
  }
  if (buffer.length === 0) throw new Error('La foto está vacía.');
  if (buffer.length > MAX_AVATAR_BYTES) throw new Error('La foto supera los 5MB.');
  return { ext, buffer };
}

export function validateDisplayName(displayName: string): string {
  const name = displayName.trim();
  if (name.length < 1) throw new Error('El nombre no puede estar vacío.');
  if (name.length > 40) throw new Error('El nombre no puede superar 40 caracteres.');
  return name;
}

export interface UpdateMyProfileInput {
  displayName: string;
  avatarDataUrl?: string | null;
  avatarRemove?: boolean | null;
  language?: string | null;
}

async function removeAvatarFiles(storage: Storage, userId: string): Promise<void> {
  for (const ext of AVATAR_EXTS) await storage.delete(`avatars/${userId}.${ext}`);
}

export async function updateMyProfile(
  db: AsyncDb,
  storage: Storage,
  userId: string,
  input: UpdateMyProfileInput,
): Promise<UserRow> {
  const displayName = validateDisplayName(input.displayName);
  const language = input.language ?? null;

  if (input.avatarDataUrl) {
    const { ext, buffer } = decodeAvatarDataUrl(input.avatarDataUrl);
    const key = `avatars/${userId}.${ext}`;
    await removeAvatarFiles(storage, userId);
    await storage.put(key, buffer);
    await db
      .prepare('UPDATE users SET display_name = ?, avatar_url = ?, language = COALESCE(?, language) WHERE id = ?')
      .run(displayName, storage.publicPath(key), language, userId);
  } else if (input.avatarRemove) {
    await removeAvatarFiles(storage, userId);
    await db
      .prepare('UPDATE users SET display_name = ?, avatar_url = NULL, language = COALESCE(?, language) WHERE id = ?')
      .run(displayName, language, userId);
  } else {
    await db
      .prepare('UPDATE users SET display_name = ?, language = COALESCE(?, language) WHERE id = ?')
      .run(displayName, language, userId);
  }

  const row = await db.prepare('SELECT * FROM users WHERE id = ?').get<UserRow>(userId);
  if (!row) throw new Error('Usuario no encontrado.');
  return row;
}
