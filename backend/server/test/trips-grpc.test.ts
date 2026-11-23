// gRPC trips adapter contract: request shapes, null semantics, mapping and errors.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as grpc from '@grpc/grpc-js';
import * as loader from '@grpc/proto-loader';
import { fileURLToPath } from 'node:url';
import { GraphQLError } from 'graphql';
import { GrpcTripsStore } from '../src/trips/grpc.ts';
import { createTripsStore } from '../src/trips/index.ts';
import { RemoteTripsStore } from '../src/trips/remote.ts';

const PROTO_PATH = fileURLToPath(
  new URL('../../../proto/triplanner/trips/v1/trips.proto', import.meta.url),
);

const AGGREGATE = {
  trip: {
    id: 't1',
    name: 'Toronto',
    destination_id: 'toronto',
    destination_name: 'Toronto',
    destination_lat: 43.6532,
    destination_lng: -79.3832,
    start_date: '2027-06-01',
    end_date: '2027-06-03',
    total_budget: 1000,
    timezone: 'America/Toronto',
    owner_id: 'u1',
    invite_code: 'code-1',
    created_at: '2026-11-21T00:00:00.000Z',
    updated_at: '2026-11-21T00:00:00.000Z',
  },
  members: [
    { user_id: 'u1', role: 'owner', joined_at: '2026-11-21T00:00:00.000Z' },
    {
      user_id: 'u2',
      role: 'editor',
      joined_at: '2026-11-21T00:00:00.000Z',
      invited_email: 'friend@example.com',
    },
  ],
  items: [
    {
      id: 'i1',
      trip_id: 't1',
      location_id: 'tor-cn-tower',
      location_name: 'CN Tower',
      lat: 43.6426,
      lng: -79.3871,
      title: 'CN Tower',
      category: 'sight',
      cost: 40,
      day: '2027-06-01',
      order: 1,
      start_time: '10:00',
      created_at: '2026-11-21T00:00:00.000Z',
      reminder: { enabled: true, lead_minutes: 15, recipient_ids: ['u1'], can_edit: true },
    },
  ],
  my_role: 'owner',
  spent: 40,
  spent_by_category: [{ category: 'sight', amount: 40 }],
};

const INVITATION = {
  id: 'inv-1',
  trip_id: 't1',
  role: 'editor',
  status: 'pending',
  created_by: 'u1',
  created_at: '2026-11-21T00:00:00.000Z',
  channel: 'local',
  invitee_user_id: 'u2',
};

const seen: { method: string; request: any; actor?: string }[] = [];
let server: grpc.Server;
let port = 0;
let store: GrpcTripsStore;

function value(md: grpc.Metadata, key: string): string | undefined {
  const values = md.get(key);
  return Array.isArray(values) && values.length > 0 ? String(values[0]) : undefined;
}

function fail(callback: grpc.sendUnaryData<any>, status: grpc.status, code: string): void {
  const metadata = new grpc.Metadata();
  metadata.set('x-error-code', code);
  callback({ code: status, details: code, metadata });
}

function record(method: string, call: grpc.ServerUnaryCall<any, any>): void {
  seen.push({
    method,
    request: call.request,
    actor: value(call.metadata, 'x-actor-id'),
  });
}

function codeOf(error: unknown): string | undefined {
  return error instanceof GraphQLError ? (error.extensions.code as string | undefined) : undefined;
}

