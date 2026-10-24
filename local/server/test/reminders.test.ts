// Tests de recordatorios de actividad (M1):
// conversion de hora de pared -> UTC, ventana de envio, barrido idempotente y
// permisos de setItemReminder.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolvers, type Ctx, type PubSub } from '../src/resolvers.ts';
import {
  wallTimeToUtcIso,
  computeReminderDueAt,
  shouldSendReminder,
  sweepOnce,
  type ReminderSender,
} from '../src/reminders.ts';
import { reminderEmailHtml, reminderEmailText } from '../src/email.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = fs.readFileSync(path.resolve(__dirname, '..', '..', 'db', 'schema.sql'), 'utf8');

function memoryDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO users (id, email, display_name, color, language) VALUES ('u-owner', 'o@x.com', 'Ana', '#6C3BFF', 'es')").run();
  db.prepare("INSERT INTO users (id, email, display_name, color, language) VALUES ('u-editor', 'e@x.com', 'Eli', '#F59E0B', 'en')").run();
  db.prepare("INSERT INTO users (id, email, display_name, color, language) VALUES ('u-viewer', 'v@x.com', 'Vic', '#0EA5E9', 'es')").run();
  db.prepare("INSERT INTO users (id, email, display_name, color, language) VALUES ('u-other', 'x@x.com', 'Cid', '#10B981', 'es')").run();
  db.prepare(`
    INSERT INTO trips (id, name, destination_name, owner_id, start_date, end_date, total_budget, timezone, invite_code, created_at, updated_at)
    VALUES ('trip-1', 'Panamá', 'Panama City', 'u-owner', '2030-03-01', '2030-03-05', 500, 'America/Panama', 'ABC12345', '2026-10-12T00:00:00Z', '2026-10-12T00:00:00Z')
  `).run();
  db.prepare("INSERT INTO trip_members (trip_id, user_id, role) VALUES ('trip-1', 'u-owner', 'owner')").run();
  db.prepare("INSERT INTO trip_members (trip_id, user_id, role) VALUES ('trip-1', 'u-editor', 'editor')").run();
  db.prepare("INSERT INTO trip_members (trip_id, user_id, role) VALUES ('trip-1', 'u-viewer', 'viewer')").run();
  db.prepare(`
    INSERT INTO trip_items (id, trip_id, title, category, cost, day, "order", start_time)
    VALUES ('item-1', 'trip-1', 'Cena', 'food', 30, '2030-03-01', 0, '18:00')
  `).run();
  return db;
}

function ctxFor(db: DatabaseSync, currentUserId: string): Ctx {
  const pubsub: PubSub = {
    publish() {
      /* noop */
    },
    subscribe() {
      return (async function* () {
        /* sin eventos */
      })();
    },
  };
  return { db, currentUserId, hasdata: null, pubsub };
}

function errorCodeOf(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    return (e as { extensions?: { code?: string } }).extensions?.code;
  }
}

function itemRow(db: DatabaseSync, id = 'item-1'): {
  reminder_enabled: number;
  reminder_sent: number;
  reminder_due_at: string | null;
} {
  return db
    .prepare('SELECT reminder_enabled, reminder_sent, reminder_due_at FROM trip_items WHERE id = ?')
    .get(id) as { reminder_enabled: number; reminder_sent: number; reminder_due_at: string | null };
}

// ---- hora de pared -> UTC ----

test('wallTimeToUtcIso: America/Panama (UTC-5, sin DST)', () => {
  assert.equal(
    wallTimeToUtcIso('2027-03-01', '18:00', 'America/Panama'),
    '2027-03-01T23:00:00.000Z',
  );
  assert.equal(
    wallTimeToUtcIso('2027-07-15', '09:01', 'America/Panama'),
    '2027-07-15T14:01:00.000Z',
  );
});

test('wallTimeToUtcIso: UTC por defecto/invalida y entrada invalida', () => {
  assert.equal(wallTimeToUtcIso('2027-03-01', '18:00', 'UTC'), '2027-03-01T18:00:00.000Z');
  assert.equal(wallTimeToUtcIso('2027-03-01', '18:00', ''), '2027-03-01T18:00:00.000Z');
  assert.throws(() => wallTimeToUtcIso('2027-03-01', '25:00', 'UTC'));
  assert.throws(() => wallTimeToUtcIso('01/03/2027', '18:00', 'UTC'));
});

