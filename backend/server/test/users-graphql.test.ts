// GraphQL integration for users, local invites and notifications. The users
// store is real (test Postgres); the trips store is an in-memory double so this
// suite stays focused on API orchestration.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { graphql, parse, subscribe, type GraphQLError, type GraphQLSchema } from 'graphql';
import { createPubSub, createSchema } from 'graphql-yoga';
import { connectPg, deleteUser } from './helpers/pg.ts';
import type { PgDb } from '../src/pg/db.ts';
import { resolvers, type Ctx, type PubSub } from '../src/resolvers.ts';
import { loadTypeDefs } from '../src/schema.ts';
import { LocalUsersStore } from '../src/users/local.ts';
import type { UserRecord } from '../src/users/types.ts';
import type { TripData, TripsStore } from '../src/trips/types.ts';
import type { InvitationRow } from '../src/schema-types.ts';

let db: PgDb | null = null;
let users: LocalUsersStore;
let schema: GraphQLSchema;
let inviter: UserRecord;
let invitee: UserRecord;
let declinee: UserRecord;
let subscriber: UserRecord;
let tripId: string;
let invitation: InvitationRow | null = null;
const localInvites = new Map<string, InvitationRow>();
const published: { topic: string; payload: unknown }[] = [];
const bus = createPubSub();
const ownedTrips = new Map<string, { role: 'owner' | 'editor' | 'viewer' }[]>();

const now = new Date().toISOString();

function tripData(members: TripData['members'], ownerId: string): TripData {
  return {
    trip: {
      id: tripId,
      name: 'Toronto',
      destination_id: 'toronto',
      destination_name: 'Toronto',
      destination_lat: null,
      destination_lng: null,
      start_date: '2026-12-04',
      end_date: '2026-12-06',
      total_budget: 0,
      cover_preset: null,
      cover_photo_url: null,
      timezone: 'UTC',
      owner_id: ownerId,
      invite_code: 'DEMO123',
      created_at: now,
      updated_at: now,
    },
    members,
    items: [],
    myRole: 'owner',
    spent: 0,
    spentByCategory: [],
  };
}

const trips = {
  async listMyTrips(userId: string) {
    return ownedTrips.get(userId) ?? [];
  },
  async getTrip(_userId: string, id: string) {
    assert.equal(id, tripId);
    return tripData(
      [{ user_id: inviter.id, role: 'owner', joined_at: now, invited_email: null }],
      inviter.id,
    );
  },
  async createLocalInvitation(
    userId: string,
    id: string,
    inviteeUserId: string,
    role: 'editor' | 'viewer',
  ) {
    assert.equal(id, tripId);
    const key = `${id}:${inviteeUserId}`;
    const existing = localInvites.get(key);
    if (existing && existing.status === 'pending') {
      invitation = existing;
      return existing;
    }
    invitation = {
      id: randomUUID(),
      trip_id: id,
      email: null,
      code: null,
      role,
      status: 'pending',
      created_by: userId,
      created_at: now,
      accepted_at: null,
      channel: 'local',
      invitee_user_id: inviteeUserId,
    };
    localInvites.set(key, invitation);
    return invitation;
  },
  async joinLocal(userId: string, id: string) {
    assert.equal(id, tripId);
    return {
      joined: true,
      data: tripData(
        [
          { user_id: inviter.id, role: 'owner', joined_at: now, invited_email: null },
          { user_id: userId, role: invitation?.role ?? 'viewer', joined_at: now, invited_email: null },
        ],
        inviter.id,
      ),
    };
  },
  async declineLocalInvitation() {
    assert.ok(invitation);
    invitation.status = 'declined';
    return invitation;
  },
  async isMember() {
    return true;
  },
  async assertMember() {},
} as unknown as TripsStore;

const pubsub: PubSub = {
  publish(topic, payload) {
    published.push({ topic, payload });
    bus.publish(topic, payload);
  },
  subscribe(topic) {
    return bus.subscribe(topic) as AsyncIterable<unknown>;
  },
};

function contextFor(currentUserId: string): Ctx {
  return {
    db: db as PgDb,
    catalogue: {} as Ctx['catalogue'],
    storage: {} as Ctx['storage'],
    currentUserId,
    pubsub,
    trips,
    users,
  };
}

async function run(
  source: string,
  currentUserId: string,
  variables?: Record<string, unknown>,
) {
  return graphql({
    schema,
    source,
    contextValue: contextFor(currentUserId),
    variableValues: variables,
  });
}

function codeOf(result: { errors?: readonly GraphQLError[] }): unknown {
  return result.errors?.[0]?.extensions?.code;
}

