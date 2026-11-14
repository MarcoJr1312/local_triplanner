// Trip cover photos on Storage. Presets are pure ids validated by the backend.

import { randomUUID } from 'node:crypto';
import type { Storage } from '../storage.ts';

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

export async function writeCoverPhoto(
  storage: Storage,
  tripId: string,
  ext: string,
  buffer: Buffer,
): Promise<string> {
  const key = `covers/${tripId}/${randomUUID()}.${ext}`;
  await storage.put(key, buffer);
  return storage.publicPath(key);
}

export async function removeTripCoverFiles(storage: Storage, tripId: string): Promise<void> {
  await storage.deletePrefix(`covers/${tripId}`);
}
