// Recordatorios de actividad (M1): 1h antes del inicio, en la zona horaria del
// viaje, por email a cada miembro y en su idioma (es/en).
//
// El barrido (sweepOnce) es idempotente por item: reminder_sent=1 es terminal,
// asi que un item nunca genera mas de un aviso aunque el intervalo se solape.
// Sin dependencias: la conversion hora-de-pared -> UTC usa Intl.DateTimeFormat.

import type { Db } from './schema-types.ts';
import { sendReminderEmail, type ReminderEmailInput } from './email.ts';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const pad = (n: number): string => String(n).padStart(2, '0');

// Instante (ms) que tendria "la hora de pared en timeZone" si se interpretara
// como UTC. Restarlo del instante real da el offset de la zona.
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
 * Convierte una hora de pared del viaje (day 'YYYY-MM-DD' + hhmm 'HH:MM') en el
 * instante UTC ISO. Resuelve el offset con Intl y hace UNA iteracion de
 * refinamiento (cubre cambios de DST en la frontera).
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

/**
 * Calcula reminder_due_at = inicio - 60min. Si ya no queda al menos 1h (due
 * <= now) devuelve skip: la regla de Marco es no enviar avisos con <1h.
 * Incluye startAt para tests y para distinguir "enviar" de "vencido".
 */
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

/** Ventana de envio: [dueAt, startAt) -> send; >= startAt -> missed. */
export function shouldSendReminder(
  dueAt: string,
  startAt: string,
  nowIso: string,
): 'send' | 'missed' | 'wait' {
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

interface ReminderItemRow {
  id: string;
  trip_id: string;
  title: string;
  day: string | null;
  start_time: string | null;
  reminder_due_at: string;
  trip_name: string;
  trip_timezone: string | null;
}

interface ReminderRecipientRow {
  id: string;
  email: string | null;
  display_name: string | null;
  language: string | null;
}

/**
 * Recalcula la programacion de recordatorio de un item (tras crear/editar/activar).
 * - sin start_time o day: sin programar (sent=0, due=NULL)
 * - recordatorio desactivado: terminal sin envio (sent=1, due=NULL)
 * - inicio a menos de 1h: terminal sin envio (sent=1, due=NULL)
 * - inicio futuro: programado (sent=0, due=inicio-60min)
 */
export function recomputeItemReminder(db: Db, itemId: string, now: Date | string = new Date()): void {
  const row = db.prepare(`
    SELECT i.id, i.day, i.start_time, i.reminder_enabled, t.timezone
    FROM trip_items i
    JOIN trips t ON t.id = i.trip_id
    WHERE i.id = ?
  `).get(itemId) as
    | {
        id: string;
        day: string | null;
        start_time: string | null;
        reminder_enabled: number;
        timezone: string | null;
      }
    | undefined;
  if (!row) return;

  if (!row.reminder_enabled) {
    db.prepare('UPDATE trip_items SET reminder_sent = 1, reminder_due_at = NULL WHERE id = ?').run(itemId);
    return;
  }
  if (!row.day || !row.start_time) {
    db.prepare('UPDATE trip_items SET reminder_sent = 0, reminder_due_at = NULL WHERE id = ?').run(itemId);
    return;
  }

  let computed: ReminderComputation;
  try {
    computed = computeReminderDueAt(row.day, row.start_time, row.timezone ?? 'UTC', now);
  } catch (e) {
    console.error(`[reminders] item ${itemId} sin programar:`, e instanceof Error ? e.message : e);
    db.prepare('UPDATE trip_items SET reminder_sent = 1, reminder_due_at = NULL WHERE id = ?').run(itemId);
    return;
  }
  if (computed.skip) {
    db.prepare('UPDATE trip_items SET reminder_sent = 1, reminder_due_at = NULL WHERE id = ?').run(itemId);
  } else {
    db.prepare('UPDATE trip_items SET reminder_sent = 0, reminder_due_at = ? WHERE id = ?')
      .run(computed.dueAt, itemId);
  }
}

/**
 * Barrido de recordatorios. Envia a cada miembro (owner/editor/viewer) con email
 * no vacio, en su idioma. Un fallo de envio no interrumpe el resto. El sender es
 * inyectable para tests (default: Resend real); now tambien es inyectable.
 */
export async function sweepOnce(
  db: Db,
  sender: ReminderSender = sendReminderEmail,
  now: Date | string = new Date(),
): Promise<SweepResult> {
  const nowIso = typeof now === 'string' ? new Date(now).toISOString() : now.toISOString();
  const rows = db.prepare(`
    SELECT i.id, i.trip_id, i.title, i.day, i.start_time, i.reminder_due_at,
           t.name AS trip_name, t.timezone AS trip_timezone
    FROM trip_items i
    JOIN trips t ON t.id = i.trip_id
    WHERE i.reminder_enabled = 1
      AND i.reminder_sent = 0
      AND i.reminder_due_at IS NOT NULL
  `).all() as unknown as ReminderItemRow[];

  const result: SweepResult = { scanned: rows.length, sent: 0, missed: 0, skipped: 0, failed: 0 };

  for (const item of rows) {
    let startAt: string;
    try {
      if (!item.day || !item.start_time) throw new Error('sin day/start_time');
      startAt = wallTimeToUtcIso(item.day, item.start_time, item.trip_timezone ?? 'UTC');
    } catch (e) {
      result.skipped++;
      db.prepare('UPDATE trip_items SET reminder_sent = 1, reminder_due_at = NULL WHERE id = ?').run(item.id);
      console.log(`[reminders] item ${item.id} omitido:`, e instanceof Error ? e.message : e);
      continue;
    }

    const decision = shouldSendReminder(item.reminder_due_at, startAt, nowIso);
    if (decision === 'wait') continue;

    if (decision === 'missed') {
      db.prepare('UPDATE trip_items SET reminder_sent = 1 WHERE id = ?').run(item.id);
      result.missed++;
      console.log(`[reminders] item ${item.id} vencido sin enviar (inicio ${startAt})`);
      continue;
    }

    const recipients = db.prepare(`
      SELECT u.id, u.email, u.display_name, u.language
      FROM trip_members m
      JOIN users u ON u.id = m.user_id
      WHERE m.trip_id = ?
    `).all(item.trip_id) as unknown as ReminderRecipientRow[];

    let delivered = 0;
    for (const user of recipients) {
      const to = user.email?.trim();
      if (!to) continue;
      try {
        await sender({
          to,
          language: user.language,
          tripName: item.trip_name,
          itemTitle: item.title,
          day: item.day,
          startTime: item.start_time,
        });
        delivered++;
      } catch (e) {
        result.failed++;
        // Nunca loguear el email ni la key: solo el id de usuario y el motivo.
        console.error(
          `[reminders] item ${item.id} fallo para user ${user.id}:`,
          e instanceof Error ? e.message : e,
        );
      }
    }

    // Terminal incluso con fallos parciales: evita duplicados a quien ya recibio.
    db.prepare('UPDATE trip_items SET reminder_sent = 1 WHERE id = ?').run(item.id);
    result.sent++;
    console.log(`[reminders] item ${item.id} enviado a ${delivered} miembro(s)`);
  }

  return result;
}