const INVITE = /* GraphQL */ `
  mutation Invite($tripId: ID!, $username: String!, $role: MemberRole!) {
    tripLocalInvite(tripId: $tripId, username: $username, role: $role) {
      invitationId
      notificationId
      status
      user { userId username }
    }
  }
`;

before(async () => {
  db = await connectPg();
  if (!db) return;
  users = new LocalUsersStore(db);
  schema = createSchema({ typeDefs: loadTypeDefs(), resolvers });

  inviter = await users.createUser({
    username: `host-${randomUUID().slice(0, 8)}`,
    password: 'secret123',
    displayName: 'Host',
  });
  invitee = await users.createUser({
    username: `guest-${randomUUID().slice(0, 8)}`,
    password: 'secret123',
    displayName: 'Guest',
  });
  declinee = await users.createUser({
    username: `declinee-${randomUUID().slice(0, 8)}`,
    password: 'secret123',
    displayName: 'Declinee',
  });
  subscriber = await users.createUser({
    username: `subscriber-${randomUUID().slice(0, 8)}`,
    password: 'secret123',
    displayName: 'Subscriber',
  });
  tripId = `trip-${randomUUID()}`;
});

after(async () => {
  if (!db) return;
  for (const user of [inviter, invitee, declinee, subscriber]) {
    if (!user) continue;
    await db.prepare('DELETE FROM notifications WHERE user_id = ?').run(user.id);
    await deleteUser(db, user.id);
  }
  await db.close();
});

