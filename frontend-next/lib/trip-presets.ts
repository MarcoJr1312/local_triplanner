import type { LucideIcon } from 'lucide-react';
import { Flame, Mountain, Rose, Snowflake, Sun, Sunrise, Trees, WavesHorizontal } from 'lucide-react';
import type { TranslationKey } from './i18n';

// Portadas de viaje (M2): presets de gradiente espejo del backend
// (local/server/src/covers.ts) + resolución foto/preset/default. Los ids son
// estables y validados por el backend; aquí solo se renderiza el gradiente.

export interface TripCoverPreset {
  id: string;
  nameKey: TranslationKey;
  gradient: string;
  icon: LucideIcon;
}

export const TRIP_COVER_PRESETS: TripCoverPreset[] = [
  {
    id: 'violet-sunset',
    nameKey: 'cover.preset.violetSunset',
    gradient: 'bg-gradient-to-br from-brand-400 via-brand-600 to-brand-900',
    icon: Sun,
  },
  {
    id: 'ocean-dawn',
    nameKey: 'cover.preset.oceanDawn',
    gradient: 'bg-gradient-to-br from-sky-400 via-sky-500 to-blue-800',
    icon: WavesHorizontal,
  },
  {
    id: 'forest-mist',
    nameKey: 'cover.preset.forestMist',
    gradient: 'bg-gradient-to-br from-emerald-400 via-emerald-600 to-teal-900',
    icon: Trees,
  },
  {
    id: 'ember-night',
    nameKey: 'cover.preset.emberNight',
    gradient: 'bg-gradient-to-br from-amber-500 via-orange-600 to-red-900',
    icon: Flame,
  },
  {
    id: 'rose-glow',
    nameKey: 'cover.preset.roseGlow',
    gradient: 'bg-gradient-to-br from-rose-400 via-pink-500 to-fuchsia-900',
    icon: Rose,
  },
  {
    id: 'golden-hour',
    nameKey: 'cover.preset.goldenHour',
    gradient: 'bg-gradient-to-br from-amber-300 via-orange-400 to-amber-700',
    icon: Sunrise,
  },
  {
    id: 'nordic-frost',
    nameKey: 'cover.preset.nordicFrost',
    gradient: 'bg-gradient-to-br from-cyan-300 via-sky-500 to-indigo-900',
    icon: Snowflake,
  },
  {
    id: 'mono-ink',
    nameKey: 'cover.preset.monoInk',
    gradient: 'bg-gradient-to-br from-neutral-500 via-neutral-700 to-neutral-950',
    icon: Mountain,
  },
];

const PRESET_BY_ID = new Map(TRIP_COVER_PRESETS.map((p) => [p.id, p]));

// Gradiente determinista por destino (comportamiento por defecto, idéntico al
// que TripCard/hero usaban antes de las portadas).
const COVER_GRADIENTS = [
  'linear-gradient(135deg, #6C3BFF 0%, #9D7CFF 100%)',
  'linear-gradient(135deg, #2563EB 0%, #38BDF8 100%)',
  'linear-gradient(135deg, #0D9488 0%, #22D3EE 100%)',
  'linear-gradient(135deg, #D97706 0%, #FBBF24 100%)',
  'linear-gradient(135deg, #DB2777 0%, #FB7185 100%)',
  'linear-gradient(135deg, #4338CA 0%, #818CF8 100%)',
];

function hashString(value: string): number {
  let hash = 0;
  for (const ch of value) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(hash);
}

export function destinationGradient(name: string): string {
  const key = name.trim().toLowerCase();
  return COVER_GRADIENTS[hashString(key) % COVER_GRADIENTS.length] ?? COVER_GRADIENTS[0];
}

export type TripCoverKind = 'photo' | 'preset' | 'default';

export interface TripCoverResult {
  kind: TripCoverKind;
  // 'preset': clases Tailwind del gradiente; 'default': gradiente CSS lineal.
  gradient: string | null;
  icon: LucideIcon | null;
  photoUrl: string | null;
}

export function getTripCover(trip: {
  coverPhotoUrl?: string | null;
  coverPreset?: string | null;
  name?: string | null;
  destinationName?: string | null;
}): TripCoverResult {
  if (trip.coverPhotoUrl) {
    return { kind: 'photo', gradient: null, icon: null, photoUrl: trip.coverPhotoUrl };
  }
  if (trip.coverPreset) {
    const preset = PRESET_BY_ID.get(trip.coverPreset);
    if (preset) {
      return { kind: 'preset', gradient: preset.gradient, icon: preset.icon, photoUrl: null };
    }
  }
  return {
    kind: 'default',
    gradient: destinationGradient(trip.destinationName ?? trip.name ?? ''),
    icon: null,
    photoUrl: null,
  };
}
