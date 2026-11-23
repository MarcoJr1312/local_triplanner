// @ts-nocheck
// Frontend facade contract: auth session, user admin and local invite payloads.
// Fetch is mocked; no browser or backend is required.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ApiError, api, localizeApiError } from './api';

let calls: { url: string; body: Record<string, unknown> }[] = [];
const originalFetch = globalThis.fetch;
const sessionStorage = new Map<string, string>();

function installLocalStorage(): void {
  const stub = {
    getItem: (key: string) => sessionStorage.get(key) ?? null,
    setItem: (key: string, value: string) => sessionStorage.set(key, String(value)),
    removeItem: (key: string) => sessionStorage.delete(key),
    clear: () => sessionStorage.clear(),
    key: (index: number) => [...sessionStorage.keys()][index] ?? null,
    get length() {
      return sessionStorage.size;
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: stub,
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: stub },
  });
}

function mockData(data: unknown): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) : {},
    });
    return Response.json({ data });
  }) as typeof fetch;
}

beforeEach(() => {
  calls = [];
  sessionStorage.clear();
  installLocalStorage();
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  await api.logout();
});

const PROFILE = {
  userId: 'u1',
  username: 'demo',
  email: 'demo@triplanner.local',
  displayName: 'Demo',
  color: '#6366f1',
  avatarUrl: null,
  language: 'en',
};

describe('api auth and users', () => {
  test('login sends username + password and keeps the session', async () => {
    mockData({ login: PROFILE });

    const profile = await api.login('demo', 'demo123');

    expect(profile).toMatchObject({ userId: 'u1', username: 'demo' });
    expect(calls[0]?.url).toBe('/api/graphql');
    expect(String(calls[0]?.body.query)).toContain('login');
    expect(calls[0]?.body.variables).toEqual({ username: 'demo', password: 'demo123' });
    expect(api.getCurrentUser()?.userId).toBe('u1');
  });

  test('maps GraphQL auth errors to ApiError codes', async () => {
    globalThis.fetch = (async () =>
      Response.json({
        errors: [
          { message: 'Usuario o contraseña incorrectos.', extensions: { code: 'INVALID_CREDENTIALS' } },
        ],
      })) as typeof fetch;

    await expect(api.login('demo', 'nope')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
  });

  test('lists, creates and deletes accounts with the expected inputs', async () => {
    mockData({ listUsers: [PROFILE] });
    expect(await api.listUsers('demo')).toHaveLength(1);
    expect(calls[0]?.body.variables).toEqual({ query: 'demo' });

    mockData({ createUser: { ...PROFILE, userId: 'u2', username: 'new-user' } });
    const created = await api.createUser({
      username: 'new-user',
      password: 'secret123',
      displayName: 'New User',
    });
    expect(created.userId).toBe('u2');
    expect(calls[1]?.body.variables).toEqual({
      input: {
        username: 'new-user',
        password: 'secret123',
        displayName: 'New User',
        language: 'en',
      },
    });

    mockData({ deleteUser: true });
    expect(await api.deleteUser('u2')).toBe(true);
    expect(calls[2]?.body.variables).toEqual({ userId: 'u2' });
  });

  test('restores a legacy session without username', async () => {
    sessionStorage.set(
      'triplanner.local.session',
      JSON.stringify({ userId: 'u9', displayName: 'Old Demo', email: 'old@example.com' }),
    );

    const restored = await api.restoreSession();
    expect(restored?.username).toBe('Old Demo');
    expect(restored?.userId).toBe('u9');
  });
});

describe('api error localization', () => {
  const t = (key: string) => key;

  test('uses the stable code instead of the server message', () => {
    expect(
      localizeApiError(
        new ApiError('order: debe estar entre 0 y 1000000', { code: 'INVALID_ARGUMENT' }),
        t,
      ),
    ).toBe('errors.INVALID_ARGUMENT');
  });

  test('never leaks an unmapped server message', () => {
    expect(
      localizeApiError(new ApiError('mensaje del servidor', { code: 'UNKNOWN_CODE' }), t),
    ).toBe('errors.generic');
    expect(localizeApiError(new ApiError('sin código'), t)).toBe('errors.generic');
  });
});

describe('api local invites and notifications', () => {
  test('sends the username invite variables and returns the target user', async () => {
    mockData({
      tripLocalInvite: {
        invitationId: 'inv-1',
        notificationId: 'notif-1',
        status: 'pending',
        user: { ...PROFILE, userId: 'u2', username: 'guest' },
      },
    });

    const result = await api.tripLocalInvite('trip-1', ' guest ', 'editor');

    expect(result.notificationId).toBe('notif-1');
    expect(result.user.username).toBe('guest');
    expect(calls[0]?.body.variables).toEqual({
      tripId: 'trip-1',
      username: 'guest',
      role: 'editor',
    });
  });

  test('loads notifications and resolves accept/decline/read', async () => {
    const notification = {
      id: 'notif-1',
      type: 'trip_invite',
      tripId: 'trip-1',
      tripName: 'Toronto',
      invitationId: 'inv-1',
      role: 'viewer',
      status: 'unread',
      createdAt: '2026-11-21T00:00:00.000Z',
      readAt: null,
      inviter: PROFILE,
    };

    mockData({ myNotifications: [notification] });
    const inbox = await api.myNotifications();
    expect(inbox[0]?.inviter?.username).toBe('demo');

    mockData({ markNotificationRead: { ...notification, status: 'read' } });
    expect((await api.markNotificationRead('notif-1')).status).toBe('read');

    mockData({ declineTripLocalInvite: { ...notification, status: 'declined' } });
    expect((await api.declineTripLocalInvite('notif-1')).status).toBe('declined');

    mockData({
      acceptTripLocalInvite: {
        id: 'trip-1',
        name: 'Toronto',
        members: [],
        items: [],
        myRole: 'viewer',
      },
    });
    const trip = await api.acceptTripLocalInvite('notif-1');
    expect(trip.id).toBe('trip-1');
    expect(calls.at(-1)?.body.variables).toEqual({ id: 'notif-1' });
  });
});
