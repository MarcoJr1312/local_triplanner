import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import type { Db } from '../src/db.ts';
import { migrate } from '../src/db/migrate.ts';
import { UsersService } from '../src/domain/service.ts';
import type { NotificationPublic, UserPublic } from '../src/domain/types.ts';
import { createHandler } from '../src/http.ts';
import { connectTestDb, resetSchema } from './helpers/pg.ts';

let db: Db | null = null;
let handler: ((req: Request) => Promise<Response>) | null = null;

beforeAll(async () => {
  db = await connectTestDb();
  if (db) {
    handler = createHandler({
      db,
      internalToken: 'test-token',
      service: new UsersService(db),
    });
  } else {
    console.warn('[users] test database unavailable; notification tests return early');
  }
});

beforeEach(async () => {
  if (!db) return;
  await resetSchema(db);
  await migrate(db);
});

interface CallOptions {
  method?: string;
  body?: unknown;
  actor?: string;
}

function call(path: string, options: CallOptions = {}): Promise<Response> {
  if (!handler) throw new Error('test database unavailable');
  const headers: Record<string, string> = { 'x-internal-token': 'test-token' };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.actor) headers['x-actor-id'] = options.actor;
  return handler(
    new Request(`http://localhost${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
  );
}

async function body<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function createUser(username: string): Promise<UserPublic> {
  const response = await call('/internal/v1/users', {
    method: 'POST',
    body: { username, password: 'secret123', display_name: `User ${username}` },
  });
  expect(response.status).toBe(201);
  return body<UserPublic>(response);
}

interface InviteOptions {
  invitationId?: string;
  role?: string;
  type?: string;
  tripName?: string;
}

async function invite(
  invitee: UserPublic,
  inviter: UserPublic,
  options: InviteOptions = {},
): Promise<Response> {
  return call('/internal/v1/notifications', {
    method: 'POST',
    body: {
      user_id: invitee.id,
      type: options.type ?? 'trip_invite',
      trip_id: 'demo-trip',
      trip_name: options.tripName ?? 'Fin de semana en Toronto',
      invitation_id: options.invitationId ?? 'inv-1',
      inviter_user_id: inviter.id,
      role: options.role ?? 'viewer',
    },
  });
}

describe('activity reminder notifications', () => {
  test('creates one reminder per user/dedupe key and lists it', async () => {
    const user = await createUser('reminder-user');
    const payload = {
      user_id: user.id,
      type: 'activity_reminder',
      trip_id: 'demo-trip',
      trip_name: 'Toronto',
      item_id: 'demo-item-1',
      item_title: 'CN Tower',
      start_at: '2026-12-04T10:00:00.000Z',
      lead_minutes: 60,
      dedupe_key: 'activity_reminder:demo-item-1:user:due',
    };

    const first = await call('/internal/v1/notifications', {
      method: 'POST',
      body: payload,
    });
    expect(first.status).toBe(201);
    const notification = await body<NotificationPublic>(first);
    expect(notification).toMatchObject({
      type: 'activity_reminder',
      trip_id: 'demo-trip',
      item_id: 'demo-item-1',
      item_title: 'CN Tower',
      lead_minutes: 60,
      status: 'unread',
      invitation_id: null,
      role: null,
    });
    expect(notification.start_at).toBe('2026-12-04T10:00:00.000Z');

    const second = await call('/internal/v1/notifications', {
      method: 'POST',
      body: payload,
    });
    expect(second.status).toBe(200);
    expect((await body<NotificationPublic>(second)).id).toBe(notification.id);

    const list = await body<{ items: NotificationPublic[] }>(
      await call(`/internal/v1/users/${user.id}/notifications`, { actor: user.id }),
    );
    expect(list.items).toHaveLength(1);
    expect(list.items[0]?.type).toBe('activity_reminder');
  });

  test('rejects an invalid lead time', async () => {
    const user = await createUser('reminder-invalid');
    const response = await call('/internal/v1/notifications', {
      method: 'POST',
      body: {
        user_id: user.id,
        type: 'activity_reminder',
        trip_id: 'demo-trip',
        trip_name: 'Toronto',
        item_id: 'demo-item-1',
        item_title: 'CN Tower',
        start_at: '2026-12-04T10:00:00.000Z',
        lead_minutes: 7,
        dedupe_key: 'k',
      },
    });
    expect(response.status).toBe(400);
    expect(await body<{ error: string }>(response)).toMatchObject({
      error: 'INVALID_ARGUMENT',
    });
  });
});

describe('local invite notifications', () => {
  test('creates a notification with the inviter snapshot and lists it for the invitee', async () => {
    const invitee = await createUser('invitee');
    const inviter = await createUser('inviter');

    const response = await invite(invitee, inviter);
    expect(response.status).toBe(201);
    const notification = await body<NotificationPublic>(response);
    expect(notification).toMatchObject({
      type: 'trip_invite',
      trip_id: 'demo-trip',
      trip_name: 'Fin de semana en Toronto',
      invitation_id: 'inv-1',
      role: 'viewer',
      status: 'unread',
      read_at: null,
    });
    expect(notification.inviter).toMatchObject({
      id: inviter.id,
      username: 'inviter',
    });
    expect(JSON.stringify(notification)).not.toContain('password_hash');

    const list = await call(`/internal/v1/users/${invitee.id}/notifications`, {
      actor: invitee.id,
    });
    expect(list.status).toBe(200);
    const items = await body<{ items: NotificationPublic[] }>(list);
    expect(items.items).toHaveLength(1);
    expect(items.items[0]!.id).toBe(notification.id);

    const inviterList = await body<{ items: NotificationPublic[] }>(
      await call(`/internal/v1/users/${inviter.id}/notifications`, { actor: inviter.id }),
    );
    expect(inviterList.items).toHaveLength(0);
  });

  test('treats a repeated invitation as idempotent', async () => {
    const invitee = await createUser('invitee');
    const inviter = await createUser('inviter');

    const first = await body<NotificationPublic>(await invite(invitee, inviter));
    const secondResponse = await invite(invitee, inviter);
    expect(secondResponse.status).toBe(200);
    const second = await body<NotificationPublic>(secondResponse);
    expect(second.id).toBe(first.id);

    const items = await body<{ items: NotificationPublic[] }>(
      await call(`/internal/v1/users/${invitee.id}/notifications`, { actor: invitee.id }),
    );
    expect(items.items).toHaveLength(1);
  });

  test('enforces notification ownership', async () => {
    const invitee = await createUser('invitee');
    const inviter = await createUser('inviter');
    const notification = await body<NotificationPublic>(await invite(invitee, inviter));

    const list = await call(`/internal/v1/users/${invitee.id}/notifications`, {
      actor: inviter.id,
    });
    expect(list.status).toBe(403);

    for (const response of [
      await call(`/internal/v1/notifications/${notification.id}`, { actor: inviter.id }),
      await call(`/internal/v1/notifications/${notification.id}`, {
        method: 'PATCH',
        actor: inviter.id,
        body: { status: 'accepted' },
      }),
    ]) {
      expect(response.status).toBe(404);
      expect(await body<{ error: string }>(response)).toMatchObject({
        error: 'NOTIFICATION_NOT_FOUND',
      });
    }

    const own = await call(`/internal/v1/notifications/${notification.id}`, {
      actor: invitee.id,
    });
    expect(own.status).toBe(200);
  });

  test('moves unread -> read -> accepted and filters by status', async () => {
    const invitee = await createUser('invitee');
    const inviter = await createUser('inviter');
    const notification = await body<NotificationPublic>(await invite(invitee, inviter));

    const read = await call(`/internal/v1/notifications/${notification.id}`, {
      method: 'PATCH',
      actor: invitee.id,
      body: { status: 'read' },
    });
    expect(read.status).toBe(200);
    const readBody = await body<NotificationPublic>(read);
    expect(readBody.status).toBe('read');
    expect(readBody.read_at).not.toBeNull();

    const accepted = await call(`/internal/v1/notifications/${notification.id}`, {
      method: 'PATCH',
      actor: invitee.id,
      body: { status: 'accepted' },
    });
    expect(accepted.status).toBe(200);
    expect((await body<NotificationPublic>(accepted)).status).toBe('accepted');

    // A terminal notification cannot be declined afterwards.
    const declined = await call(`/internal/v1/notifications/${notification.id}`, {
      method: 'PATCH',
      actor: invitee.id,
      body: { status: 'declined' },
    });
    expect(declined.status).toBe(400);

    // Repeat accept is idempotent, and read cannot downgrade it.
    for (const status of ['accepted', 'read']) {
      const response = await call(`/internal/v1/notifications/${notification.id}`, {
        method: 'PATCH',
        actor: invitee.id,
        body: { status },
      });
      expect(response.status).toBe(200);
      expect((await body<NotificationPublic>(response)).status).toBe('accepted');
    }

    const acceptedList = await body<{ items: NotificationPublic[] }>(
      await call(`/internal/v1/users/${invitee.id}/notifications?status=accepted`, {
        actor: invitee.id,
      }),
    );
    expect(acceptedList.items).toHaveLength(1);

    const unreadList = await body<{ items: NotificationPublic[] }>(
      await call(`/internal/v1/users/${invitee.id}/notifications?status=unread`, {
        actor: invitee.id,
      }),
    );
    expect(unreadList.items).toHaveLength(0);
  });

  test('rejects invalid invite payloads', async () => {
    const invitee = await createUser('invitee');
    const inviter = await createUser('inviter');

    for (const options of [{ role: 'owner' }, { type: 'email' }]) {
      const response = await invite(invitee, inviter, options);
      expect(response.status).toBe(400);
    }

    const self = await call('/internal/v1/notifications', {
      method: 'POST',
      body: {
        user_id: inviter.id,
        type: 'trip_invite',
        trip_id: 'demo-trip',
        trip_name: 'Toronto',
        invitation_id: 'inv-self',
        inviter_user_id: inviter.id,
        role: 'viewer',
      },
    });
    expect(self.status).toBe(400);

    const unknown = await call('/internal/v1/notifications', {
      method: 'POST',
      body: {
        user_id: randomUUID(),
        type: 'trip_invite',
        trip_id: 'demo-trip',
        trip_name: 'Toronto',
        invitation_id: 'inv-ghost',
        inviter_user_id: inviter.id,
        role: 'viewer',
      },
    });
    expect(unknown.status).toBe(404);

    const badStatus = await call(`/internal/v1/users/${invitee.id}/notifications?status=nope`, {
      actor: invitee.id,
    });
    expect(badStatus.status).toBe(400);
  });
});
