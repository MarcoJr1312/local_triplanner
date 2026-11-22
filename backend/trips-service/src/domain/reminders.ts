// Reminder time math, ported from the API. Kept pure and dependency-free.
// A reminder is due 60 minutes before the item; if less than an hour remains,
// it is skipped rather than sent late.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

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
    const part = parts.find((candidate) => candidate.type === type);
    return part ? Number(part.value) : Number.NaN;
  };

  return Date.UTC(
    value('year'),
    value('month') - 1,
    value('day'),
    value('hour'),
    value('minute'),
    value('second'),
  );
}

export function wallTimeToUtcIso(dateStr: string, hhmm: string, timeZone: string): string {
  if (!DATE_RE.test(dateStr)) throw new Error(`Fecha inválida: ${dateStr}`);
  if (!TIME_RE.test(hhmm)) throw new Error(`Hora inválida: ${hhmm}`);

  const timeZoneName = timeZone.trim() || 'UTC';
  const naiveMs = Date.parse(`${dateStr}T${hhmm}:00Z`);
  if (!Number.isFinite(naiveMs)) throw new Error(`Fecha/hora inválida: ${dateStr} ${hhmm}`);

  const offset = wallClockAsUtcMs(naiveMs, timeZoneName) - naiveMs;
  let instantMs = naiveMs - offset;
  const refined = wallClockAsUtcMs(instantMs, timeZoneName) - instantMs;
  if (refined !== offset) instantMs = naiveMs - refined;

  return new Date(instantMs).toISOString();
}

export type ReminderComputation =
  | { skip: true; startAt: string }
  | { skip: false; dueAt: string; startAt: string };

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

  if (!Number.isFinite(nowMs) || Date.parse(dueAt) <= nowMs) {
    return { skip: true, startAt };
  }
  return { skip: false, dueAt, startAt };
}
