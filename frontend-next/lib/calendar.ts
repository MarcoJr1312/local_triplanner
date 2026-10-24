// Utilidades puras de calendario (M1). Sin dependencias externas y sin
// efectos: todo se resuelve con Intl y Date en hora LOCAL para evitar el
// desfase de un día que introduce `toISOString()` en zonas con offset.

// El orden cronológico del día vive en lib/sorting.ts (única fuente, compartida
// con el selector de orden del itinerario). Se re-exporta aquí para no romper a
// los consumidores existentes del calendario.
export { sortDayItems } from './sorting';

// Primer día de la semana (0=domingo … 6=sábado) para el locale dado.
// Intl.Locale.weekInfo.firstDay expone 1=lunes … 7=domingo; lo normalizamos
// con `% 7`. Si el runtime no soporta weekInfo, caemos a la convención:
// español → lunes (1), resto → domingo (0).
export function weekStartsOn(locale: string): number {
  try {
    const LocaleCtor = (Intl as unknown as { Locale?: new (tag: string) => unknown }).Locale;
    if (LocaleCtor) {
      const loc = new LocaleCtor(locale) as { weekInfo?: { firstDay?: number } };
      const firstDay = loc.weekInfo?.firstDay;
      if (typeof firstDay === 'number' && firstDay >= 1 && firstDay <= 7) {
        return firstDay % 7;
      }
    }
  } catch {
    // Locale inválido o weekInfo ausente: usamos el fallback.
  }
  return locale.startsWith('es') ? 1 : 0;
}

// Matriz de semanas del mes: cada fila son 7 fechas locales que cubren el mes
// `monthIndex` (0-11) más los días adyacentes del mes anterior/siguiente
// necesarios para completar la semana. Mínimo 5 filas para estabilizar la
// altura de la grilla en todos los meses.
export function monthMatrix(year: number, monthIndex: number, weekStart: number): Date[][] {
  const first = new Date(year, monthIndex, 1);
  // Días desde el inicio de la semana hasta el día 1 del mes.
  const offset = (first.getDay() - weekStart + 7) % 7;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const rowsNeeded = Math.ceil((offset + daysInMonth) / 7);
  const rows = Math.max(rowsNeeded, 5);

  const weeks: Date[][] = [];
  for (let w = 0; w < rows; w++) {
    const row: Date[] = [];
    for (let d = 0; d < 7; d++) {
      const dayNumber = 1 - offset + w * 7 + d;
      // El constructor normaliza meses/años fuera de rango (hora local).
      row.push(new Date(year, monthIndex, dayNumber));
    }
    weeks.push(row);
  }
  return weeks;
}

// Etiqueta "noviembre 2026": mes largo + año, sin la preposición "de" que
// Intl inserta en español. Capitaliza la inicial.
export function monthLabel(date: Date, locale: string): string {
  const intlLocale = locale === 'en' ? 'en-US' : 'es';
  const parts = new Intl.DateTimeFormat(intlLocale, {
    month: 'long',
    year: 'numeric',
  }).formatToParts(date);
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  const year = parts.find((p) => p.type === 'year')?.value ?? '';
  const label = `${month} ${year}`.trim();
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// 7 etiquetas narrow ("L M X J V S D") en el orden de la semana del locale.
export function weekdayLabels(locale: string): string[] {
  const intlLocale = locale === 'en' ? 'en-US' : 'es';
  const weekStart = weekStartsOn(locale);
  const fmt = new Intl.DateTimeFormat(intlLocale, { weekday: 'narrow' });
  // 2023-01-01 fue domingo: lo usamos como ancla para generar los 7 días.
  const labels: string[] = [];
  for (let i = 0; i < 7; i++) {
    const offset = (weekStart + i) % 7;
    labels.push(fmt.format(new Date(2023, 0, 1 + offset)));
  }
  return labels;
}

// 'yyyy-mm-dd' EN LOCAL, construido a mano (PROHIBIDO toISOString, que
// convertiría a UTC y podría devolver el día anterior/siguiente).
export function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

