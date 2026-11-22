import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { GraphQLError } from 'graphql';
import { RemoteTripsStore } from '../src/trips/remote.ts';

const AGGREGATE = {
  id: 't1',
  name: 'Toronto',
  destination_id: 'toronto',
  destination_name: 'Toronto',
  destination_lat: 43.65,
  destination_lng: -79.38,
  start_date: '2026-12-04',
  end_date: '2026-12-06',
  total_budget: 500,
  cover_preset: null,
  cover_photo_url: null,
  timezone: 'UTC',
  owner_id: 'demo-user',
  invite_code: 'DEMO123',
  created_at: '2026-11-21T00:00:00.000Z',
  updated_at: '2026-11-21T00:00:00.000Z',
  my_role: 'owner',
  members: [
    {
      user_id: 'demo-user',
      role: 'owner',
      joined_at: '2026-11-21T00:00:00.000Z',
      invited_email: null,
    },
  ],
  items: [],
  spent: 42,
  spent_by_category: [{ category: 'sight', amount: 42 }],
};

function storeWith(fetchImpl: typeof fetch): RemoteTripsStore {
  return new RemoteTripsStore({
    baseUrl: 'http://trips',
    internalToken: 'secret',
    timeoutMs: 100,
    fetchImpl,
  });
}

describe('RemoteTripsStore', () => {
  test('maps the aggregate and sends token plus actor', async () => {
    let seenUrl = '';
    let seenHeaders: Record<string, string> = {};

    const store = storeWith(async (input, init) => {
      seenUrl = String(input);
      seenHeaders = (init?.headers ?? {}) as Record<string, string>;
      return new Response(JSON.stringify(AGGREGATE), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const data = await store.getTrip('demo-user', 't1');

    assert.equal(seenUrl, 'http://trips/internal/v1/trips/t1');
    assert.equal(seenHeaders['x-internal-token'], 'secret');
    assert.equal(seenHeaders['x-actor-id'], 'demo-user');
    assert.equal(data.myRole, 'owner');
    assert.equal(data.trip.id, 't1');
    assert.equal(data.members[0]?.user_id, 'demo-user');
    assert.equal(data.spent, 42);
    assert.deepEqual(data.spentByCategory, [{ category: 'sight', amount: 42 }]);
  });

  test('createInvitation sends app_url and maps the queue flag', async () => {
    const captured: { body?: Record<string, unknown> } = {};

    const store = storeWith(async (_input, init) => {
      captured.body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          invitation: {
            id: 'inv-1',
            trip_id: 't1',
            email: 'friend@example.com',
            code: 'ABCDEFGHIJKL',
            role: 'editor',
            status: 'pending',
            created_by: 'demo-user',
            created_at: '2026-11-21T00:00:00.000Z',
            accepted_at: null,
          },
          email: { queued: true },
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      );
    });

    const result = await store.createInvitation('demo-user', 't1', {
      email: 'friend@example.com',
      role: 'editor',
      notify: {
        inviterName: 'Demo',
        language: 'es',
        appUrl: 'http://localhost:3000',
        demo: true,
      },
    });

    const notify = captured.body?.notify as Record<string, unknown>;
    assert.equal(notify.app_url, 'http://localhost:3000');
    assert.equal(notify.join_url, undefined);
    assert.equal(notify.inviter_name, 'Demo');
    assert.equal(result.emailQueued, true);
    assert.equal(result.invitation.code, 'ABCDEFGHIJKL');
  });

  test('joinTrip maps joined, reason and the aggregate', async () => {
    const store = storeWith(async () =>
      new Response(
        JSON.stringify({
          joined: false,
          trip: AGGREGATE,
          member_email: { queued: false, reason: 'ALREADY_MEMBER' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const result = await store.joinTrip('demo-user', 't1', {
      userId: 'demo-friend',
      email: 'friend@example.com',
      code: 'ABCDEFGHIJKL',
    });

    assert.equal(result.joined, false);
    assert.equal(result.reason, 'ALREADY_MEMBER');
    assert.equal(result.memberEmailQueued, false);
    assert.equal(result.data.trip.id, 't1');
  });

  test('maps a service outage to TRIPS_UNAVAILABLE', async () => {
    const store = storeWith(
      async () =>
        new Response(JSON.stringify({ error: 'UNAVAILABLE', message: 'down' }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        }),
    );

    await assert.rejects(
      () => store.getTrip('demo-user', 't1'),
      (error: unknown) =>
        error instanceof GraphQLError && error.extensions.code === 'TRIPS_UNAVAILABLE',
    );
  });

  test('maps a network failure to TRIPS_UNAVAILABLE', async () => {
    const store = storeWith(async () => {
      throw new Error('ECONNREFUSED');
    });

    await assert.rejects(
      () => store.getTrip('demo-user', 't1'),
      (error: unknown) =>
        error instanceof GraphQLError && error.extensions.code === 'TRIPS_UNAVAILABLE',
    );
  });
});
