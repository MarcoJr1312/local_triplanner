// Local users adapter against the platform test database.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { GraphQLError } from 'graphql';
import { connectPg, cleanDemoUsers, deleteUser } from './helpers/pg.ts';
import type { PgDb } from '../src/pg/db.ts';
import { LocalUsersStore, ensureLocalDemoUsers } from '../src/users/local.ts';

let db: PgDb | null = null;
let store: LocalUsersStore;

before(async () => {
  db = await connectPg();
  if (db) store = new LocalUsersStore(db);
});

after(async () => {
  await db?.close();
});

function randomName(prefix = 'user'): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

async function createUser(prefix = 'user') {
  return store.createUser({
    username: randomName(prefix),
    password: 'secret123',
    displayName: 'Test User',
    language: 'es',
  });
}

function codeOf(error: unknown): string | undefined {
  return error instanceof GraphQLError ? error.extensions.code as string | undefined : undefined;
}

describe('LocalUsersStore accounts', () => {
  test('creates without email, logs in and hides deleted accounts', async () => {
    if (!db) return;
    const created = await createUser();
    assert.equal(created.email, null);
    assert.equal(created.language, 'es');
    assert.equal(created.deleted_at, null);

    const login = await store.login(created.username.toUpperCase(), 'secret123');
    assert.equal(login.id, created.id);

    await assert.rejects(
      () => store.login(created.username, 'wrong-password'),
      (error) => codeOf(error) === 'INVALID_CREDENTIALS',
    );

    await store.deleteUser(created.id);
    assert.equal(await store.getByUsername(created.username), null);
    const any = await store.getUser(created.id);
    assert.notEqual(any?.deleted_at, null);
    await assert.rejects(
      () => store.login(created.username, 'secret123'),
      (error) => codeOf(error) === 'INVALID_CREDENTIALS',
    );

    // The username is reusable after the soft delete.
    const reused = await store.createUser({
      username: created.username,
      password: 'secret123',
      displayName: 'Reused',
    });
    assert.notEqual(reused.id, created.id);
    await store.deleteUser(reused.id);
    await deleteUser(db, created.id);
  });

  test('rejects duplicates, protected demo ids and invalid input', async () => {
    if (!db) return;
    const created = await createUser();

    await assert.rejects(
      () =>
        store.createUser({
          username: created.username.toUpperCase(),
          password: 'secret123',
          displayName: 'Duplicate',
        }),
      (error) => codeOf(error) === 'USERNAME_TAKEN',
    );

    for (const id of ['demo-user', 'demo-friend', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']) {
      await assert.rejects(
        () => store.deleteUser(id),
        (error) => codeOf(error) === 'PROTECTED_USER',
      );
    }

    for (const input of [
      { username: 'ab', password: 'secret123', displayName: 'Short' },
      { username: 'bad name', password: 'secret123', displayName: 'Space' },
      { username: randomName(), password: '12345', displayName: 'Short Password' },
      { username: randomName(), password: 'secret123', displayName: ' ' },
    ]) {
      await assert.rejects(
        () => store.createUser(input),
        (error) => codeOf(error) === 'INVALID_ARGUMENT',
      );
    }

    await deleteUser(db, created.id);
  });

  test('updates the profile, lists and batches active and deleted users', async () => {
    if (!db) return;
    const first = await createUser('list');
    const second = await createUser('list');

    const updated = await store.updateUser(first.id, {
      displayName: 'Updated Name',
      language: 'en',
      color: '#123ABC',
    });
    assert.equal(updated.display_name, 'Updated Name');
    assert.equal(updated.language, 'en');

    const found = await store.listUsers('list-');
    const ids = found.map((user) => user.id);
    assert.ok(ids.includes(first.id));
    assert.ok(ids.includes(second.id));

    await store.deleteUser(second.id);
    const active = await store.listUsers('list-');
    assert.ok(!active.some((user) => user.id === second.id));

    const batch = await store.batchUsers([first.id, second.id, randomUUID()]);
    assert.equal(batch.length, 2);
    assert.notEqual(batch.find((user) => user.id === second.id)?.deleted_at, null);

    await deleteUser(db, first.id);
    await deleteUser(db, second.id);
  });

  test('seeds and logs in the protected demo accounts', async () => {
    if (!db) return;
    await cleanDemoUsers(db);
    await ensureLocalDemoUsers(db);

    const demo = await store.login('demo', 'demo123');
    assert.equal(demo.id, '11111111-1111-4111-8111-111111111111');
    assert.equal(demo.username, 'demo');
    assert.equal(demo.display_name, 'Demo');

    const friend = await store.login('DEMO-FRIEND', 'demo123');
    assert.equal(friend.id, '22222222-2222-4222-8222-222222222222');
    assert.equal(friend.username, 'demo-friend');
  });
});

describe('LocalUsersStore notifications', () => {
  test('creates idempotently, lists by owner and resolves terminal states', async () => {
    if (!db) return;
    const invitee = await createUser('invitee');
    const inviter = await createUser('inviter');

    const input = {
      userId: invitee.id,
      type: 'trip_invite' as const,
      tripId: 'trip-1',
      tripName: 'Toronto',
      invitationId: `inv-${randomUUID()}`,
      inviterUserId: inviter.id,
      role: 'viewer' as const,
    };

    const first = await store.createNotification(input);
    assert.equal(first.created, true);
    assert.equal(first.notification.status, 'unread');

    const retry = await store.createNotification(input);
    assert.equal(retry.created, false);
    assert.equal(retry.notification.id, first.notification.id);

    const inbox = await store.listNotifications(invitee.id);
    assert.equal(inbox.length, 1);

    await assert.rejects(
      () => store.getNotification(inviter.id, first.notification.id),
      (error) => codeOf(error) === 'NOTIFICATION_NOT_FOUND',
    );

    const read = await store.updateNotification(invitee.id, first.notification.id, 'read');
    assert.equal(read.status, 'read');
    assert.notEqual(read.read_at, null);

    const accepted = await store.updateNotification(
      invitee.id,
      first.notification.id,
      'accepted',
    );
    assert.equal(accepted.status, 'accepted');

    await assert.rejects(
      () => store.updateNotification(invitee.id, first.notification.id, 'declined'),
      (error) => codeOf(error) === 'INVALID_ARGUMENT',
    );

    const stillAccepted = await store.updateNotification(
      invitee.id,
      first.notification.id,
      'read',
    );
    assert.equal(stillAccepted.status, 'accepted');

    await db.prepare('DELETE FROM notifications WHERE user_id = ?').run(invitee.id);
    await deleteUser(db, invitee.id);
    await deleteUser(db, inviter.id);
  });

  test('rejects self invites and unknown targets', async () => {
    if (!db) return;
    const user = await createUser('notify');

    await assert.rejects(
      () =>
        store.createNotification({
          userId: user.id,
          type: 'trip_invite',
          tripId: 'trip-1',
          tripName: 'Toronto',
          invitationId: `inv-${randomUUID()}`,
          inviterUserId: user.id,
          role: 'viewer',
        }),
      (error) => codeOf(error) === 'INVALID_ARGUMENT',
    );

    await assert.rejects(
      () =>
        store.createNotification({
          userId: randomUUID(),
          type: 'trip_invite',
          tripId: 'trip-1',
          tripName: 'Toronto',
          invitationId: `inv-${randomUUID()}`,
          inviterUserId: user.id,
          role: 'viewer',
        }),
      (error) => codeOf(error) === 'USER_NOT_FOUND',
    );

    await deleteUser(db, user.id);
  });
});
