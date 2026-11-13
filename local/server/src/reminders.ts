// Reminder time math. Persistence and the sweep live in pg/reminders.
// The wall-clock -> UTC conversion uses Intl only (no dependencies).

import type { ReminderEmailInput } from './email.ts';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// Instant (ms) the wall clock in timeZone would have if read as UTC. Subtracting
// it from the real instant gives the zone offset.
function wallClockAsUtcMs(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instantMs));
  const value = (type: string): number => {
    const part = parts.find((p) => p.type === type);
    return part ? Number(part.value) : NaN;
  };
  return Date.UTC(value('year'), value('month') - 1, value('day'), value('hour'), value('minute'), value('second'));
}

/**
 * Converts a trip wall time (day 'YYYY-MM-DD' + hhmm 'HH:MM') to a UTC ISO
 * instant, resolving the offset with Intl and refining once for DST edges.
 */
export function wallTimeToUtcIso(dateStr: string, hhmm: string, timeZone: string): string {
  if (!DATE_RE.test(dateStr)) throw new Error(`Fecha inválida: ${dateStr}`);
  if (!TIME_RE.test(hhmm)) throw new Error(`Hora inválida: ${hhmm}`);
  const tz = timeZone?.trim() || 'UTC';
  const naiveMs = Date.parse(`${dateStr}T${hhmm}:00Z`);
  if (!Number.isFinite(naiveMs)) throw new Error(`Fecha/hora inválida: ${dateStr} ${hhmm}`);

  const offset = wallClockAsUtcMs(naiveMs, tz) - naiveMs;
  let instantMs = naiveMs - offset;
  const refinedOffset = wallClockAsUtcMs(instantMs, tz) - instantMs;
  if (refinedOffset !== offset) instantMs = naiveMs - refinedOffset;
  return new Date(instantMs).toISOString();
}

export type ReminderComputation =
  | { skip: true; startAt: string }
  | { skip: false; dueAt: string; startAt: string };

/** due_at = start - 60 min. If less than an hour remains, skip (never send late). */
export function computeReminderDueAt(
  dateStr: string,
  hhmm: string,
  timeZone: string,
  now: Date | string = new Date(),
): ReminderComputation {
  const startAt = wallTimeToUtcIso(dateStr, hhmm, timeZone);
  const startMs = Date.parse(startAt);
  const nowMs = typeof now === 'string' ? Date.parse(now) : now.getTime();
  const dueAt = new Date(startMs - 60 * 60_000).toISOString();
  if (!Number.isFinite(nowMs) || Date.parse(dueAt) <= nowMs) return { skip: true, startAt };
  return { skip: false, dueAt, startAt };
}

/** Send window: [dueAt, startAt) -> send; >= startAt -> missed. */
export function shouldSendReminder(dueAt: string, startAt: string, nowIso: string): 'send' | 'missed' | 'wait' {
  const dueMs = Date.parse(dueAt);
  const startMs = Date.parse(startAt);
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(dueMs) || !Number.isFinite(startMs) || !Number.isFinite(nowMs)) return 'wait';
  if (nowMs >= startMs) return 'missed';
  if (nowMs >= dueMs) return 'send';
  return 'wait';
}

export type ReminderSender = (input: ReminderEmailInput) => Promise<unknown> | unknown;

export interface SweepResult {
  scanned: number;
  sent: number;
  missed: number;
  skipped: number;
  failed: number;
}
