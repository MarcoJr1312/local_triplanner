import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { connectPg, deleteUser, insertUser } from './helpers/pg.ts';
import type { PgDb } from '../src/pg/db.ts';
import {
  addItem,
  computeTripStats,
  createTrip,
  deleteTripCascade,
  getMemberRole,
  getTrip,
  inviteMember,
  isTripMember,
  listItems,
  listMembers,
  listTripsForUser,
  moveItem,
  removeItem,
  removeMember,
  setBudget,
  setItemCost,
  transferOwnershipAndLeave,
  updateItemFields,
  updateMemberRole,
  updateTripSettings,
} from '../src/pg/trips.ts';

let db: PgDb | null = null;

before(async () => {
  db = await connectPg();
});

after(async () => {
  await db?.close();
});

async function newTrip(conn: PgDb, ownerId: string) {
  return createTrip(conn, ownerId, {
    name: 'Viaje de prueba',
    destinationId: 'dest-1',
    destinationName: 'Toronto',
    startDate: '2026-03-01',
    endDate: '2026-03-05',
    totalBudget: 500,
  });
}

describe('trips on Postgres', () => {
  test('createTrip creates the owner membership atomically', async () => {
    if (!db) return;
    const userId = await insertUser(db);
    const trip = await newTrip(db, userId);

    assert.equal(trip.owner_id, userId);
    assert.equal(trip.timezone, 'UTC');
    assert.equal(trip.total_budget, 500);
    assert.match(trip.invite_code ?? '', /^[A-Z0-9]{8}$/);

    const members = await listMembers(db, trip.id);
    assert.deepEqual(
      members.map((m) => ({ user_id: m.user_id, role: m.role })),
      [{ user_id: userId, role: 'owner' }],
    );

    const listed = await listTripsForUser(db, userId);
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.role, 'owner');

    await deleteTripCascade(db, trip.id);
    await deleteUser(db, userId);
  });

  test('updates settings and budget', async () => {
    if (!db) return;
    const userId = await insertUser(db);
    const trip = await newTrip(db, userId);

    await updateTripSettings(db, trip.id, {
      name: 'Renombrado',
      startDate: '2026-04-01',
      endDate: '2026-04-03',
      destinationId: 'dest-2',
      destinationName: 'Lisboa',
    });
    await setBudget(db, trip.id, 900);

    const updated = await getTrip(db, trip.id);
    assert.equal(updated?.name, 'Renombrado');
    assert.equal(updated?.destination_name, 'Lisboa');
    assert.equal(updated?.start_date, '2026-04-01');
    assert.equal(Number(updated?.total_budget), 900);

    await deleteTripCascade(db, trip.id);
    await deleteUser(db, userId);
  });

  test('manages members and roles', async () => {
    if (!db) return;
    const owner = await insertUser(db, 'Owner');
    const guest = await insertUser(db, 'Guest');
    const trip = await newTrip(db, owner);

    assert.equal(await isTripMember(db, trip.id, guest), false);
    await inviteMember(db, trip.id, guest, 'viewer');
    await inviteMember(db, trip.id, guest, 'editor'); // idempotent, keeps the first role
    assert.equal(await getMemberRole(db, trip.id, guest), 'viewer');

    await updateMemberRole(db, trip.id, guest, 'editor');
    assert.equal(await getMemberRole(db, trip.id, guest), 'editor');

    await removeMember(db, trip.id, guest);
    assert.equal(await isTripMember(db, trip.id, guest), false);

    await deleteTripCascade(db, trip.id);
    await deleteUser(db, owner);
    await deleteUser(db, guest);
  });

  test('transfers ownership before the owner leaves', async () => {
    if (!db) return;
    const owner = await insertUser(db, 'Owner');
    const next = await insertUser(db, 'Next');
    const stranger = await insertUser(db, 'Stranger');
    const trip = await newTrip(db, owner);
    await inviteMember(db, trip.id, next, 'editor');

    await assert.rejects(() => transferOwnershipAndLeave(db as PgDb, trip.id, owner, stranger), /otro miembro/);
    await assert.rejects(() => transferOwnershipAndLeave(db as PgDb, trip.id, owner, owner), /otro miembro/);

    await transferOwnershipAndLeave(db, trip.id, owner, next);

    const updated = await getTrip(db, trip.id);
    assert.equal(updated?.owner_id, next);
    assert.equal(await getMemberRole(db, trip.id, next), 'owner');
    assert.equal(await isTripMember(db, trip.id, owner), false);

    await deleteTripCascade(db, trip.id);
    await deleteUser(db, owner);
    await deleteUser(db, next);
    await deleteUser(db, stranger);
  });

  test('cascade delete removes items, members, invitations and attachments', async () => {
    if (!db) return;
    const owner = await insertUser(db);
    const trip = await newTrip(db, owner);
    const item = await addItem(db, trip.id, owner, { title: 'Museo', category: 'sight', day: '2026-03-01', order: 0 });
    await db
      .prepare(
        "INSERT INTO invitations (id, trip_id, email, code, role, status, created_by) VALUES ('inv-1', ?, 'a@b.c', 'ABCDEFGHIJKL', 'viewer', 'pending', ?)",
      )
      .run(trip.id, owner);
    await db
      .prepare(
        "INSERT INTO item_attachments (id, item_id, file_name, mime_type, size_bytes, path, created_by) VALUES ('att-1', ?, 'f.pdf', 'application/pdf', 10, '/tmp/f.pdf', ?)",
      )
      .run(item.id, owner);

    await deleteTripCascade(db, trip.id);

    const counts = await db
      .prepare(
        `SELECT
           (SELECT count(*)::int FROM trips WHERE id = ?) AS trips,
           (SELECT count(*)::int FROM trip_items WHERE trip_id = ?) AS items,
           (SELECT count(*)::int FROM trip_members WHERE trip_id = ?) AS members,
           (SELECT count(*)::int FROM invitations WHERE trip_id = ?) AS invitations,
           (SELECT count(*)::int FROM item_attachments WHERE item_id = ?) AS attachments`,
      )
      .get<Record<string, number>>(trip.id, trip.id, trip.id, trip.id, item.id);
    assert.deepEqual(counts, { trips: 0, items: 0, members: 0, invitations: 0, attachments: 0 });

    await deleteUser(db, owner);
  });
});