describe('users and local invites over GraphQL', () => {
  test('logs in and lists users without exposing secrets', async () => {
    const result = await run(
      `mutation($username: String!, $password: String!) {
         login(username: $username, password: $password) {
           userId username displayName email
         }
       }`,
      invitee.id,
      { username: invitee.username, password: 'secret123' },
    );
    assert.equal(result.errors, undefined);
    const login = (result.data as { login: { userId: string; username: string } }).login;
    assert.equal(login.userId, invitee.id);
    assert.equal(login.username, invitee.username);

    const wrong = await run(
      'mutation($username: String!, $password: String!) { login(username: $username, password: $password) { userId } }',
      invitee.id,
      { username: invitee.username, password: 'nope' },
    );
    assert.equal(codeOf(wrong), 'INVALID_CREDENTIALS');

    const list = await run('{ listUsers { username } }', inviter.id);
    assert.equal(list.errors, undefined);
    const names = (list.data as { listUsers: { username: string }[] }).listUsers.map(
      (user) => user.username,
    );
    assert.ok(names.includes(inviter.username));
    assert.ok(names.includes(invitee.username));
    assert.ok(!JSON.stringify(list.data).includes('password'));
  });

  test('resolves invites by username, stores a notification and publishes it', async () => {
    published.length = 0;
    const result = await run(INVITE, inviter.id, {
      tripId,
      username: invitee.username.toUpperCase(),
      role: 'editor',
    });
    assert.equal(result.errors, undefined);
    const invite = (result.data as { tripLocalInvite: Record<string, unknown> }).tripLocalInvite;
    assert.equal(invite.status, 'pending');
    assert.deepEqual({ ...(invite.user as Record<string, unknown>) }, {
      userId: invitee.id,
      username: invitee.username,
    });

    const inbox = await users.listNotifications(invitee.id);
    const notification = inbox.find((row) => row.id === invite.notificationId);
    assert.ok(notification);
    assert.equal(notification.trip_name, 'Toronto');
    assert.equal(notification.inviter_user_id, inviter.id);

    const publishedForInvitee = published.filter(
      (entry) => entry.topic === `notify:${invitee.id}`,
    );
    assert.equal(publishedForInvitee.length, 1);
    assert.equal(publishedForInvitee[0]?.topic, `notify:${invitee.id}`);

    // Retry is idempotent: same invitation and notification.
    const retry = await run(INVITE, inviter.id, {
      tripId,
      username: invitee.username,
      role: 'editor',
    });
    assert.equal(retry.errors, undefined);
    assert.equal(
      (retry.data as { tripLocalInvite: { invitationId: string } }).tripLocalInvite.invitationId,
      invite.invitationId,
    );
    assert.equal(
      published.filter((entry) => entry.topic === `notify:${invitee.id}`).length,
      1,
    );

    // Accept from the inbox: trips membership + notification accepted.
    const accepted = await run(
      'mutation($id: ID!) { acceptTripLocalInvite(notificationId: $id) { id members { userId username role } } }',
      invitee.id,
      { id: invite.notificationId },
    );
    assert.equal(accepted.errors, undefined);
    const trip = (accepted.data as { acceptTripLocalInvite: { members: { userId: string }[] } })
      .acceptTripLocalInvite;
    assert.ok(trip.members.some((member) => member.userId === invitee.id));

    const updated = await users.getNotification(invitee.id, invite.notificationId as string);
    assert.equal(updated.status, 'accepted');

    const again = await run(
      'mutation($id: ID!) { acceptTripLocalInvite(notificationId: $id) { id } }',
      invitee.id,
      { id: invite.notificationId },
    );
    assert.equal(codeOf(again), 'INVITE_ALREADY_USED');
  });

  test('marks read and declines a fresh invite idempotently', async () => {
    // A separate invitee keeps this test independent of the accept flow.
    const result = await run(INVITE, inviter.id, {
      tripId,
      username: declinee.username,
      role: 'viewer',
    });
    assert.equal(result.errors, undefined);
    const invite = (result.data as { tripLocalInvite: { notificationId: string } })
      .tripLocalInvite;

    const read = await run(
      'mutation($id: ID!) { markNotificationRead(notificationId: $id) { id status } }',
      declinee.id,
      { id: invite.notificationId },
    );
    assert.equal(read.errors, undefined);
    assert.equal(
      (read.data as { markNotificationRead: { status: string } }).markNotificationRead.status,
      'read',
    );

    const declined = await run(
      'mutation($id: ID!) { declineTripLocalInvite(notificationId: $id) { id status } }',
      declinee.id,
      { id: invite.notificationId },
    );
    assert.equal(declined.errors, undefined);
    assert.equal(
      (declined.data as { declineTripLocalInvite: { status: string } }).declineTripLocalInvite
        .status,
      'declined',
    );

    const again = await run(
      'mutation($id: ID!) { declineTripLocalInvite(notificationId: $id) { status } }',
      declinee.id,
      { id: invite.notificationId },
    );
    assert.equal(
      (again.data as { declineTripLocalInvite: { status: string } }).declineTripLocalInvite.status,
      'declined',
    );
  });

  test('delivers onNotification over the live subscription', async () => {
    const result = await subscribe({
      schema,
      document: parse(
        'subscription { onNotification { id tripName status inviter { username } } }',
      ),
      contextValue: contextFor(subscriber.id),
    });
    if (!(Symbol.asyncIterator in result)) {
      assert.fail(`subscription failed: ${JSON.stringify(result)}`);
    }
    const iterator = result[Symbol.asyncIterator]();
    // Start listening before the mutation publishes.
    const eventPromise = iterator.next();

    const invited = await run(INVITE, inviter.id, {
      tripId,
      username: subscriber.username,
      role: 'viewer',
    });
    assert.equal(invited.errors, undefined);

    const event = await eventPromise;
    assert.equal(event.done, false);
    const payload = (event.value.data as {
      onNotification: { tripName: string; status: string; inviter: { username: string } };
    }).onNotification;
    assert.equal(payload.tripName, 'Toronto');
    assert.equal(payload.status, 'unread');
    assert.equal(payload.inviter.username, inviter.username);
    await iterator.return?.();
  });

  test('guards account deletion: protected demo ids and trip owners', async () => {
    if (!db) return;
    const deletable = await users.createUser({
      username: `delete-${randomUUID().slice(0, 8)}`,
      password: 'secret123',
      displayName: 'Deletable',
    });

    for (const userId of ['demo-user', '11111111-1111-4111-8111-111111111111']) {
      const result = await run(
        'mutation($id: ID!) { deleteUser(userId: $id) }',
        inviter.id,
        { id: userId },
      );
      assert.equal(codeOf(result), 'PROTECTED_USER');
    }

    ownedTrips.set(deletable.id, [{ role: 'owner' }]);
    const blocked = await run(
      'mutation($id: ID!) { deleteUser(userId: $id) }',
      inviter.id,
      { id: deletable.id },
    );
    assert.equal(codeOf(blocked), 'USER_OWNS_TRIPS');

    ownedTrips.delete(deletable.id);
    const deleted = await run(
      'mutation($id: ID!) { deleteUser(userId: $id) }',
      inviter.id,
      { id: deletable.id },
    );
    assert.equal(deleted.errors, undefined);
    assert.equal((deleted.data as { deleteUser: boolean }).deleteUser, true);

    const gone = await users
      .login(deletable.username, 'secret123')
      .catch((error: unknown) => error);
    assert.equal(
      (gone as { extensions?: { code?: string } }).extensions?.code,
      'INVALID_CREDENTIALS',
    );

    await deleteUser(db, deletable.id);
  });
});
