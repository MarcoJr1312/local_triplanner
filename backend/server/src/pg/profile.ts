// Profile update. Avatar bytes go through Storage (API-owned); the users store
// keeps the URL, display name and language.

import type { UsersStore, UserRecord, UpdateUserData } from '../users/types.ts';
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
  users: UsersStore,
  storage: Storage,
  userId: string,
  input: UpdateMyProfileInput,
): Promise<UserRecord> {
  const displayName = validateDisplayName(input.displayName);
  if (input.language != null && !isValidLanguage(input.language)) {
    throw new Error('Idioma no soportado.');
  }
  const language = input.language ?? undefined;

  const patch: UpdateUserData = { displayName };
  if (language !== undefined) patch.language = language;

  if (input.avatarDataUrl) {
    const { ext, buffer } = decodeAvatarDataUrl(input.avatarDataUrl);
    const key = `avatars/${userId}.${ext}`;
    await removeAvatarFiles(storage, userId);
    await storage.put(key, buffer);
    patch.avatarUrl = storage.publicPath(key);
  } else if (input.avatarRemove) {
    await removeAvatarFiles(storage, userId);
    patch.avatarUrl = null;
  }

  return users.updateUser(userId, patch);
}
