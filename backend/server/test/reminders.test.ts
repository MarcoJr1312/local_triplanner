// Reminder dispatcher: normal delivery, dedupe, grace expiry and retry.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { runReminderSweep, reminderDedupeKey } from '../src/reminders.ts';
import type { TripsStore } from '../src/trips/types.ts';
import type { UsersStore, NotificationRecord } from '../src/users/types.ts';
import type { PubSub } from '../src/resolvers.ts';

const DUE = {
  item_id: 'demo-item-1',
  trip_id: 'demo-trip',
  trip_name: 'Toronto',
  item_title: 'CN Tower',
  day: '2026-12-04',
  start_at: '2026-12-04T10:00:00.000Z',
  due_at: '2026-12-04T09:00:00.000Z',
  lead_minutes: 60,
  recipient_ids: ['u1', 'u2'],
};

function notification(userId: string): NotificationRecord {
  return {
    id: `n-${userId}`,
    user_id: userId,
    type: 'activity_reminder',
    trip_id: DUE.trip_id,
    trip_name: DUE.trip_name,
    invitation_id: null,
    inviter_user_id: null,
    role: null,
    item_id: DUE.item_id,
    item_title: DUE.item_title,
    start_at: DUE.start_at,
    lead_minutes: 60,
    dedupe_key: reminderDedupeKey(DUE.item_id, userId, DUE.due_at),
    status: 'unread',
    created_at: '2026-12-04T09:00:00.000Z',
    read_at: null,
  };
}

function setup(options: {
  now: string;
  created?: boolean;
  fail?: boolean;
}) {
  const marked: { itemId: string; userIds: string[] }[] = [];
  const published: { topic: string; payload: unknown }[] = [];
  const trips = {
    async dueReminders() {
      return [DUE];
    },
    async markRemindersSent(itemId: string, userIds: string[]) {
      marked.push({ itemId, userIds });
    },
  } as unknown as TripsStore;
  const users = {
    async createReminderNotification(input: { userId: string }) {
      if (options.fail) throw new Error('users down');
      return {
        notification: notification(input.userId),
        created: options.created ?? true,
      };
    },
  } as unknown as UsersStore;
  const pubsub = {
    publish(topic: string, payload: unknown) {
      published.push({ topic, payload });
      return true;
    },
  } as unknown as PubSub;

  return {
    marked,
    published,
    deps: { trips, users, pubsub, now: () => new Date(options.now), log: () => undefined },
  };
}

describe('runReminderSweep', () => {
  test('creates one live notification per recipient and marks them sent', async () => {
    const { deps, marked, published } = setup({ now: '2026-12-04T09:00:00.000Z' });
    const result = await runReminderSweep(deps);

    assert.deepEqual(result, {
      due: 1,
      created: 2,
      alreadyPresent: 0,
      expired: 0,
      failed: 0,
    });
    assert.equal(published.length, 2);
    assert.deepEqual(
      published.map((row) => row.topic),
      ['notify:u1', 'notify:u2'],
    );
    assert.deepEqual(marked, [{ itemId: DUE.item_id, userIds: ['u1', 'u2'] }]);
  });

  test('does not republish a deduped notification but still marks it sent', async () => {
    const { deps, marked, published } = setup({
      now: '2026-12-04T09:00:00.000Z',
      created: false,
    });
    const result = await runReminderSweep(deps);

    assert.equal(result.alreadyPresent, 2);
    assert.equal(result.created, 0);
    assert.equal(published.length, 0);
    assert.deepEqual(marked, [{ itemId: DUE.item_id, userIds: ['u1', 'u2'] }]);
  });

  test('expires a reminder older than the grace window without notifying', async () => {
    const { deps, marked, published } = setup({ now: '2026-12-04T09:16:00.000Z' });
    const result = await runReminderSweep(deps);

    assert.equal(result.expired, 2);
    assert.equal(result.created, 0);
    assert.equal(published.length, 0);
    assert.deepEqual(marked, [{ itemId: DUE.item_id, userIds: ['u1', 'u2'] }]);
  });

  test('leaves recipients unsent when the users service fails', async () => {
    const { deps, marked, published } = setup({
      now: '2026-12-04T09:00:00.000Z',
      fail: true,
    });
    const result = await runReminderSweep(deps);

    assert.equal(result.failed, 2);
    assert.equal(result.created, 0);
    assert.equal(published.length, 0);
    assert.equal(marked.length, 0);
  });
});