// ---- due / ventana ----

test('computeReminderDueAt: futuro -> dueAt = inicio - 60min', () => {
  const computed = computeReminderDueAt(
    '2027-03-01',
    '18:00',
    'America/Panama',
    '2027-02-28T00:00:00.000Z',
  );
  assert.equal(computed.skip, false);
  if (computed.skip) return;
  assert.equal(computed.startAt, '2027-03-01T23:00:00.000Z');
  assert.equal(computed.dueAt, '2027-03-01T22:00:00.000Z');
});

test('computeReminderDueAt: <1h (o justo en due) -> skip sin envio', () => {
  assert.equal(
    computeReminderDueAt('2027-03-01', '18:00', 'America/Panama', '2027-03-01T22:30:00.000Z').skip,
    true,
  );
  assert.equal(
    computeReminderDueAt('2027-03-01', '18:00', 'America/Panama', '2027-03-01T22:00:00.000Z').skip,
    true,
  );
});

test('shouldSendReminder: wait / send / missed', () => {
  const due = '2027-03-01T22:00:00.000Z';
  const start = '2027-03-01T23:00:00.000Z';
  assert.equal(shouldSendReminder(due, start, '2027-03-01T21:59:59.000Z'), 'wait');
  assert.equal(shouldSendReminder(due, start, '2027-03-01T22:00:00.000Z'), 'send');
  assert.equal(shouldSendReminder(due, start, '2027-03-01T22:59:59.000Z'), 'send');
  assert.equal(shouldSendReminder(due, start, '2027-03-01T23:00:00.000Z'), 'missed');
});

// ---- setItemReminder ----

test('setItemReminder: owner activa -> programa due futuro', () => {
  const db = memoryDb();
  const item = resolvers.Mutation.setItemReminder!(
    null,
    { itemId: 'item-1', enabled: true },
    ctxFor(db, 'u-owner'),
  ) as { id: string; reminderEnabled: number };
  assert.equal(item.id, 'item-1');
  assert.equal(item.reminderEnabled, 1);
  const row = itemRow(db);
  assert.equal(row.reminder_enabled, 1);
  assert.equal(row.reminder_sent, 0);
  assert.ok(row.reminder_due_at, 'due_at programado');
});

test('setItemReminder: owner desactiva -> sent=1, due_at NULL', () => {
  const db = memoryDb();
  db.prepare("UPDATE trip_items SET reminder_due_at = '2030-03-01T22:00:00.000Z' WHERE id = 'item-1'").run();
  const item = resolvers.Mutation.setItemReminder!(
    null,
    { itemId: 'item-1', enabled: false },
    ctxFor(db, 'u-owner'),
  ) as { reminderEnabled: number };
  assert.equal(item.reminderEnabled, 0);
  const row = itemRow(db);
  assert.equal(row.reminder_enabled, 0);
  assert.equal(row.reminder_sent, 1);
  assert.equal(row.reminder_due_at, null);
});

test('setItemReminder: viewer -> FORBIDDEN_EDIT; no-miembro -> NOT_TRIP_MEMBER', () => {
  const db = memoryDb();
  assert.equal(
    errorCodeOf(() =>
      resolvers.Mutation.setItemReminder!(null, { itemId: 'item-1', enabled: true }, ctxFor(db, 'u-viewer')),
    ),
    'FORBIDDEN_EDIT',
  );
  assert.equal(
    errorCodeOf(() =>
      resolvers.Mutation.setItemReminder!(null, { itemId: 'item-1', enabled: true }, ctxFor(db, 'u-other')),
    ),
    'NOT_TRIP_MEMBER',
  );
});

test('addItem/updateItem: programan y limpian el recordatorio', () => {
  const db = memoryDb();
  const owner = ctxFor(db, 'u-owner');
  const created = resolvers.Mutation.addItem!(
    null,
    { tripId: 'trip-1', input: { title: 'Tour', category: 'activity', cost: 10, day: '2030-03-02', order: 0, startTime: '09:00' } },
    owner,
  ) as { id: string };
  const afterAdd = itemRow(db, created.id);
  assert.equal(afterAdd.reminder_sent, 0);
  assert.ok(afterAdd.reminder_due_at);

  resolvers.Mutation.updateItem!(null, { tripId: 'trip-1', itemId: created.id, input: { startTime: null } }, owner);
  const afterClear = itemRow(db, created.id);
  assert.equal(afterClear.reminder_sent, 0);
  assert.equal(afterClear.reminder_due_at, null);
});

