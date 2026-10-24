// Orden de la lista de actividades del día (M1): los modos que el usuario
// puede elegir en la vista de itinerario + su persistencia en localStorage.
//
// `sortDayItems` es el orden cronológico base (hora ascendente, sin-hora al
// final, desempate por `order`). Vive aquí para que exista UNA sola fuente de
// la lógica de orden; `lib/calendar.ts` la re-exporta por compatibilidad.

export type SortMode = 'manual' | 'time-asc' | 'time-desc' | 'price-asc' | 'price-desc';

// Orden de presentación en el selector (no alfabético): el orden manual primero.
export const SORT_MODES: readonly SortMode[] = [
  'manual',
  'time-asc',
  'time-desc',
  'price-asc',
  'price-desc',
];

export function isSortMode(value: unknown): value is SortMode {
  return typeof value === 'string' && (SORT_MODES as readonly string[]).includes(value);
}

type Sortable = {
  startTime?: string | null;
  order?: number | null;
  cost?: number | null;
};

// HH:MM es comparable como string. Ascendente con las sin-hora SIEMPRE al
// final (nunca arriba), independientemente del modo.
function compareTimeAsc(a: Sortable, b: Sortable): number {
  const at = a.startTime ?? null;
  const bt = b.startTime ?? null;
  if (at && bt) {
    if (at < bt) return -1;
    if (at > bt) return 1;
    return 0;
  }
  if (at && !bt) return -1;
  if (!at && bt) return 1;
  return 0;
}

// Descendente entre actividades CON hora, pero las sin-hora siguen al final.
function compareTimeDesc(a: Sortable, b: Sortable): number {
  const at = a.startTime ?? null;
  const bt = b.startTime ?? null;
  if (at && bt) {
    if (at > bt) return -1;
    if (at < bt) return 1;
    return 0;
  }
  if (at && !bt) return -1;
  if (!at && bt) return 1;
  return 0;
}

function compareOrder(a: Sortable, b: Sortable): number {
  return (a.order ?? 0) - (b.order ?? 0);
}

// Orden cronológico del itinerario (equivalente al modo 'manual'/'time-asc'):
// por startTime ascendente dejando al final las actividades sin hora; a igual
// hora (o ambas sin hora) desempata por `order` ascendente.
export function sortDayItems<T extends Sortable>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const time = compareTimeAsc(a, b);
    return time !== 0 ? time : compareOrder(a, b);
  });
}

// Ordena una copia de `items` según `mode` (nunca muta el arreglo original).
// `Array.prototype.sort` es estable, así que los empates no listados conservan
// el orden de entrada.
export function sortItemsBy<T extends Sortable>(items: T[], mode: SortMode): T[] {
  const copy = [...items];
  switch (mode) {
    case 'manual':
    case 'time-asc':
      return copy.sort((a, b) => {
        const time = compareTimeAsc(a, b);
        return time !== 0 ? time : compareOrder(a, b);
      });
    case 'time-desc':
      return copy.sort((a, b) => {
        const time = compareTimeDesc(a, b);
        return time !== 0 ? time : compareOrder(a, b);
      });
    case 'price-asc':
      return copy.sort((a, b) => {
        const cost = (a.cost ?? 0) - (b.cost ?? 0);
        if (cost !== 0) return cost;
        const time = compareTimeAsc(a, b);
        return time !== 0 ? time : compareOrder(a, b);
      });
    case 'price-desc':
      return copy.sort((a, b) => {
        const cost = (b.cost ?? 0) - (a.cost ?? 0);
        if (cost !== 0) return cost;
        const time = compareTimeAsc(a, b);
        return time !== 0 ? time : compareOrder(a, b);
      });
    default:
      return sortDayItems(items);
  }
}

const SORT_STORAGE_PREFIX = 'sortMode:';

// Lee el modo guardado para un viaje; cualquier valor ausente/inválido o el
// fallo de localStorage (SSR, modo privado, cuota) cae a 'manual'.
export function loadSortMode(tripId: string): SortMode {
  if (typeof window === 'undefined') return 'manual';
  try {
    const raw = window.localStorage.getItem(SORT_STORAGE_PREFIX + tripId);
    return isSortMode(raw) ? raw : 'manual';
  } catch {
    return 'manual';
  }
}

// Persiste el modo del viaje; los fallos de localStorage se ignoran en
// silencio (el estado en memoria es suficiente para la sesión).
export function saveSortMode(tripId: string, mode: SortMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SORT_STORAGE_PREFIX + tripId, mode);
  } catch {
    // localStorage no disponible: se ignora.
  }
}
