import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import type { Db } from '../src/db.ts';
import { migrate } from '../src/db/migrate.ts';
import { DEMO_USER_UUID, seedDemoUsers } from '../src/db/seed.ts';
import { UsersService } from '../src/domain/service.ts';
import type { UserPublic } from '../src/domain/types.ts';
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
    console.warn('[users] test database unavailable; user API tests return early');
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
  token?: string;
}

function call(path: string, options: CallOptions = {}): Promise<Response> {
  if (!handler) throw new Error('test database unavailable');
  const headers: Record<string, string> = {
    'x-internal-token': options.token ?? 'test-token',
  };
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

async function createUser(
  username: string,
  displayName = `User ${username}`,
  password = 'secret123',
): Promise<UserPublic> {
  const response = await call('/internal/v1/users', {
    method: 'POST',
    body: { username, password, display_name: displayName },
  });
  expect(response.status).toBe(201);
  return body<UserPublic>(response);
}

describe('create and login', () => {
  test('creates an account without email and logs in with username + password', async () => {
    const response = await call('/internal/v1/users', {
      method: 'POST',
      body: { username: 'alice', password: 'secret123', display_name: 'Alice' },
    });
    expect(response.status).toBe(201);

    const user = await body<UserPublic>(response);
    expect(user).toMatchObject({
      username: 'alice',
      display_name: 'Alice',
      email: null,
      language: 'es',
      deleted_at: null,
    });
    expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(user)).not.toContain('password_hash');
    expect(JSON.stringify(user)).not.toContain('argon2');

    const login = await call('/internal/v1/auth/login', {
      method: 'POST',
      body: { username: 'ALICE ', password: 'secret123' },
    });
    expect(login.status).toBe(200);
    expect(await body<UserPublic>(login)).toMatchObject({ id: user.id, username: 'alice' });
  });

  test('rejects duplicate usernames and invalid credentials', async () => {
    await createUser('alice');

    const duplicate = await call('/internal/v1/users', {
      method: 'POST',
      body: { username: 'Alice', password: 'secret123', display_name: 'Other' },
    });
    expect(duplicate.status).toBe(409);
    expect(await body<{ error: string }>(duplicate)).toMatchObject({ error: 'USERNAME_TAKEN' });

    const wrong = await call('/internal/v1/auth/login', {
      method: 'POST',
      body: { username: 'alice', password: 'wrong-password' },
    });
    expect(wrong.status).toBe(401);
    expect(await body<{ error: string }>(wrong)).toMatchObject({ error: 'INVALID_CREDENTIALS' });

    const unknown = await call('/internal/v1/auth/login', {
      method: 'POST',
      body: { username: 'nobody', password: 'secret123' },
    });
    expect(unknown.status).toBe(401);
    expect(await body<{ error: string }>(unknown)).toMatchObject({
      error: 'INVALID_CREDENTIALS',
    });
  });

  test('validates username, password and display name on create', async () => {
    for (const payload of [
      { username: 'ab', password: 'secret123', display_name: 'Short' },
      { username: 'bad name', password: 'secret123', display_name: 'Space' },
      { username: 'alice', password: '12345', display_name: 'Short Password' },
      { username: 'alice', password: 'secret123', display_name: '   ' },
    ]) {
      const response = await call('/internal/v1/users', { method: 'POST', body: payload });
      expect(response.status).toBe(400);
      expect(await body<{ error: string }>(response)).toMatchObject({
        error: 'INVALID_ARGUMENT',
      });
    }
  });
});