before(async () => {
  const definition = loader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: false,
    oneofs: true,
  } as any);
  const proto = grpc.loadPackageDefinition(definition) as any;
  const descriptor = proto.triplanner.trips.v1.TripsService;

  server = new grpc.Server();
  server.addService(descriptor.service, {
    ListTrips: (call: any, callback: any) => {
      record('ListTrips', call);
      callback(null, {
        items: [
          {
            id: 't1',
            name: 'Toronto',
            destination_name: 'Toronto',
            start_date: '2027-06-01',
            end_date: '2027-06-03',
            role: 'owner',
            joined_at: '2026-11-21T00:00:00.000Z',
          },
        ],
      });
    },
    GetTrip: (call: any, callback: any) => {
      record('GetTrip', call);
      if (call.request.trip_id === 'missing') {
        fail(callback, grpc.status.NOT_FOUND, 'TRIP_NOT_FOUND');
        return;
      }
      callback(null, { trip: AGGREGATE });
    },
    CreateTrip: (call: any, callback: any) => {
      record('CreateTrip', call);
      callback(null, { trip: AGGREGATE });
    },
    UpdateTrip: (call: any, callback: any) => {
      record('UpdateTrip', call);
      callback(null, { trip: AGGREGATE });
    },
    DeleteTrip: (call: any, callback: any) => {
      record('DeleteTrip', call);
      callback(null, {});
    },
    ListMembers: (call: any, callback: any) => {
      record('ListMembers', call);
      callback(null, { items: AGGREGATE.members });
    },
    AddMember: (call: any, callback: any) => {
      record('AddMember', call);
      callback(null, { member: { user_id: call.request.user_id, role: call.request.role, joined_at: 'now' } });
    },
    UpdateMemberRole: (call: any, callback: any) => {
      record('UpdateMemberRole', call);
      callback(null, { member: { user_id: call.request.user_id, role: call.request.role, joined_at: 'now' } });
    },
    RemoveMember: (call: any, callback: any) => {
      record('RemoveMember', call);
      callback(null, {});
    },
    LeaveTrip: (call: any, callback: any) => {
      record('LeaveTrip', call);
      callback(null, { left: true, trip: AGGREGATE });
    },
    AddItem: (call: any, callback: any) => {
      record('AddItem', call);
      callback(null, { item: AGGREGATE.items[0]! });
    },
    UpdateItem: (call: any, callback: any) => {
      record('UpdateItem', call);
      callback(null, { item: AGGREGATE.items[0]! });
    },
    SetItemCost: (call: any, callback: any) => {
      record('SetItemCost', call);
      callback(null, { item: { ...AGGREGATE.items[0]!, cost: call.request.cost } });
    },
    MoveItem: (call: any, callback: any) => {
      record('MoveItem', call);
      callback(null, { item: { ...AGGREGATE.items[0]!, day: call.request.day, order: call.request.order } });
    },
    DeleteItem: (call: any, callback: any) => {
      record('DeleteItem', call);
      callback(null, { item: AGGREGATE.items[0]! });
    },
    GetItemForActor: (call: any, callback: any) => {
      record('GetItemForActor', call);
      callback(null, { trip_id: 't1', item: AGGREGATE.items[0]! });
    },
    SetReminder: (call: any, callback: any) => {
      record('SetReminder', call);
      callback(null, { item: AGGREGATE.items[0]! });
    },
    GetReminder: (call: any, callback: any) => {
      record('GetReminder', call);
      callback(null, { reminder: AGGREGATE.items[0]!.reminder });
    },
    DueReminders: (call: any, callback: any) => {
      record('DueReminders', call);
      callback(null, { items: [] });
    },
    MarkReminderSent: (call: any, callback: any) => {
      record('MarkReminderSent', call);
      callback(null, {});
    },
    PreviewInvitation: (call: any, callback: any) => {
      record('PreviewInvitation', call);
      callback(null, {
        preview: {
          invitation: { ...INVITATION, email: 'friend@example.com', code: 'inv-code', channel: 'email' },
          trip_id: 't1',
          trip_name: 'Toronto',
          destination_name: 'Toronto',
          owner_id: 'u1',
        },
      });
    },
    CreateInvitation: (call: any, callback: any) => {
      record('CreateInvitation', call);
      callback(null, {
        invitation: { ...INVITATION, email: call.request.email, channel: 'email' },
        email_queued: true,
      });
    },
    CreateLocalInvitation: (call: any, callback: any) => {
      record('CreateLocalInvitation', call);
      callback(null, { invitation: INVITATION, created: true });
    },
    JoinLocal: (call: any, callback: any) => {
      record('JoinLocal', call);
      callback(null, { joined: true, trip: AGGREGATE });
    },
    DeclineLocalInvitation: (call: any, callback: any) => {
      record('DeclineLocalInvitation', call);
      callback(null, { invitation: INVITATION });
    },
    RevokeLocalInvitation: (call: any, callback: any) => {
      record('RevokeLocalInvitation', call);
      callback(null, { invitation: INVITATION });
    },
    JoinTrip: (call: any, callback: any) => {
      record('JoinTrip', call);
      callback(null, {
        joined: true,
        trip: AGGREGATE,
        member_email_queued: true,
        member_email_reason: 'ALREADY_MEMBER',
      });
    },
  });

  ({ port } = await new Promise<{ port: number }>((resolve, reject) => {
    server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (error, bound) => {
      if (error) reject(error);
      else resolve({ port: bound });
    });
  }));

  store = new GrpcTripsStore({
    baseUrl: `127.0.0.1:${port}`,
    internalToken: 'secret',
    timeoutMs: 2000,
  });
});

after(async () => {
  await new Promise<void>((resolve) => server.tryShutdown(() => resolve()));
});

