// Logica del perfil editable: nombre + foto (avatar).
// - La foto llega como data URL (base64) en la mutation; se decodifica y se
//   guarda como archivo en uploads/avatars/<userId>.<ext> (upgrade a S3: cambiar
//   solo este escritor).
// - avatar_url en DB es SIEMPRE la ruta relativa /uploads/avatars/...

import { mkdirSync, readdirSync, unlinkSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db, UserRow } from './schema-types.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// En produccion: uploads/ junto al server. En tests: TRIPLANNER_UPLOADS_OVERRIDE
// (se lee en tiempo de llamada porque bun corre los test files en un proceso).
function uploadsBase(): string {
  return process.env.TRIPLANNER_UPLOADS_OVERRIDE
    ? path.resolve(process.env.TRIPLANNER_UPLOADS_OVERRIDE)
    : path.resolve(__dirname, '..', 'uploads');
}
export const UPLOADS_DIR = path.resolve(__dirname, '..', 'uploads');
const avatarsDir = () => path.join(uploadsBase(), 'avatars');

const ALLOWED_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5MB

// Idiomas soportados por la UI. 'es' es el default de la columna users.language.
export const SUPPORTED_LANGUAGES = ['es', 'en'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export function isValidLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

export interface UpdateMyProfileInput {
  displayName: string;
  avatarDataUrl?: string | null;
  avatarRemove?: boolean | null;
  language?: string | null;
}

export interface ProfileValidationError {
  message: string;
}

function ensureAvatarDir(): void {
  mkdirSync(avatarsDir(), { recursive: true });
}

// Decodifica un data URL de imagen: devuelve {ext, buffer} o lanza Error con mensaje en espanol.
// Reutilizada por las portadas de viaje (src/covers.ts) con las MISMAS validaciones.
export function decodeAvatarDataUrl(dataUrl: string): { ext: string; buffer: Buffer } {
  const m = /^data:(image\/[a-z+]+);base64,(.+)$/.exec(dataUrl.trim());
  if (!m) throw new Error('La foto debe ser una imagen en base64 válida.');
  const mime = m[1]!;
  const ext = ALLOWED_MIME[mime];
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

// Borra todos los archivos de avatar previos del usuario.
export function removeAvatarFiles(userId: string): void {
  if (!existsSync(avatarsDir())) return;
  for (const name of readdirSync(avatarsDir())) {
    if (name.startsWith(`${userId}.`)) {
      try {
        unlinkSync(path.join(avatarsDir(), name));
      } catch {
        // archivo en uso/ya borrado: ignorar
      }
    }
  }
}

export function validateDisplayName(displayName: string): string {
  const name = displayName.trim();
  if (name.length < 1) throw new Error('El nombre no puede estar vacío.');
  if (name.length > 40) throw new Error('El nombre no puede superar 40 caracteres.');
  return name;
}

// Guarda la foto y devuelve la ruta relativa publica.
function saveAvatarFile(userId: string, dataUrl: string): string {
  ensureAvatarDir();
  const { ext, buffer } = decodeAvatarDataUrl(dataUrl);
  removeAvatarFiles(userId);
  const fileName = `${userId}.${ext}`;
  writeFileSync(path.join(avatarsDir(), fileName), buffer);
  return `/uploads/avatars/${fileName}`;
}

// updateMyProfile: valida, persiste y devuelve la fila actualizada.
export function updateMyProfile(db: Db, userId: string, input: UpdateMyProfileInput): UserRow {
  const displayName = validateDisplayName(input.displayName);
  const remove = Boolean(input.avatarRemove);
  // language opcional: si no llega, COALESCE mantiene el valor actual.
  const language = input.language ?? null;

  if (input.avatarDataUrl) {
    const avatarUrl = saveAvatarFile(userId, input.avatarDataUrl);
    db.prepare(
      'UPDATE users SET display_name = ?, avatar_url = ?, language = COALESCE(?, language) WHERE id = ?'
    ).run(displayName, avatarUrl, language, userId);
  } else if (remove) {
    removeAvatarFiles(userId);
    db.prepare(
      'UPDATE users SET display_name = ?, avatar_url = NULL, language = COALESCE(?, language) WHERE id = ?'
    ).run(displayName, language, userId);
  } else {
    db.prepare('UPDATE users SET display_name = ?, language = COALESCE(?, language) WHERE id = ?').run(
      displayName,
      language,
      userId
    );
  }

  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as unknown as UserRow | undefined;
  if (!row) throw new Error('Usuario no encontrado.');
  return row;
}
