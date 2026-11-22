// Remote users adapter contract: paths, actor headers, mapping and errors.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { GraphQLError } from 'graphql';
import { RemoteUsersStore } from '../src/users/remote.ts';

const USER = {
  id: '11111111-1111-4111-8111-111111111111',
  username: 'demo',
  email: 'demo@triplanner.local',
  display_name: 'Demo',
  color: '#6366f1',
  avatar_url: null,
  language: 'es',
  created_at: '2026-11-21T00:00:00.000Z',
  deleted_at: null,
};

const NOTIFICATION = {
  id: '33333333-3333-4333-8333-333333333333',
  type: 'trip_invite',
  trip_id: 'demo-trip',
  trip_name: 'Toronto',
  invitation_id: 'inv-1',
  inviter_user_id: '44444444-4444-4444-8444-444444444444',
  role: 'viewer',
  status: 'unread',
  created_at: '2026-11-21T00:00:00.000Z',
  read_at: null,
};

function storeWith(fetchImpl: typeof fetch): RemoteUsersStore {
  return new RemoteUsersStore({
    baseUrl: 'http://users',
    internalToken: 'secret',
    timeoutMs: 100,
    fetchImpl,
  });
}

function codeOf(error: unknown): string | undefined {
  return error instanceof GraphQLError ? (error.extensions.code as string | undefined) : undefined;
}

describe('RemoteUsersStore', () => {
  test('maps a user and sends the internal token', async () => {
    let seenUrl = '';
    let seenHeaders: Record<string, string> = {};

    const store = storeWith(async (input, init) => {
      seenUrl = String(input);
      seenHeaders = (init?.headers ?? {}) as Record<string, string>;
      return Response.json(USER);
    });

    const user = await store.getByUsername('DEMO');
    assert.equal(user?.id, USER.id);
    assert.equal(user?.username, 'demo');
    assert.equal(seenUrl, 'http://users/internal/v1/users/by-username/DEMO');
    assert.equal(seenHeaders['x-internal-token'], 'secret');
    assert.equal(seenHeaders['x-actor-id'], undefined);
  });

  test('returns null for a missing user and maps login errors', async () => {
    const missing = storeWith(async () =>
      Response.json({ error: 'USER_NOT_FOUND', message: 'no' }, { status: 404 }),
    );
    assert.equal(await missing.getUser('nope'), null);
    assert.equal(await missing.getByEmail('nope@example.com'), null);

    const invalid = storeWith(async () =>
      Response.json({ error: 'INVALID_CREDENTIALS', message: 'bad' }, { status: 401 }),
    );
    await assert.rejects(
      () => invalid.login('demo', 'wrong'),
      (error) => codeOf(error) === 'INVALID_CREDENTIALS',
    );
  });

  test('creates accounts without email and patches as the actor', async () => {
    const calls: { url: string; method: string; headers: Record<string, string>; body: unknown }[] = [];
    const store = storeWith(async (input, init) => {
      calls.push({
        url: String(input),
        method: init?.method ?? 'GET',
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return Response.json(USER, { status: init?.method === 'POST' ? 201 : 200 });
    });

    await store.createUser({
      username: 'demo',
      password: 'secret123',
      displayName: 'Demo',
    });
    assert.equal(calls[0]?.method, 'POST');
    assert.deepEqual(calls[0]?.body, {
      username: 'demo',
      password: 'secret123',
      display_name: 'Demo',
      language: 'es',
    });

    await store.updateUser(USER.id, { displayName: 'New', language: 'en' });
    assert.equal(calls[1]?.method, 'PATCH');
    assert.equal(calls[1]?.headers['x-actor-id'], USER.id);
    assert.deepEqual(calls[1]?.body, { display_name: 'New', language: 'en' });
  });

  test('batches users and skips the call for an empty list', async () => {
    let calls = 0;
    const store = storeWith(async () => {
      calls += 1;
      return Response.json({ items: [USER] });
    });

    assert.deepEqual(await store.batchUsers([]), []);
    assert.equal(calls, 0);

    const rows = await store.batchUsers([USER.id, USER.id]);
    assert.equal(rows.length, 1);
    assert.equal(calls, 1);
  });

  test('creates notifications with 201/200 and lists them as the owner', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const statuses = [201, 200];
    let index = 0;

    const store = storeWith(async (input, init) => {
      calls.push({
        url: String(input),
        headers: (init?.headers ?? {}) as Record<string, string>,
      });
      if (String(input).includes('/notifications?') || String(input).includes('/notifications') && (init?.method ?? 'GET') === 'GET') {
        return Response.json({ items: [NOTIFICATION] });
      }
      return Response.json(NOTIFICATION, { status: statuses[index++] ?? 200 });
    });

    const first = await store.createNotification({
      userId: USER.id,
      type: 'trip_invite',
      tripId: 'demo-trip',
      tripName: 'Toronto',
      invitationId: 'inv-1',
      inviterUserId: '44444444-4444-4444-8444-444444444444',
      role: 'viewer',
    });
    assert.equal(first.created, true);
    assert.equal(first.notification.status, 'unread');

    const second = await store.createNotification({
      userId: USER.id,
      type: 'trip_invite',
      tripId: 'demo-trip',
      tripName: 'Toronto',
      invitationId: 'inv-1',
      inviterUserId: '44444444-4444-4444-8444-444444444444',
      role: 'viewer',
    });
    assert.equal(second.created, false);

    const list = await store.listNotifications(USER.id, 'unread');
    assert.equal(list.length, 1);
    const listCall = calls.find((call) => call.url.includes('?status=unread'));
    assert.equal(listCall?.headers['x-actor-id'], USER.id);
  });

  test('maps an unavailable service', async () => {
    const store = storeWith(async () => {
      throw new TypeError('fetch failed');
    });

    await assert.rejects(
      () => store.listUsers(),
      (error) => codeOf(error) === 'USERS_UNAVAILABLE',
    );
  });
});
