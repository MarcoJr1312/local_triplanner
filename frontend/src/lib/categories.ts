export interface CategoryMeta {
  label: string;
  badge: string;
  dot: string;
  bar: string;
  tile: string;
  icon: string;
}

const CATEGORY_META: Record<string, CategoryMeta> = {
  sight: { label: 'Turismo', badge: 'bg-sky-100 text-sky-700', dot: 'bg-sky-500', bar: 'bg-sky-500', tile: 'bg-sky-50', icon: 'text-sky-600' },
  food: { label: 'Comida', badge: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500', bar: 'bg-amber-500', tile: 'bg-amber-50', icon: 'text-amber-600' },
  activity: { label: 'Actividades', badge: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500', bar: 'bg-emerald-500', tile: 'bg-emerald-50', icon: 'text-emerald-600' },
  nightlife: { label: 'Vida nocturna', badge: 'bg-violet-100 text-violet-700', dot: 'bg-violet-500', bar: 'bg-violet-500', tile: 'bg-violet-50', icon: 'text-violet-600' },
  transporte: { label: 'Transporte', badge: 'bg-slate-200 text-slate-700', dot: 'bg-slate-500', bar: 'bg-slate-500', tile: 'bg-slate-100', icon: 'text-slate-600' },
  alojamiento: { label: 'Alojamiento', badge: 'bg-rose-100 text-rose-700', dot: 'bg-rose-500', bar: 'bg-rose-500', tile: 'bg-rose-50', icon: 'text-rose-600' },
};

const FALLBACK: CategoryMeta = {
  label: 'Otro',
  badge: 'bg-slate-100 text-slate-600',
  dot: 'bg-slate-400',
  bar: 'bg-slate-400',
  tile: 'bg-slate-100',
  icon: 'text-slate-500',
};

export function categoryMeta(category: string): CategoryMeta {
  return CATEGORY_META[category] ?? { ...FALLBACK, label: capitalize(category) };
}

export const CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: 'sight', label: 'Turismo' },
  { value: 'food', label: 'Comida' },
  { value: 'activity', label: 'Actividades' },
  { value: 'nightlife', label: 'Vida nocturna' },
  { value: 'transporte', label: 'Transporte' },
  { value: 'alojamiento', label: 'Alojamiento' },
];

export function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}
