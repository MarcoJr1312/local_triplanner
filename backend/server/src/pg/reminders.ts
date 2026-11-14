// Postgres port of reminders.ts. Pure time math and the decision helpers are
// shared with the SQLite version; only the queries change.

import {
  computeReminderDueAt,
  shouldSendReminder,
  wallTimeToUtcIso,
  type ReminderComputation,
  type ReminderSender,
  type SweepResult,
} from '../reminders.ts';
import type { AsyncDb } from './db.ts';

interface ReminderItemRow {
  id: string;
  trip_id: string;
  title: string;
  day: string | null;
  start_time: string | null;
  reminder_due_at: string | null;
  trip_name: string;
  trip_timezone: string | null;
}

interface ReminderRecipientRow {
  id: string;
  email: string | null;
  display_name: string | null;
  language: string | null;
}

/** Recomputes one item's schedule after create/edit/toggle (same rules as SQLite). */
export async function recomputeItemReminder(
  db: AsyncDb,
  itemId: string,
  now: Date | string = new Date(),
): Promise<void> {
  const row = await db
    .prepare(
      `SELECT i.id, i.day, i.start_time, i.reminder_enabled, t.timezone
       FROM trip_items i
       JOIN trips t ON t.id = i.trip_id
       WHERE i.id = ?`,
    )
    .get<{ id: string; day: string | null; start_time: string | null; reminder_enabled: number; timezone: string | null }>(
      itemId,
    );
  if (!row) return;

  if (!row.reminder_enabled) {
    await db.prepare('UPDATE trip_items SET reminder_sent = 1, reminder_due_at = NULL WHERE id = ?').run(itemId);
    return;
  }
  if (!row.day || !row.start_time) {
    await db.prepare('UPDATE trip_items SET reminder_sent = 0, reminder_due_at = NULL WHERE id = ?').run(itemId);
    return;
  }

  let computed: ReminderComputation;
  try {
    computed = computeReminderDueAt(row.day, row.start_time, row.timezone ?? 'UTC', now);
  } catch (e) {
    console.error(`[reminders] item ${itemId} sin programar:`, e instanceof Error ? e.message : e);
    await db.prepare('UPDATE trip_items SET reminder_sent = 1, reminder_due_at = NULL WHERE id = ?').run(itemId);
    return;
  }

  if (computed.skip) {
    await db.prepare('UPDATE trip_items SET reminder_sent = 1, reminder_due_at = NULL WHERE id = ?').run(itemId);
  } else {
    await db
      .prepare('UPDATE trip_items SET reminder_sent = 0, reminder_due_at = ? WHERE id = ?')
      .run(computed.dueAt, itemId);
  }
}

/**
 * One reminder sweep. Sends at most once per item (reminder_sent=1 is terminal),
 * in each member's language. A delivery failure never aborts the sweep.
 */
export async function sweepOnce(
  db: AsyncDb,
  sender: ReminderSender,
  now: Date | string = new Date(),
): Promise<SweepResult> {
  const nowIso = typeof now === 'string' ? new Date(now).toISOString() : now.toISOString();
  const rows = await db
    .prepare(
      `SELECT i.id, i.trip_id, i.title, i.day, i.start_time, i.reminder_due_at,
              t.name AS trip_name, t.timezone AS trip_timezone
       FROM trip_items i
       JOIN trips t ON t.id = i.trip_id
       WHERE i.reminder_enabled = 1
         AND i.reminder_sent = 0
         AND i.reminder_due_at IS NOT NULL`,
    )
    .all<ReminderItemRow>();

  const result: SweepResult = { scanned: rows.length, sent: 0, missed: 0, skipped: 0, failed: 0 };

  for (const item of rows) {
    let startAt: string;
    try {
      if (!item.day || !item.start_time) throw new Error('sin day/start_time');
      startAt = wallTimeToUtcIso(item.day, item.start_time, item.trip_timezone ?? 'UTC');
    } catch (e) {
      result.skipped++;
      await db.prepare('UPDATE trip_items SET reminder_sent = 1, reminder_due_at = NULL WHERE id = ?').run(item.id);
      console.log(`[reminders] item ${item.id} omitido:`, e instanceof Error ? e.message : e);
      continue;
    }

    const dueAt = item.reminder_due_at;
    if (!dueAt) continue;
    const decision = shouldSendReminder(dueAt, startAt, nowIso);
    if (decision === 'wait') continue;

    if (decision === 'missed') {
      await db.prepare('UPDATE trip_items SET reminder_sent = 1 WHERE id = ?').run(item.id);
      result.missed++;
      console.log(`[reminders] item ${item.id} vencido sin enviar (inicio ${startAt})`);
      continue;
    }

    const recipients = await db
      .prepare(
        `SELECT u.id, u.email, u.display_name, u.language
         FROM trip_members m
         JOIN users u ON u.id = m.user_id
         WHERE m.trip_id = ?`,
      )
      .all<ReminderRecipientRow>(item.trip_id);

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
        // Never log the email or the key: only the user id and the reason.
        console.error(`[reminders] item ${item.id} fallo para user ${user.id}:`, e instanceof Error ? e.message : e);
      }
    }

    // Terminal even after partial failures: never duplicate to those who got it.
    await db.prepare('UPDATE trip_items SET reminder_sent = 1 WHERE id = ?').run(item.id);
    result.sent++;
    console.log(`[reminders] item ${item.id} enviado a ${delivered} miembro(s)`);
  }

  return result;
}
