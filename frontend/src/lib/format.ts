import type { AWSDate } from './types';

export function formatMoney(amount: number, decimals = 0): string {
  const rounded = Math.round(amount * 100) / 100;
  return (
    '$' +
    rounded.toLocaleString('es-MX', {
      minimumFractionDigits: 0,
      maximumFractionDigits: decimals,
    })
  );
}

export function parseDate(value: AWSDate): Date {
  return new Date(`${value}T00:00:00`);
}

export function formatDate(value: AWSDate): string {
  return parseDate(value).toLocaleDateString('es', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateShort(value: AWSDate): string {
  return parseDate(value).toLocaleDateString('es', {
    day: 'numeric',
    month: 'short',
  });
}

export function formatWeekday(value: AWSDate): string {
  return parseDate(value).toLocaleDateString('es', { weekday: 'long' });
}

export function formatDateRange(start: AWSDate, end: AWSDate): string {
  if (start === end) return formatDate(start);
  const sameMonth = parseDate(start).getMonth() === parseDate(end).getMonth();
  const sameYear = parseDate(start).getFullYear() === parseDate(end).getFullYear();
  if (sameYear && sameMonth) {
    const startDay = parseDate(start).toLocaleDateString('es', { day: 'numeric' });
    const endLabel = parseDate(end).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
    return `${startDay} – ${endLabel}`;
  }
  return `${formatDate(start)} – ${formatDate(end)}`;
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