describe('trip items on Postgres', () => {
  test('orders by day then order and mutates in place', async () => {
    if (!db) return;
    const owner = await insertUser(db);
    const trip = await newTrip(db, owner);

    const late = await addItem(db, trip.id, owner, {
      title: 'Cena',
      category: 'food',
      day: '2026-03-02',
      order: 1,
      cost: 40,
    });
    const early = await addItem(db, trip.id, owner, {
      title: 'Museo',
      category: 'sight',
      day: '2026-03-01',
      order: 2,
      cost: 20,
    });

    assert.deepEqual(
      (await listItems(db, trip.id)).map((i) => i.title),
      ['Museo', 'Cena'],
    );

    await updateItemFields(db, late.id, {
      day: '2026-03-03',
      order: 0,
      startTime: '20:00',
      notes: 'Reserva',
      title: 'Cena con reserva',
      locationText: 'Centro',
    });
    const updated = (await listItems(db, trip.id)).find((i) => i.id === late.id);
    assert.equal(updated?.day, '2026-03-03');
    assert.equal(updated?.start_time, '20:00');
    assert.equal(updated?.location_text, 'Centro');

    await setItemCost(db, early.id, 35);
    assert.equal((await listItems(db, trip.id)).find((i) => i.id === early.id)?.cost, 35);

    await moveItem(db, early.id, '2026-03-02', 0);
    assert.equal((await listItems(db, trip.id)).find((i) => i.id === early.id)?.day, '2026-03-02');

    await removeItem(db, early.id);
    assert.equal((await listItems(db, trip.id)).length, 1);

    await deleteTripCascade(db, trip.id);
    await deleteUser(db, owner);
  });

  test('computeTripStats derives spend from items', () => {
    const stats = computeTripStats([
      { category: 'food', cost: 40 },
      { category: 'food', cost: 10 },
      { category: 'sight', cost: 25.5 },
      { category: null, cost: null },
    ]);
    assert.equal(stats.spent, 75.5);
    assert.deepEqual(stats.spentByCategory.sort((a, b) => a.category.localeCompare(b.category)), [
      { category: 'activity', amount: 0 },
      { category: 'food', amount: 50 },
      { category: 'sight', amount: 25.5 },
    ]);
  });
});
