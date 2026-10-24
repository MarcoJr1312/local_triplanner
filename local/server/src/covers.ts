// Portadas de viaje (M1): presets de gradiente + foto subida por el owner.
// - cover_preset: id de un gradiente permitido (lista cerrada). El frontend
//   tiene sus gradientes; el backend SOLO valida el id.
// - cover_photo_url: ruta relativa /uploads/covers/<tripId>/<uuid>.<ext>.
//   La foto usa las MISMAS validaciones que los avatares (decodeAvatarDataUrl).

import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { UPLOADS_DIR } from './profile.ts';

// Presets permitidos (ids estables; el frontend renderiza el gradiente).
export const COVER_PRESETS = [
  'violet-sunset',
  'ocean-dawn',
  'forest-mist',
  'ember-night',
  'rose-glow',
  'golden-hour',
  'nordic-frost',
  'mono-ink',
] as const;

export type CoverPreset = (typeof COVER_PRESETS)[number];

export function isValidCoverPreset(value: unknown): value is CoverPreset {
  return typeof value === 'string' && (COVER_PRESETS as readonly string[]).includes(value);
}

function coversBase(): string {
  const base = process.env.TRIPLANNER_UPLOADS_OVERRIDE
    ? path.resolve(process.env.TRIPLANNER_UPLOADS_OVERRIDE)
    : UPLOADS_DIR;
  return path.join(base, 'covers');
}

function tripCoverDir(tripId: string): string {
  return path.join(coversBase(), tripId);
}

// Escribe la foto de portada y devuelve la ruta relativa publica.
// (validacion del data URL ya hecha por el llamador via decodeAvatarDataUrl).
export function writeCoverPhoto(tripId: string, ext: string, buffer: Buffer): string {
  const dir = tripCoverDir(tripId);
  mkdirSync(dir, { recursive: true });
  const fileName = `${randomUUID()}.${ext}`;
  writeFileSync(path.join(dir, fileName), buffer);
  return `/uploads/covers/${tripId}/${fileName}`;
}

// Borra todas las fotos de portada del viaje (directorio completo del trip).
export function removeTripCoverFiles(tripId: string): void {
  const dir = tripCoverDir(tripId);
  if (!existsSync(dir)) return;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // archivo en uso/ya borrado: ignorar
  }
}