// ---- sweepOnce ----

test('sweepOnce: due alcanzado -> email a cada miembro y sent=1 (idempotente)', async () => {
  const db = memoryDb();
  db.prepare(
    "UPDATE trip_items SET reminder_due_at = '2030-03-01T22:00:00.000Z' WHERE id = 'item-1'",
  ).run();
  const calls: { to: string; language: string | null; itemTitle: string; tripName: string }[] = [];
  const sender: ReminderSender = (input) => {
    calls.push(input);
  };
  const now = '2030-03-01T22:30:00.000Z';

  const result = await sweepOnce(db, sender, now);
  assert.equal(result.sent, 1);
  assert.equal(result.failed, 0);
  assert.equal(calls.length, 3, 'owner + editor + viewer');
  assert.deepEqual(calls.map((c) => c.to).sort(), ['e@x.com', 'o@x.com', 'v@x.com']);
  assert.equal(calls.find((c) => c.to === 'e@x.com')?.language, 'en');
  assert.equal(itemRow(db).reminder_sent, 1);

  const again = await sweepOnce(db, sender, now);
  assert.equal(again.sent, 0);
  assert.equal(calls.length, 3, 'no duplica envios');
});

test('sweepOnce: inicio ya pasado -> sent=1 sin envio', async () => {
  const db = memoryDb();
  db.prepare(
    "UPDATE trip_items SET reminder_due_at = '2030-03-01T22:00:00.000Z' WHERE id = 'item-1'",
  ).run();
  let calls = 0;
  const result = await sweepOnce(db, () => { calls++; }, '2030-03-01T23:30:00.000Z');
  assert.equal(result.missed, 1);
  assert.equal(calls, 0);
  assert.equal(itemRow(db).reminder_sent, 1);
});

test('sweepOnce: recordatorio desactivado -> no toca el item', async () => {
  const db = memoryDb();
  db.prepare(`
    UPDATE trip_items
    SET reminder_enabled = 0, reminder_sent = 0, reminder_due_at = '2030-03-01T22:00:00.000Z'
    WHERE id = 'item-1'
  `).run();
  let calls = 0;
  const result = await sweepOnce(db, () => { calls++; }, '2030-03-01T22:30:00.000Z');
  assert.equal(result.scanned, 0);
  assert.equal(calls, 0);
  const row = itemRow(db);
  assert.equal(row.reminder_enabled, 0);
  assert.equal(row.reminder_sent, 0);
  assert.equal(row.reminder_due_at, '2030-03-01T22:00:00.000Z');
});

test('sweepOnce: un fallo de envio no rompe el barrido', async () => {
  const db = memoryDb();
  db.prepare(
    "UPDATE trip_items SET reminder_due_at = '2030-03-01T22:00:00.000Z' WHERE id = 'item-1'",
  ).run();
  const originalError = console.error;
  console.error = () => {};
  try {
    const calls: string[] = [];
    const result = await sweepOnce(
      db,
      (input) => {
        calls.push(input.to);
        if (input.to === 'o@x.com') throw new Error('SMTP caido');
      },
      '2030-03-01T22:30:00.000Z',
    );
    assert.equal(calls.length, 3);
    assert.equal(result.failed, 1);
    assert.equal(result.sent, 1);
    assert.equal(itemRow(db).reminder_sent, 1);
  } finally {
    console.error = originalError;
  }
});

// ---- plantilla de email ----

test('plantilla de recordatorio: es/en con actividad, fecha, hora y viaje', () => {
  const es = reminderEmailHtml({
    language: 'es',
    tripName: 'Panamá',
    itemTitle: 'Cena',
    day: '2030-03-01',
    startTime: '18:00',
  });
  assert.ok(es.includes('Recordatorio de actividad'));
  assert.ok(es.includes('Cena'));
  assert.ok(es.includes('2030-03-01'));
  assert.ok(es.includes('18:00'));
  assert.ok(es.includes('Panamá'));

  const enText = reminderEmailText({
    language: 'en',
    tripName: 'Panama',
    itemTitle: 'Dinner',
    day: '2030-03-01',
    startTime: '18:00',
  });
  assert.ok(enText.includes('Reminder: Dinner'));
  assert.ok(enText.includes('Trip: Panama'));
});