describe('reads and search', () => {
  test('lists active users, searches by display name and hides deleted accounts', async () => {
    const alice = await createUser('alice', 'Alice Doe');
    await createUser('bob', 'Bob Stone');

    const all = await body<{ items: UserPublic[] }>(await call('/internal/v1/users'));
    expect(all.items.map((user) => user.username)).toEqual(['alice', 'bob']);

    const search = await body<{ items: UserPublic[] }>(
      await call('/internal/v1/users?query=doe'),
    );
    expect(search.items).toHaveLength(1);
    expect(search.items[0]!.id).toBe(alice.id);

    // `%` is literal, not a SQL wildcard.
    const wildcard = await body<{ items: UserPublic[] }>(
      await call('/internal/v1/users?query=%25'),
    );
    expect(wildcard.items).toHaveLength(0);

    await call(`/internal/v1/users/${alice.id}`, { method: 'DELETE' });
    const after = await body<{ items: UserPublic[] }>(await call('/internal/v1/users'));
    expect(after.items.map((user) => user.username)).toEqual(['bob']);
  });

  test('finds a user by username and by legacy demo email', async () => {
    if (!db) return;
    await seedDemoUsers(db);

    const byUsername = await call('/internal/v1/users/by-username/DEMO');
    expect(byUsername.status).toBe(200);
    expect(await body<UserPublic>(byUsername)).toMatchObject({ id: DEMO_USER_UUID });

    const byEmail = await call('/internal/v1/users/by-email/demo@triplanner.local');
    expect(byEmail.status).toBe(200);
    expect(await body<UserPublic>(byEmail)).toMatchObject({ username: 'demo' });

    const missing = await call('/internal/v1/users/by-username/nobody');
    expect(missing.status).toBe(404);
    expect(await body<{ error: string }>(missing)).toMatchObject({ error: 'USER_NOT_FOUND' });
  });

  test('returns soft-deleted users by id and batches ids', async () => {
    const alice = await createUser('alice');
    const bob = await createUser('bob');
    await call(`/internal/v1/users/${alice.id}`, { method: 'DELETE' });

    const byId = await call(`/internal/v1/users/${alice.id}`);
    expect(byId.status).toBe(200);
    expect((await body<UserPublic>(byId)).deleted_at).not.toBeNull();

    const batch = await body<{ items: UserPublic[] }>(
      await call('/internal/v1/users/batch', {
        method: 'POST',
        body: { ids: [alice.id, bob.id, 'not-a-uuid', randomUUID()] },
      }),
    );
    expect(batch.items.map((user) => user.username)).toEqual(['alice', 'bob']);

    const malformed = await call('/internal/v1/users/demo-user');
    expect(malformed.status).toBe(404);
  });

  test('rejects an invalid limit', async () => {
    const response = await call('/internal/v1/users?limit=0');
    expect(response.status).toBe(400);
  });
});

describe('profile and deletion', () => {
  test('updates only the actor profile', async () => {
    const alice = await createUser('alice');

    const updated = await call(`/internal/v1/users/${alice.id}`, {
      method: 'PATCH',
      actor: alice.id,
      body: { display_name: 'Alice Updated', language: 'en', color: '#123ABC' },
    });
    expect(updated.status).toBe(200);
    expect(await body<UserPublic>(updated)).toMatchObject({
      display_name: 'Alice Updated',
      language: 'en',
      color: '#123ABC',
    });

    const other = await call(`/internal/v1/users/${alice.id}`, {
      method: 'PATCH',
      actor: randomUUID(),
      body: { display_name: 'Hijacked' },
    });
    expect(other.status).toBe(403);
    expect(await body<{ error: string }>(other)).toMatchObject({ error: 'FORBIDDEN' });

    const empty = await call(`/internal/v1/users/${alice.id}`, {
      method: 'PATCH',
      actor: alice.id,
      body: {},
    });
    expect(empty.status).toBe(400);

    const invalidLanguage = await call(`/internal/v1/users/${alice.id}`, {
      method: 'PATCH',
      actor: alice.id,
      body: { language: 'fr' },
    });
    expect(invalidLanguage.status).toBe(400);
  });

  test('protects the demo accounts from deletion', async () => {
    if (!db) return;
    await seedDemoUsers(db);

    for (const id of [DEMO_USER_UUID, '22222222-2222-4222-8222-222222222222']) {
      const response = await call(`/internal/v1/users/${id}`, { method: 'DELETE' });
      expect(response.status).toBe(403);
      expect(await body<{ error: string }>(response)).toMatchObject({ error: 'PROTECTED_USER' });
    }
  });

  test('soft-deletes an account, frees the username and blocks login', async () => {
    const alice = await createUser('alice');

    const deleted = await call(`/internal/v1/users/${alice.id}`, { method: 'DELETE' });
    expect(deleted.status).toBe(200);
    expect(await body(deleted)).toEqual({ deleted: true });

    // Repeat deletion is idempotent; unknown ids are 404.
    expect((await call(`/internal/v1/users/${alice.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await call(`/internal/v1/users/${randomUUID()}`, { method: 'DELETE' })).status).toBe(
      404,
    );

    const login = await call('/internal/v1/auth/login', {
      method: 'POST',
      body: { username: 'alice', password: 'secret123' },
    });
    expect(login.status).toBe(401);

    // The username can be reused by a new account.
    const reused = await createUser('alice', 'Alice Again');
    expect(reused.id).not.toBe(alice.id);
    expect((await call(`/internal/v1/users/${alice.id}`, { method: 'PATCH', actor: alice.id, body: { display_name: 'Nope' } })).status).toBe(404);
  });

  test('requires the internal token on every user route', async () => {
    const response = await call('/internal/v1/users', { token: 'wrong' });
    expect(response.status).toBe(401);
  });
});