describe('GrpcTripsStore', () => {
  test('maps the trip aggregate, including nulls and reminders', async () => {
    seen.length = 0;
    const data = await store.getTrip('u1', 't1');
    assert.equal(data.trip.id, 't1');
    assert.equal(data.trip.destination_id, 'toronto');
    assert.equal(data.trip.cover_preset, null);
    assert.equal(data.trip.cover_photo_url, null);
    assert.equal(data.myRole, 'owner');
    assert.equal(data.spent, 40);
    assert.deepEqual(data.spentByCategory, [{ category: 'sight', amount: 40 }]);
    assert.equal(data.members[1]!.invited_email, 'friend@example.com');
    assert.equal(data.items[0]!.notes, null);
    assert.equal(data.items[0]!.reminder?.lead_minutes, 15);
    assert.equal(seen[0]!.actor, 'u1');
  });

  test('lists trips and defaults absent roles to viewer', async () => {
    const trips = await store.listMyTrips('u1');
    assert.equal(trips[0]!.id, 't1');
    assert.equal(trips[0]!.role, 'owner');
  });

  test('passes create fields and update clear flags', async () => {
    seen.length = 0;
    await store.createTrip('u1', {
      name: 'Toronto',
      destinationId: 'toronto',
      startDate: '2027-06-01',
      endDate: '2027-06-03',
      totalBudget: 1000,
      timezone: 'America/Toronto',
    });
    const create = seen[0]!.request;
    assert.equal(create.name, 'Toronto');
    assert.equal(create.destination_id, 'toronto');
    assert.equal(create.total_budget, 1000);
    assert.equal(create.timezone, 'America/Toronto');

    await store.updateTrip('u1', 't1', {
      destinationId: null,
      destinationName: null,
      coverPreset: null,
      coverPhotoUrl: null,
    });
    const update = seen[1]!.request;
    assert.equal(update.clear_destination_id, true);
    assert.equal(update.clear_destination_name, true);
    assert.equal(update.clear_cover_preset, true);
    assert.equal(update.remove_cover_photo, true);
  });

  test('an empty trip update reads the trip instead of mutating it', async () => {
    seen.length = 0;
    await store.updateTrip('u1', 't1', {});
    assert.deepEqual(seen.map((row) => row.method), ['GetTrip']);
  });

  test('maps item updates, cost and move requests', async () => {
    seen.length = 0;
    await store.updateItem('u1', 't1', 'i1', {
      startTime: null,
      notes: null,
      locationText: null,
      title: 'New title',
    });
    const update = seen[0]!.request;
    assert.equal(update.clear_start_time, true);
    assert.equal(update.clear_notes, true);
    assert.equal(update.clear_location_text, true);
    assert.equal(update.title, 'New title');

    const cost = await store.setItemCost('u1', 't1', 'i1', 99);
    assert.equal(cost.cost, 99);

    const moved = await store.moveItem('u1', 't1', 'i1', '2027-06-02', 4);
    assert.equal(moved.day, '2027-06-02');
    assert.equal(moved.order, 4);
  });

  test('sends reminder fields and maps the reminder', async () => {
    seen.length = 0;
    await store.setItemReminder('u1', 't1', 'i1', {
      enabled: true,
      leadMinutes: 30,
      recipientIds: ['u1', 'u2'],
      startTime: null,
    });
    const request = seen[0]!.request;
    assert.equal(request.lead_minutes, 30);
    assert.deepEqual(request.recipient_ids, ['u1', 'u2']);
    assert.equal(request.clear_start_time, true);

    const reminder = await store.getItemReminder('u1', 't1', 'i1');
    assert.equal(reminder.enabled, true);
    assert.deepEqual(reminder.recipient_ids, ['u1']);
  });

  test('member helpers map roles and ids', async () => {
    assert.equal(await store.getMemberRole('u1', 't1'), 'owner');
    assert.deepEqual(await store.listMemberIds('u1', 't1'), ['u1', 'u2']);
    assert.equal(await store.isMember('u1', 't1'), true);
  });

  test('maps invitations, local join and join reasons', async () => {
    const preview = await store.previewInvitation('code');
    assert.equal(preview.invitation.email, 'friend@example.com');
    assert.equal(preview.trip.destination_name, 'Toronto');

    const local = await store.createLocalInvitation('u1', 't1', 'u2', 'editor');
    assert.equal(local.invitee_user_id, 'u2');
    assert.equal(local.channel, 'local');

    const joined = await store.joinTrip('u1', 't1', {
      userId: 'u1',
      email: 'friend@example.com',
      code: 'code',
      notify: { ownerEmail: 'o@example.com', ownerName: 'Owner', memberName: 'Friend', language: 'en' },
    });
    assert.equal(joined.memberEmailQueued, true);
    assert.equal(joined.reason, 'ALREADY_MEMBER');
  });

  test('maps gRPC status plus x-error-code to the GraphQL error code', async () => {
    await assert.rejects(
      () => store.getTrip('u1', 'missing'),
      (error) => codeOf(error) === 'TRIP_NOT_FOUND',
    );
  });

  test('factory keeps HTTP as the default and selects gRPC by flag', () => {
    const http = createTripsStore({
      baseUrl: 'http://trips',
      grpcUrl: `127.0.0.1:${port}`,
      internalToken: 'secret',
      timeoutMs: 100,
    });
    assert.ok(http instanceof RemoteTripsStore);
    const grpcStore = createTripsStore({
      baseUrl: 'http://trips',
      grpcUrl: `127.0.0.1:${port}`,
      transport: 'grpc',
      internalToken: 'secret',
      timeoutMs: 100,
    });
    assert.ok(grpcStore instanceof GrpcTripsStore);
  });
});
