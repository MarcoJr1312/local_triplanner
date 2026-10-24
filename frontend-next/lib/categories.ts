import { es } from './i18n/es';
import type { TranslationKey } from './i18n';

export interface CategoryMeta {
  // Clave del diccionario con el label traducible; null para categorías
  // desconocidas (el caller debe caer a `label`/capitalize).
  labelKey: TranslationKey | null;
  // Label por defecto (español) para consumidores aún no migrados a i18n
  // (M3b). Se resuelve desde el diccionario, no es un literal suelto.
  label: string;
  badge: string;
  dot: string;
  bar: string;
  tile: string;
  icon: string;
}

const CATEGORY_META: Record<string, CategoryMeta> = {
  sight: { labelKey: 'categories.sight', label: es['categories.sight'], badge: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300', dot: 'bg-sky-500', bar: 'bg-sky-500', tile: 'bg-sky-50 dark:bg-sky-500/10', icon: 'text-sky-600 dark:text-sky-400' },
  food: { labelKey: 'categories.food', label: es['categories.food'], badge: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300', dot: 'bg-amber-500', bar: 'bg-amber-500', tile: 'bg-amber-50 dark:bg-amber-500/10', icon: 'text-amber-600 dark:text-amber-400' },
  activity: { labelKey: 'categories.activity', label: es['categories.activity'], badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300', dot: 'bg-emerald-500', bar: 'bg-emerald-500', tile: 'bg-emerald-50 dark:bg-emerald-500/10', icon: 'text-emerald-600 dark:text-emerald-400' },
  nightlife: { labelKey: 'categories.nightlife', label: es['categories.nightlife'], badge: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300', dot: 'bg-violet-500', bar: 'bg-violet-500', tile: 'bg-violet-50 dark:bg-violet-500/10', icon: 'text-violet-600 dark:text-violet-400' },
  transporte: { labelKey: 'categories.transporte', label: es['categories.transporte'], badge: 'bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300', dot: 'bg-slate-500', bar: 'bg-slate-500', tile: 'bg-slate-100 dark:bg-slate-500/10', icon: 'text-slate-600 dark:text-slate-400' },
  alojamiento: { labelKey: 'categories.alojamiento', label: es['categories.alojamiento'], badge: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300', dot: 'bg-rose-500', bar: 'bg-rose-500', tile: 'bg-rose-50 dark:bg-rose-500/10', icon: 'text-rose-600 dark:text-rose-400' },
};

const FALLBACK: CategoryMeta = {
  labelKey: null,
  label: es['categories.other'],
  badge: 'bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300',
  dot: 'bg-slate-400',
  bar: 'bg-slate-400',
  tile: 'bg-slate-100 dark:bg-slate-500/10',
  icon: 'text-slate-500 dark:text-slate-400',
};

export function categoryMeta(category: string): CategoryMeta {
  return CATEGORY_META[category] ?? { ...FALLBACK, label: capitalize(category) };
}

export const CATEGORY_OPTIONS: { value: string; labelKey: TranslationKey; label: string }[] = [
  { value: 'sight', labelKey: 'categories.sight', label: es['categories.sight'] },
  { value: 'food', labelKey: 'categories.food', label: es['categories.food'] },
  { value: 'activity', labelKey: 'categories.activity', label: es['categories.activity'] },
  { value: 'nightlife', labelKey: 'categories.nightlife', label: es['categories.nightlife'] },
  { value: 'transporte', labelKey: 'categories.transporte', label: es['categories.transporte'] },
  { value: 'alojamiento', labelKey: 'categories.alojamiento', label: es['categories.alojamiento'] },
];

export function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}
