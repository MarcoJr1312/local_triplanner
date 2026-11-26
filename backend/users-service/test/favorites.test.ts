import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import type { Db } from '../src/db.ts';
import { migrate } from '../src/db/migrate.ts';
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
    console.warn('[users] test database unavailable; favorites tests return early');
  }
});

beforeEach(async () => {
  if (!db) return;
  await resetSchema(db);
  await migrate(db);
});

async function call(
  path: string,
  options: { method?: string; actor?: string } = {},
): Promise<Response> {
  if (!handler) throw new Error('test database unavailable');
  const headers: Record<string, string> = { 'x-internal-token': 'test-token' };
  if (options.actor) headers['x-actor-id'] = options.actor;
  return handler(
    new Request(`http://localhost${path}`, {
      method: options.method ?? 'GET',
      headers,
    }),
  );
}

async function createUser(username: string): Promise<UserPublic> {
  if (!handler) throw new Error('test database unavailable');
  const response = await handler(
    new Request('http://localhost/internal/v1/users', {
      method: 'POST',
      headers: {
        'x-internal-token': 'test-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ username, password: 'secret123', display_name: username }),
    }),
  );
  expect(response.status).toBe(201);
  return (await response.json()) as UserPublic;
}

describe('favorite places', () => {
  test('adds, lists and removes favorites idempotently', async () => {
    const user = await createUser('fav-user');

    const add = await call(
      `/internal/v1/users/${user.id}/favorites/tor-cn-tower`,
      { method: 'PUT', actor: user.id },
    );
    expect(add.status).toBe(200);
    expect(await add.json()).toEqual({
      location_id: 'tor-cn-tower',
      favorite: true,
    });

    // Repeating the add does not duplicate.
    const again = await call(
      `/internal/v1/users/${user.id}/favorites/tor-cn-tower`,
      { method: 'PUT', actor: user.id },
    );
    expect(again.status).toBe(200);

    const list = await call(`/internal/v1/users/${user.id}/favorites`, {
      actor: user.id,
    });
    expect(list.status).toBe(200);
    const payload = (await list.json()) as {
      items: { location_id: string }[];
    };
    expect(payload.items.map((item) => item.location_id)).toEqual(['tor-cn-tower']);

    const remove = await call(
      `/internal/v1/users/${user.id}/favorites/tor-cn-tower`,
      { method: 'DELETE', actor: user.id },
    );
    expect(remove.status).toBe(200);
    expect(await remove.json()).toEqual({
      location_id: 'tor-cn-tower',
      favorite: false,
    });

    const empty = await call(`/internal/v1/users/${user.id}/favorites`, {
      actor: user.id,
    });
    expect(((await empty.json()) as { items: unknown[] }).items).toEqual([]);
  });

  test('accepts opaque legacy ids that the catalogue does not know', async () => {
    const user = await createUser('legacy-fav');
    const response = await call(
      `/internal/v1/users/${user.id}/favorites/${encodeURIComponent('tor-cn-tower')}`,
      { method: 'PUT', actor: user.id },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ favorite: true });
  });

  test('rejects an unknown user, a foreign actor and an invalid id', async () => {
    const user = await createUser('fav-guard');

    const missing = await call(
      '/internal/v1/users/99999999-9999-4999-8999-999999999999/favorites/loc',
      { method: 'PUT', actor: '99999999-9999-4999-8999-999999999999' },
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: 'USER_NOT_FOUND' });

    const foreign = await call(`/internal/v1/users/${user.id}/favorites/loc`, {
      method: 'PUT',
      actor: '22222222-2222-4222-8222-222222222222',
    });
    expect(foreign.status).toBe(403);
    expect(await foreign.json()).toMatchObject({ error: 'FORBIDDEN' });

    const tooLong = await call(
      `/internal/v1/users/${user.id}/favorites/${'x'.repeat(129)}`,
      { method: 'PUT', actor: user.id },
    );
    expect(tooLong.status).toBe(400);
    expect(await tooLong.json()).toMatchObject({ error: 'INVALID_ARGUMENT' });
  });
});
