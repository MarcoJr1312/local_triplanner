// Helpers de formato para la informacion de lugares (compartidos entre el
// buscador y el modal de detalle del item guardado).

// Horarios: el catalogo puede devolver varias formas. La forma rica es
// {timezone, days: [{day, time, date}]}. Mostramos defensivamente.
export function formatHours(hours: unknown): string | null {
  if (!hours) return null;
  if (typeof hours === 'string') return hours;
  if (!Array.isArray(hours) && typeof hours === 'object') {
    const o = hours as Record<string, unknown>;
    if (Array.isArray(o.days) && o.days.length) {
      const first = o.days[0] as Record<string, unknown> | null | undefined;
      if (first) {
        const day = (first.day ?? first.weekday ?? null) as string | null;
        const t = (first.time ?? first.hours ?? first.open ?? null) as string | null;
        if (t) {
          const prefix = day && day !== 'Today' ? `${day}: ` : '';
          return `${prefix}${t}`;
        }
      }
    }
    const entries = Object.entries(o).filter(
      ([, v]) => v != null && v !== '' && v !== 'Cerrado' && v !== 'Closed',
    );
    if (!entries.length) return null;
    const [day, val] = entries[0];
    return `${day}: ${String(val)}`;
  }
  if (Array.isArray(hours)) {
    const lines = hours
      .map((h) => {
        if (typeof h === 'string') return h;
        if (h && typeof h === 'object') {
          const o = h as Record<string, unknown>;
          const day = o.day ?? o.weekday ?? null;
          const hs = o.time ?? o.hours ?? o.open ?? null;
          if (day && hs) return `${day}: ${hs}`;
        }
        return null;
      })
      .filter(Boolean) as string[];
    return lines.length ? lines[0] : null;
  }
  return null;
}

// Lista de dias con horario para la cortina semanal.
// Forma del catalogo: {timezone, days: [{day, time, date}]}
export function hoursDayList(hours: unknown): { day: string; time: string; isToday: boolean }[] | null {
  if (!hours || typeof hours !== 'object' || Array.isArray(hours)) return null;
  const o = hours as Record<string, unknown>;
  if (!Array.isArray(o.days) || !o.days.length) return null;
  const today = new Date().toISOString().slice(0, 10);
  const list = (o.days as unknown[])
    .map((d) => {
      if (!d || typeof d !== 'object') return null;
      const dd = d as Record<string, unknown>;
      const day = dd.day ?? dd.weekday ?? null;
      const time = dd.time ?? dd.hours ?? dd.open ?? null;
      if (!day || !time) return null;
      const date = typeof dd.date === 'string' ? dd.date.slice(0, 10) : null;
      return { day: String(day), time: String(time), isToday: date != null && date === today };
    })
    .filter(Boolean) as { day: string; time: string; isToday: boolean }[];
  return list.length ? list : null;
}

export function socialLinkList(links: unknown): { title: string; url: string }[] {
  if (!Array.isArray(links)) return [];
  return links
    .map((l) => {
      if (!l || typeof l !== 'object') return null;
      const o = l as Record<string, unknown>;
      const title = (o.title ?? o.name ?? null) as string | null;
      const url = (o.url ?? o.link ?? o.website ?? null) as string | null;
      return title && url ? { title, url } : null;
    })
    .filter(Boolean) as { title: string; url: string }[];
}
