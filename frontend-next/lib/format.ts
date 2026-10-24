import type { AWSDate } from './types';
import type { Locale } from './i18n';

// Locales Intl por idioma de UI. El default `es` mantiene el comportamiento
// previo para los componentes aún no migrados (M3b).
function dateLocale(locale: Locale): string {
  return locale === 'en' ? 'en-US' : 'es';
}

function numberLocale(locale: Locale): string {
  return locale === 'en' ? 'en-US' : 'es-MX';
}

export function formatMoney(amount: number, decimals = 0, locale: Locale = 'es'): string {
  const rounded = Math.round(amount * 100) / 100;
  return new Intl.NumberFormat(numberLocale(locale), {
    style: 'currency',
    currency: 'USD',
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  }).format(rounded);
}

export function parseDate(value: AWSDate): Date {
  return new Date(`${value}T00:00:00`);
}

export function formatDate(value: AWSDate, locale: Locale = 'es'): string {
  return parseDate(value).toLocaleDateString(dateLocale(locale), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateShort(value: AWSDate, locale: Locale = 'es'): string {
  return parseDate(value).toLocaleDateString(dateLocale(locale), {
    day: 'numeric',
    month: 'short',
  });
}

export function formatWeekday(value: AWSDate, locale: Locale = 'es'): string {
  return parseDate(value).toLocaleDateString(dateLocale(locale), { weekday: 'long' });
}

export function formatDateRange(start: AWSDate, end: AWSDate, locale: Locale = 'es'): string {
  if (start === end) return formatDate(start, locale);
  const sameMonth = parseDate(start).getMonth() === parseDate(end).getMonth();
  const sameYear = parseDate(start).getFullYear() === parseDate(end).getFullYear();
  if (sameYear && sameMonth) {
    const startDay = parseDate(start).toLocaleDateString(dateLocale(locale), { day: 'numeric' });
    const endLabel = parseDate(end).toLocaleDateString(dateLocale(locale), {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    return `${startDay} – ${endLabel}`;
  }
  return `${formatDate(start, locale)} – ${formatDate(end, locale)}`;
}

export function listDays(start: AWSDate, end: AWSDate): AWSDate[] {
  const out: AWSDate[] = [];
  const d = parseDate(start);
  const e = parseDate(end);
  while (d.getTime() <= e.getTime()) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export function toIsoDate(d: Date): AWSDate {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

export function inviteCodeFor(tripId: string): string {
  const seed = tripId.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const base = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += base[(seed + i * 7) % base.length];
  }
  return code;
}
