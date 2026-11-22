import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import type { Db } from '../src/db.ts';
import { migrate } from '../src/db/migrate.ts';
import {
  LocationsUnavailableError,
  type LocationsClient,
  type LocationSnapshot,
} from '../src/domain/locations.ts';
import { TripsService } from '../src/domain/service.ts';
import { AppError, type ErrorCode } from '../src/errors.ts';
import { createHandler } from '../src/http.ts';
import { connectTestDb, resetSchema } from './helpers/pg.ts';

const INTERNAL_TOKEN = 'test-token';

const SNAPSHOTS: Record<string, LocationSnapshot> = {
  toronto: { id: 'toronto', name: 'Toronto', address: 'Ontario', lat: 43.6532, lng: -79.3832 },
  'tor-cn-tower': {
    id: 'tor-cn-tower',
    name: 'CN Tower',
    address: '301 Front St W',
    lat: 43.6426,
    lng: -79.3871,
  },
};

const locations: LocationsClient = {
  getById: async (id) => SNAPSHOTS[id] ?? null,
};

const failingLocations: LocationsClient = {
  getById: async () => {
    throw new LocationsUnavailableError('locations down');
  },
};

let db: Db | null = null;
let service: TripsService;
let failingService: TripsService;
let handler: (req: Request) => Promise<Response>;

beforeAll(async () => {
  db = await connectTestDb();
  if (!db) return;
  service = new TripsService(db, locations);
  failingService = new TripsService(db, failingLocations);
  handler = createHandler({ db, internalToken: INTERNAL_TOKEN, service });
});

beforeEach(async () => {
  if (!db) return;
  await resetSchema(db);
  await migrate(db);
});

