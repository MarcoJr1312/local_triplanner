import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { connectPg, deleteUser, insertUser } from './helpers/pg.ts';
import type { PgDb } from '../src/pg/db.ts';
import { addItem, createTrip, deleteTripCascade, inviteMember } from '../src/pg/trips.ts';
import { recomputeItemReminder, sweepOnce } from '../src/pg/reminders.ts';
import type { ReminderEmailInput } from '../src/reminders.ts';

let db: PgDb | null = null;

before(async () => {
  db = await connectPg();
});

after(async () => {
  await db?.close();
});

async function reminderTrip(conn: PgDb, ownerId: string) {
  return createTrip(conn, ownerId, {
    name: 'Viaje con recordatorios',
    startDate: '2030-01-01',
    endDate: '2030-01-03',
    timezone: 'America/Panama',
  });
}

async function itemRow(conn: PgDb, itemId: string) {
  return conn
    .prepare('SELECT reminder_sent, reminder_due_at, reminder_enabled FROM trip_items WHERE id = ?')
    .get<{ reminder_sent: number; reminder_due_at: string | null; reminder_enabled: number }>(itemId);
}

describe('reminders on Postgres', () => {
  test('schedules due_at at start minus one hour in the trip timezone', async () => {
    if (!db) return;
    const owner = await insertUser(db);
    const trip = await reminderTrip(db, owner);
    const item = await addItem(db, trip.id, owner, {
      title: 'Tour',
      category: 'activity',
      day: '2030-01-01',
      startTime: '10:00',
    });

    // Panama is UTC-5: 10:00 local == 15:00Z, so due is 14:00Z.
    await recomputeItemReminder(db, item.id, '2029-12-30T00:00:00Z');
    const row = await itemRow(db, item.id);
    assert.equal(row?.reminder_sent, 0);
    assert.equal(new Date(row?.reminder_due_at ?? '').toISOString(), '2030-01-01T14:00:00.000Z');

    await deleteTripCascade(db, trip.id);
    await deleteUser(db, owner);
  });

  test('does not schedule an item that starts in less than an hour', async () => {
    if (!db) return;
    const owner = await insertUser(db);
    const trip = await reminderTrip(db, owner);
    const item = await addItem(db, trip.id, owner, {
      title: 'Cerca',
      category: 'food',
      day: '2030-01-01',
      startTime: '10:00',
    });

    // 09:30 local: the 09:00 deadline already passed.
    await recomputeItemReminder(db, item.id, '2030-01-01T14:30:00Z');
    const row = await itemRow(db, item.id);
    assert.equal(row?.reminder_sent, 1);
    assert.equal(row?.reminder_due_at, null);

    await deleteTripCascade(db, trip.id);
    await deleteUser(db, owner);
  });

  test('a disabled reminder is terminal and never scheduled', async () => {
    if (!db) return;
    const owner = await insertUser(db);
    const trip = await reminderTrip(db, owner);
    const item = await addItem(db, trip.id, owner, {
      title: 'Sin aviso',
      category: 'sight',
      day: '2030-01-01',
      startTime: '10:00',
    });
    await db.prepare('UPDATE trip_items SET reminder_enabled = 0 WHERE id = ?').run(item.id);

    await recomputeItemReminder(db, item.id, '2029-12-30T00:00:00Z');
    const row = await itemRow(db, item.id);
    assert.equal(row?.reminder_sent, 1);
    assert.equal(row?.reminder_due_at, null);

    await deleteTripCascade(db, trip.id);
    await deleteUser(db, owner);
  });

  test('sweeps once to every member with an email', async () => {
    if (!db) return;
    const owner = await insertUser(db, 'Owner');
    const guest = await insertUser(db, 'Guest');
    const trip = await reminderTrip(db, owner);
    await inviteMember(db, trip.id, guest, 'viewer');
    const item = await addItem(db, trip.id, owner, {
      title: 'Cena',
      category: 'food',
      day: '2030-01-01',
      startTime: '10:00',
    });

    await recomputeItemReminder(db, item.id, '2029-12-30T00:00:00Z');

    const sent: ReminderEmailInput[] = [];
    const sender = async (input: ReminderEmailInput) => {
      sent.push(input);
    };

    // 09:30 local: due (09:00) passed, start (10:00) not reached -> send.
    const result = await sweepOnce(db, sender, '2030-01-01T14:30:00Z');
    assert.equal(result.sent, 1);
    assert.deepEqual(
      sent.filter((m) => m.itemTitle === 'Cena').map((m) => m.to).sort(),
      [`test-${guest}@example.com`, `test-${owner}@example.com`].sort(),
    );

    const row = await itemRow(db, item.id);
    assert.equal(row?.reminder_sent, 1);

    // A second sweep must not send the same item again.
    const again: ReminderEmailInput[] = [];
    await sweepOnce(db, async (input) => {
      again.push(input);
    }, '2030-01-01T14:35:00Z');
    assert.equal(again.filter((m) => m.itemTitle === 'Cena').length, 0);

    await deleteTripCascade(db, trip.id);
    await deleteUser(db, owner);
    await deleteUser(db, guest);
  });

  test('marks an item as missed after its start time', async () => {
    if (!db) return;
    const owner = await insertUser(db);
    const trip = await reminderTrip(db, owner);
    const item = await addItem(db, trip.id, owner, {
      title: 'Tarde',
      category: 'sight',
      day: '2030-01-01',
      startTime: '10:00',
    });
    await recomputeItemReminder(db, item.id, '2029-12-30T00:00:00Z');

    // 11:00 local: already started.
    const sent: ReminderEmailInput[] = [];
    const result = await sweepOnce(db, async (input) => {
      sent.push(input);
    }, '2030-01-01T16:00:00Z');

    assert.ok(result.missed >= 1);
    assert.equal(sent.filter((m) => m.itemTitle === 'Tarde').length, 0);
    assert.equal((await itemRow(db, item.id))?.reminder_sent, 1);

    await deleteTripCascade(db, trip.id);
    await deleteUser(db, owner);
  });

  test('skips an item with an unparseable day', async () => {
    if (!db) return;
    const owner = await insertUser(db);
    const trip = await reminderTrip(db, owner);
    const item = await addItem(db, trip.id, owner, {
      title: 'Rota',
      category: 'sight',
      day: '2030-01-01',
      startTime: '10:00',
    });
    await db
      .prepare("UPDATE trip_items SET day = 'bad', reminder_sent = 0, reminder_due_at = '2030-01-01T14:00:00Z' WHERE id = ?")
      .run(item.id);

    const result = await sweepOnce(db, async () => {}, '2030-01-01T14:30:00Z');
    assert.ok(result.skipped >= 1);
    assert.equal((await itemRow(db, item.id))?.reminder_sent, 1);

    await deleteTripCascade(db, trip.id);
    await deleteUser(db, owner);
  });
});
