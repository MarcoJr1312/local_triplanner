// In-app activity reminder dispatcher. Trips owns the schedule/recipients;
// this facade creates the users-service inbox rows and publishes the live
// notification. One API replica runs the sweep in the local demo.

import type { PubSub } from './resolvers.ts';
import { toNotificationGql } from './resolvers.ts';
import type { TripsStore } from './trips/types.ts';
import type { UsersStore } from './users/types.ts';

export const REMINDER_GRACE_MS = 15 * 60_000;

export interface ReminderSweepDeps {
  trips: TripsStore;
  users: UsersStore;
  pubsub: PubSub;
  now?: () => Date;
  log?: (message: string) => void;
}

export interface ReminderSweepResult {
  due: number;
  created: number;
  alreadyPresent: number;
  expired: number;
  failed: number;
}

export function reminderDedupeKey(
  itemId: string,
  userId: string,
  dueAt: string,
): string {
  return `activity_reminder:${itemId}:${userId}:${dueAt}`;
}

export async function runReminderSweep(
  deps: ReminderSweepDeps,
): Promise<ReminderSweepResult> {
  const now = deps.now?.() ?? new Date();
  const log = deps.log ?? ((message: string) => console.warn(message));
  const result: ReminderSweepResult = {
    due: 0,
    created: 0,
    alreadyPresent: 0,
    expired: 0,
    failed: 0,
  };

  const due = await deps.trips.dueReminders(now.toISOString());
  result.due = due.length;

  for (const reminder of due) {
    const dueMs = Date.parse(reminder.due_at);
    if (!Number.isFinite(dueMs)) continue;

    // Too late: do not send a stale reminder, but stop retrying it.
    if (now.getTime() - dueMs > REMINDER_GRACE_MS) {
      await deps.trips.markRemindersSent(reminder.item_id, reminder.recipient_ids);
      result.expired += reminder.recipient_ids.length;
      continue;
    }

    const sent: string[] = [];
    for (const userId of reminder.recipient_ids) {
      try {
        const notification = await deps.users.createReminderNotification({
          userId,
          tripId: reminder.trip_id,
          tripName: reminder.trip_name,
          itemId: reminder.item_id,
          itemTitle: reminder.item_title,
          startAt: reminder.start_at,
          leadMinutes: reminder.lead_minutes,
          dedupeKey: reminderDedupeKey(reminder.item_id, userId, reminder.due_at),
        });
        if (notification.created) {
          result.created += 1;
          deps.pubsub.publish(`notify:${userId}`, {
            onNotification: toNotificationGql(notification.notification, null),
          });
        } else {
          result.alreadyPresent += 1;
        }
        // Mark even when the dedupe row already existed: it was delivered.
        sent.push(userId);
      } catch (error) {
        result.failed += 1;
        log(
          `[reminders] could not notify ${userId} for ${reminder.item_id}: ` +
            (error instanceof Error ? error.message : String(error)),
        );
      }
    }

    if (sent.length > 0) {
      await deps.trips.markRemindersSent(reminder.item_id, sent);
    }
  }

  return result;
}

export interface ReminderScheduler {
  stop: () => void;
  runOnce: () => Promise<ReminderSweepResult | null>;
}

export function startReminderScheduler(
  deps: ReminderSweepDeps,
  intervalMs: number,
): ReminderScheduler {
  let running = false;
  let stopped = false;

  const runOnce = async (): Promise<ReminderSweepResult | null> => {
    if (running || stopped) return null;
    running = true;
    try {
      return await runReminderSweep(deps);
    } catch (error) {
      (deps.log ?? console.warn)(
        '[reminders] sweep failed: ' +
          (error instanceof Error ? error.message : String(error)),
      );
      return null;
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void runOnce();
  }, Math.max(1_000, intervalMs));
  timer.unref?.();
  void runOnce();

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
    runOnce,
  };
}