async function expectCode(run: () => Promise<unknown>, code: ErrorCode): Promise<void> {
  try {
    await run();
    throw new Error(`expected AppError ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
  }
}

async function newTrip(ownerId = 'u1'): Promise<string> {
  if (!db) throw new Error('no database');
  const trip = await service.createTrip(ownerId, {
    name: 'Toronto',
    destination_id: 'toronto',
    start_date: '2026-12-04',
    end_date: '2026-12-06',
    total_budget: 1_000,
  });
  return trip.id;
}

function authed(path: string, init: RequestInit = {}, actor = 'u1'): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('x-internal-token', INTERNAL_TOKEN);
  headers.set('x-actor-id', actor);
  return handler(new Request(`http://localhost${path}`, { ...init, headers }));
}

describe('create and read', () => {
  test('creates the trip, owner membership and destination snapshot', async () => {
    if (!db) return;
    const trip = await service.createTrip('u1', {
      name: 'Toronto weekend',
      destination_id: 'toronto',
      start_date: '2026-12-04',
      end_date: '2026-12-06',
      total_budget: 1_200,
    });

    expect(trip.owner_id).toBe('u1');
    expect(trip.my_role).toBe('owner');
    expect(trip.members).toHaveLength(1);
    expect(trip.members[0]?.user_id).toBe('u1');
    expect(trip.members[0]?.role).toBe('owner');
    expect(trip.destination_name).toBe('Toronto');
    expect(trip.destination_lat).toBeCloseTo(43.6532);
    expect(trip.place_resolved).toBe(true);
    expect(trip.invite_code).toMatch(/^[A-Z0-9]{8}$/);

    const mine = await service.listTrips('u1');
    const theirs = await service.listTrips('u2');
    expect(mine).toHaveLength(1);
    expect(mine[0]?.role).toBe('owner');
    expect(theirs).toHaveLength(0);
  });

  test('retries the same id idempotently for the owner only', async () => {
    if (!db) return;
    const input = {
      id: 'trip-fixed',
      name: 'Fixed',
      start_date: '2026-12-04',
      end_date: '2026-12-06',
    };
    const first = await service.createTrip('u1', input);
    const second = await service.createTrip('u1', input);

    expect(second.id).toBe(first.id);
    expect(second.members).toHaveLength(1);
    expect(second.invite_code).toBe(first.invite_code);

    await expectCode(() => service.createTrip('u2', input), 'INVALID_ARGUMENT');
  });

  test('getTrip distinguishes missing trips from non-members', async () => {
    if (!db) return;
    const id = await newTrip();

    expect((await service.getTrip('u1', id)).id).toBe(id);
    await expectCode(() => service.getTrip('u1', 'missing'), 'TRIP_NOT_FOUND');
    await expectCode(() => service.getTrip('u2', id), 'NOT_TRIP_MEMBER');
  });
});

describe('trip settings and authorization', () => {
  test('editor can edit settings and budget, viewer cannot', async () => {
    if (!db) return;
    const id = await newTrip();
    await service.addMember('u1', id, { user_id: 'u2', role: 'editor' });
    await service.addMember('u1', id, { user_id: 'u3', role: 'viewer' });

    const updated = await service.updateTrip('u2', id, {
      name: 'Renamed',
      total_budget: 500,
    });
    expect(updated.name).toBe('Renamed');
    expect(updated.total_budget).toBe(500);

    await expectCode(() => service.updateTrip('u3', id, { name: 'Nope' }), 'FORBIDDEN_EDIT');
    await expectCode(
      () => service.updateTrip('u2', id, { cover_preset: 'beach' }),
      'NOT_TRIP_OWNER',
    );

    const covered = await service.updateTrip('u1', id, { cover_preset: 'beach' });
    expect(covered.cover_preset).toBe('beach');
    expect(covered.cover_photo_url).toBeNull();
  });

  test('destination changes re-resolve and invalid ranges are rejected', async () => {
    if (!db) return;
    const id = await newTrip();

    const moved = await service.updateTrip('u1', id, { destination_id: 'tor-cn-tower' });
    expect(moved.destination_name).toBe('CN Tower');
    expect(moved.destination_lat).toBeCloseTo(43.6426);

    await expectCode(
      () => service.updateTrip('u1', id, { start_date: '2026-12-06', end_date: '2026-12-04' }),
      'INVALID_ARGUMENT',
    );
  });

  test('only the owner deletes the trip', async () => {
    if (!db) return;
    const id = await newTrip();
    await service.addMember('u1', id, { user_id: 'u2', role: 'editor' });

    await expectCode(() => service.deleteTrip('u2', id), 'NOT_TRIP_OWNER');
    expect(await service.deleteTrip('u1', id)).toEqual({ deleted: true });
    await expectCode(() => service.getTrip('u1', id), 'TRIP_NOT_FOUND');
  });
});

describe('members', () => {
  test('enforces the owner/editor/viewer matrix', async () => {
    if (!db) return;
    const id = await newTrip();

    const editor = await service.addMember('u1', id, { user_id: 'u2', role: 'editor' });
    expect(editor.role).toBe('editor');

    await service.addMember('u2', id, { user_id: 'u3', role: 'viewer' });
    await expectCode(
      () => service.addMember('u3', id, { user_id: 'u4', role: 'viewer' }),
      'FORBIDDEN_EDIT',
    );

    await expectCode(
      () => service.updateMemberRole('u2', id, 'u3', { role: 'editor' }),
      'NOT_TRIP_OWNER',
    );
    const changed = await service.updateMemberRole('u1', id, 'u3', { role: 'editor' });
    expect(changed.role).toBe('editor');

    await expectCode(
      () => service.updateMemberRole('u1', id, 'u1', { role: 'viewer' }),
      'OWNER_ROLE_PROTECTED',
    );
    await expectCode(() => service.removeMember('u1', id, 'u1'), 'OWNER_CANNOT_BE_REMOVED');
    await expectCode(() => service.removeMember('u1', id, 'ghost'), 'MEMBER_NOT_FOUND');

    expect(await service.removeMember('u1', id, 'u3')).toEqual({ removed: true });
    expect((await service.listMembers('u1', id)).map((member) => member.user_id)).toEqual([
      'u1',
      'u2',
    ]);
  });

  test('leaving is allowed, but the owner must transfer ownership', async () => {
    if (!db) return;
    const id = await newTrip();
    await service.addMember('u1', id, { user_id: 'u2', role: 'editor' });

    const left = await service.leaveTrip('u2', id, {});
    expect(left.left).toBe(true);
    expect(left.trip.members.map((member) => member.user_id)).toEqual(['u1']);

    await expectCode(() => service.leaveTrip('u1', id, {}), 'OWNER_MUST_TRANSFER');
    await expectCode(
      () => service.leaveTrip('u1', id, { new_owner_id: 'u1' }),
      'INVALID_TRANSFER_TARGET',
    );
    await expectCode(
      () => service.leaveTrip('u1', id, { new_owner_id: 'u2' }),
      'INVALID_TRANSFER_TARGET',
    );

    await service.addMember('u1', id, { user_id: 'u2', role: 'editor' });
    const transferred = await service.leaveTrip('u1', id, { new_owner_id: 'u2' });

    expect(transferred.trip.owner_id).toBe('u2');
    expect(transferred.trip.members).toHaveLength(1);
    expect(transferred.trip.members[0]?.user_id).toBe('u2');
    expect(transferred.trip.members[0]?.role).toBe('owner');
  });
});

describe('items', () => {
  test('editors add, update, move, remind and delete; viewers cannot', async () => {
    if (!db) return;
    const id = await newTrip();
    await service.addMember('u1', id, { user_id: 'u2', role: 'editor' });
    await service.addMember('u1', id, { user_id: 'u3', role: 'viewer' });

    const item = await service.addItem('u2', id, {
      day: '2030-01-01',
      order: 0,
      title: 'CN Tower',
      category: 'sight',
      cost: 43,
      start_time: '10:00',
      location_id: 'tor-cn-tower',
      location_text: 'CN Tower',
    });

    expect(item.location_name).toBe('CN Tower');
    expect(item.location_address).toBe('301 Front St W');
    expect(item.lat).toBeCloseTo(43.6426);
    expect(item.place_resolved).toBe(true);
    expect(item.reminder_enabled).toBe(1);
    expect(item.reminder_due_at).not.toBeNull();

    await expectCode(
      () =>
        service.addItem('u3', id, {
          day: '2030-01-01',
          title: 'Nope',
        }),
      'FORBIDDEN_EDIT',
    );

    const updated = await service.updateItem('u2', id, item.id, {
      title: 'CN Tower Tour',
      cost: 50,
    });
    expect(updated.title).toBe('CN Tower Tour');
    expect(updated.cost).toBe(50);

    const moved = await service.moveItem('u2', id, item.id, {
      day: '2030-01-02',
      order: 2,
    });
    expect(moved.day).toBe('2030-01-02');
    expect(moved.order).toBe(2);

    const off = await service.setReminder('u2', id, item.id, { enabled: false });
    expect(off.reminder_enabled).toBe(0);
    expect(off.reminder_sent).toBe(1);
    expect(off.reminder_due_at).toBeNull();

    const other = await service.addItem('u2', id, {
      day: '2030-01-02',
      title: 'Market',
      category: 'food',
      cost: 7,
    });

    const trip = await service.getTrip('u1', id);
    expect(trip.spent).toBe(57);
    expect(trip.spent_by_category).toEqual(
      expect.arrayContaining([
        { category: 'sight', amount: 50 },
        { category: 'food', amount: 7 },
      ]),
    );

    const deleted = await service.deleteItem('u2', id, item.id);
    expect(deleted.id).toBe(item.id);
    await expectCode(() => service.deleteItem('u2', id, item.id), 'ITEM_NOT_FOUND');

    const deletedOther = await service.deleteItem('u2', id, other.id);
    expect(deletedOther.id).toBe(other.id);
  });

  test('an item cannot be read or written through another trip', async () => {
    if (!db) return;
    const first = await newTrip();
    const second = await newTrip();

    const item = await service.addItem('u1', first, { day: '2030-01-01', title: 'Museum' });

    await expectCode(
      () => service.updateItem('u1', second, item.id, { title: 'Hijacked' }),
      'ITEM_NOT_FOUND',
    );
    await expectCode(() => service.deleteItem('u1', second, item.id), 'ITEM_NOT_FOUND');

    const found = await service.getItemForActor('u1', item.id);
    expect(found.trip_id).toBe(first);
    await expectCode(() => service.getItemForActor('u2', item.id), 'NOT_TRIP_MEMBER');
    await expectCode(() => service.getItemForActor('u1', 'missing'), 'ITEM_NOT_FOUND');
  });

  test('returns the agent context grouped by day', async () => {
    if (!db) return;
    const id = await newTrip();
    await service.addItem('u1', id, { day: '2026-12-05', title: 'Late', cost: 10 });
    await service.addItem('u1', id, { day: '2026-12-04', title: 'Early', cost: 5 });

    const context = await service.getContext('u1', id);
    expect(context.trip.id).toBe(id);
    expect(context.days.map((day) => day.date)).toEqual(['2026-12-04', '2026-12-05']);
    expect(context.days[0]?.items[0]?.title).toBe('Early');
    expect(context.members).toHaveLength(1);
    expect(context.my_role).toBe('owner');
    expect(context.trip.spent).toBe(15);
  });
});

describe('locations degradation', () => {
  test('a locations outage never blocks a trip or item write', async () => {
    if (!db) return;
    const trip = await failingService.createTrip('u1', {
      name: 'Offline',
      destination_id: 'toronto',
      start_date: '2026-12-04',
      end_date: '2026-12-06',
    });

    expect(trip.place_resolved).toBe(false);
    expect(trip.destination_lat).toBeNull();
    expect(trip.destination_name).toBeNull();

    const item = await failingService.addItem('u1', trip.id, {
      day: '2026-12-04',
      title: 'Museum',
      location_id: 'tor-rom',
    });
    expect(item.place_resolved).toBe(false);
    expect(item.location_name).toBeNull();
    expect(item.location_id).toBe('tor-rom');
  });
});

describe('HTTP routes', () => {
  test('create, list, read and forbid a non-member', async () => {
    if (!db) return;
    const created = await authed('/internal/v1/trips', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Viaje HTTP',
        destination_id: 'toronto',
        start_date: '2026-12-04',
        end_date: '2026-12-06',
      }),
    });
    expect(created.status).toBe(201);
    const trip = (await created.json()) as {
      id: string;
      owner_id: string;
      members: { user_id: string }[];
      place_resolved: boolean;
    };
    expect(trip.owner_id).toBe('u1');
    expect(trip.members[0]?.user_id).toBe('u1');
    expect(trip.place_resolved).toBe(true);

    const list = await authed('/internal/v1/trips');
    expect(list.status).toBe(200);
    expect(((await list.json()) as { items: unknown[] }).items).toHaveLength(1);

    const read = await authed(`/internal/v1/trips/${trip.id}`);
    expect(read.status).toBe(200);

    const forbidden = await authed(`/internal/v1/trips/${trip.id}`, {}, 'u2');
    expect(forbidden.status).toBe(403);
    expect(((await forbidden.json()) as { error: string }).error).toBe('NOT_TRIP_MEMBER');
  });

  test('member and item routes enforce roles and return snapshots', async () => {
    if (!db) return;
    const trip = await service.createTrip('u1', {
      name: 'Routes',
      destination_id: 'toronto',
      start_date: '2026-12-04',
      end_date: '2026-12-06',
    });

    const member = await authed(`/internal/v1/trips/${trip.id}/members`, {
      method: 'POST',
      body: JSON.stringify({ user_id: 'u2', role: 'viewer' }),
    });
    expect(member.status).toBe(201);

    const denied = await authed(`/internal/v1/trips/${trip.id}/items`, {
      method: 'POST',
      body: JSON.stringify({ day: '2026-12-04', title: 'Nope' }),
    }, 'u2');
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as { error: string }).error).toBe('FORBIDDEN_EDIT');

    const item = await authed(`/internal/v1/trips/${trip.id}/items`, {
      method: 'POST',
      body: JSON.stringify({
        day: '2026-12-04',
        title: 'CN Tower',
        location_id: 'tor-cn-tower',
        cost: 43,
      }),
    });
    expect(item.status).toBe(201);
    const itemBody = (await item.json()) as {
      id: string;
      location_name: string;
      place_resolved: boolean;
    };
    expect(itemBody.location_name).toBe('CN Tower');
    expect(itemBody.place_resolved).toBe(true);

    const context = await authed(`/internal/v1/trips/${trip.id}/context`);
    expect(context.status).toBe(200);
    expect(((await context.json()) as { days: unknown[] }).days).toHaveLength(1);

    const deleted = await authed(`/internal/v1/trips/${trip.id}`, { method: 'DELETE' });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ deleted: true });
  });

  test('rejects invalid JSON and unknown routes', async () => {
    if (!db) return;
    const invalid = await authed('/internal/v1/trips', {
      method: 'POST',
      body: '{',
    });
    expect(invalid.status).toBe(400);
    expect(((await invalid.json()) as { error: string }).error).toBe('INVALID_ARGUMENT');

    const unknown = await authed('/internal/v1/nope');
    expect(unknown.status).toBe(404);
  });
});
