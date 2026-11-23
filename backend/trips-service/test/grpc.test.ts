import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import * as grpc from '@grpc/grpc-js';
import * as loader from '@grpc/proto-loader';
import { fileURLToPath } from 'node:url';
import type { Db } from '../src/db.ts';
import { migrate } from '../src/db/migrate.ts';
import type { LocationsClient, LocationSnapshot } from '../src/domain/locations.ts';
import { TripsService } from '../src/domain/service.ts';
import { startTripsGrpcServer, type TripsGrpcHandle } from '../src/grpc/server.ts';
import { connectTestDb, resetSchema } from './helpers/pg.ts';

const PORT = 50056;
const PROTO_PATH = fileURLToPath(
  new URL('../../../proto/triplanner/trips/v1/trips.proto', import.meta.url),
);

const SNAPSHOTS: Record<string, LocationSnapshot> = {
  toronto: { id: 'toronto', name: 'Toronto', address: 'Ontario', lat: 43.6532, lng: -79.3832 },
};

const locations: LocationsClient = {
  getById: async (id) => SNAPSHOTS[id] ?? null,
};

let db: Db | null = null;
let service: TripsService | null = null;
let handle: TripsGrpcHandle | null = null;
let client: any = null;

function call(method: string, request: unknown, actor?: string, token = 'test-token'): Promise<any> {
  return new Promise((resolve, reject) => {
    const metadata = new grpc.Metadata();
    metadata.set('x-internal-token', token);
    if (actor) metadata.set('x-actor-id', actor);
    client[method](request, metadata, { deadline: Date.now() + 5000 }, (error: any, value: any) => {
      if (error) reject(error);
      else resolve(value);
    });
  });
}

beforeAll(async () => {
  db = await connectTestDb();
  if (!db) {
    console.warn('[trips] test database unavailable; gRPC tests return early');
    return;
  }
  await migrate(db);
  service = new TripsService(db, locations, { brokerTopic: 'TripInvitation' });
  handle = await startTripsGrpcServer({
    service,
    port: PORT,
    internalToken: 'test-token',
  });
  const definition = loader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: false,
    oneofs: true,
  });
  const proto = grpc.loadPackageDefinition(definition) as any;
  client = new proto.triplanner.trips.v1.TripsService(
    `127.0.0.1:${PORT}`,
    grpc.credentials.createInsecure(),
  );
});

beforeEach(async () => {
  if (!db) return;
  await resetSchema(db);
  await migrate(db);
});

afterAll(async () => {
  client?.close();
  await handle?.stop();
  await db?.close();
});

describe('trips gRPC', () => {
  test('creates a trip, adds and updates an item, and manages a reminder', async () => {
    if (!service || !client) return;

    const created = await call(
      'CreateTrip',
      {
        name: 'Toronto',
        destination_id: 'toronto',
        start_date: '2027-06-01',
        end_date: '2027-06-03',
        total_budget: 1000,
        timezone: 'America/Toronto',
      },
      'u1',
    );
    const tripId = created.trip.trip.id;
    expect(created.trip.trip.name).toBe('Toronto');
    expect(created.trip.my_role).toBe('owner');
    expect(created.trip.trip.cover_preset).toBeUndefined();

    const listed = await call('ListTrips', {}, 'u1');
    expect(listed.items.map((item: any) => item.id)).toContain(tripId);

    const itemResponse = await call(
      'AddItem',
      {
        trip_id: tripId,
        title: 'CN Tower',
        category: 'sight',
        cost: 40,
        day: '2027-06-01',
        order: 1,
        start_time: '10:00',
      },
      'u1',
    );
    const itemId = itemResponse.item.id;
    expect(itemResponse.item.title).toBe('CN Tower');

    const updated = await call(
      'UpdateItem',
      { trip_id: tripId, item_id: itemId, notes: 'Buy tickets' },
      'u1',
    );
    expect(updated.item.notes).toBe('Buy tickets');

    const cleared = await call(
      'UpdateItem',
      { trip_id: tripId, item_id: itemId, clear_notes: true },
      'u1',
    );
    expect(cleared.item.notes).toBeUndefined();
    expect(cleared.item.title).toBe('CN Tower');

    const reminded = await call(
      'SetReminder',
      {
        trip_id: tripId,
        item_id: itemId,
        enabled: true,
        lead_minutes: 15,
        recipient_ids: ['u1'],
      },
      'u1',
    );
    expect(reminded.item.reminder.enabled).toBe(true);
    expect(reminded.item.reminder.lead_minutes).toBe(15);

    const reminder = await call('GetReminder', { trip_id: tripId, item_id: itemId }, 'u1');
    expect(reminder.reminder.recipient_ids).toEqual(['u1']);

    const moved = await call(
      'MoveItem',
      { trip_id: tripId, item_id: itemId, day: '2027-06-02', order: 3 },
      'u1',
    );
    expect(moved.item.day).toBe('2027-06-02');
    expect(moved.item.order).toBe(3);

    const cost = await call(
      'SetItemCost',
      { trip_id: tripId, item_id: itemId, cost: 55 },
      'u1',
    );
    expect(cost.item.cost).toBe(55);

    const removed = await call('DeleteItem', { trip_id: tripId, item_id: itemId }, 'u1');
    expect(removed.item.id).toBe(itemId);
  });

  test('enforces the internal token and actor membership', async () => {
    if (!service || !client) return;

    const created = await call(
      'CreateTrip',
      {
        name: 'Private',
        start_date: '2027-07-01',
        end_date: '2027-07-02',
        timezone: 'UTC',
      },
      'owner',
    );
    const tripId = created.trip.trip.id;
    // bun test can race a trailers-only response on a just-used channel; the
    // real runtime does not (verified outside the test runner).
    await new Promise((resolve) => setTimeout(resolve, 100));

    await expect(call('GetTrip', { trip_id: tripId }, 'owner', 'wrong')).rejects.toMatchObject({
      code: grpc.status.UNAUTHENTICATED,
    });
    await expect(call('ListTrips', {}, 'owner', 'wrong')).rejects.toMatchObject({
      code: grpc.status.UNAUTHENTICATED,
    });
    await expect(call('GetTrip', { trip_id: tripId })).rejects.toMatchObject({
      code: grpc.status.UNAUTHENTICATED,
    });
    await expect(call('GetTrip', { trip_id: tripId }, 'stranger')).rejects.toMatchObject({
      code: grpc.status.PERMISSION_DENIED,
    });
  });

  test('carries the stable domain code in x-error-code', async () => {
    if (!service || !client) return;

    const error: any = await call('GetTrip', { trip_id: 'does-not-exist' }, 'u1').catch(
      (value) => value,
    );
    expect(error.code).toBe(grpc.status.NOT_FOUND);
    expect(error.metadata.get('x-error-code')[0]).toBe('TRIP_NOT_FOUND');
  });

  test('lists due reminders without an actor', async () => {
    if (!service || !client) return;
    const result = await call('DueReminders', {});
    expect(result.items ?? []).toEqual([]);
  });
});
