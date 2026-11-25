import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import * as grpc from '@grpc/grpc-js';
import * as loader from '@grpc/proto-loader';
import { fileURLToPath } from 'node:url';
import type { Db } from '../src/db.ts';
import { migrate } from '../src/db/migrate.ts';
import { UsersService } from '../src/domain/service.ts';
import { startUsersGrpcServer, type UsersGrpcHandle } from '../src/grpc/server.ts';
import { renderMetrics } from '../src/metrics.ts';
import { connectTestDb, resetSchema } from './helpers/pg.ts';

const PORT = 50059;
const PROTO_PATH = fileURLToPath(
  new URL('../../../proto/triplanner/users/v1/users.proto', import.meta.url),
);
const HEALTH_PROTO_PATH = fileURLToPath(
  new URL('../../../proto/grpc/health/v1/health.proto', import.meta.url),
);

let db: Db | null = null;
let service: UsersService | null = null;
let handle: UsersGrpcHandle | null = null;
let client: any = null;
let healthClient: any = null;

function call(method: string, request: unknown, actor?: string, token = 'test-token'): Promise<any> {
  return new Promise((resolve, reject) => {
    const md = new grpc.Metadata();
    md.set('x-internal-token', token);
    if (actor) md.set('x-actor-id', actor);
    client[method](request, md, { deadline: Date.now() + 5000 }, (error: any, value: any) => {
      if (error) reject(error);
      else resolve(value);
    });
  });
}

beforeAll(async () => {
  db = await connectTestDb();
  if (!db) {
    console.warn('[users] test database unavailable; gRPC tests return early');
    return;
  }
  await migrate(db);
  service = new UsersService(db);
  handle = await startUsersGrpcServer({
    service,
    port: PORT,
    internalToken: 'test-token',
  });
  const definition = loader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: false,
    oneofs: true,
  });
  const proto = grpc.loadPackageDefinition(definition) as any;
  client = new proto.triplanner.users.v1.UsersService(
    `127.0.0.1:${PORT}`,
    grpc.credentials.createInsecure(),
  );
  const healthDefinition = loader.loadSync(HEALTH_PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: false,
    oneofs: true,
  });
  const healthProto = grpc.loadPackageDefinition(healthDefinition) as any;
  healthClient = new healthProto.grpc.health.v1.Health(
    `127.0.0.1:${PORT}`,
    grpc.credentials.createInsecure(),
  );
});

beforeEach(async () => {
  if (!db) return;
  await resetSchema(db);
  await migrate(db);
});

afterAll(async () => {
  client?.close();
  healthClient?.close();
  await handle?.stop();
  await db?.close();
});

describe('users gRPC', () => {
  test('reports SERVING on the standard health service', async () => {
    if (!healthClient) return;
    const response = await new Promise<any>((resolve, reject) => {
      healthClient.Check({ service: '' }, (error: any, value: any) => {
        if (error) reject(error);
        else resolve(value);
      });
    });
    expect(response.status).toBe('SERVING');
  });
  test('creates, reads, logs in and favorites over gRPC', async () => {
    if (!service || !client) return;
    const user = await service.createUser({
      username: 'grpc-user',
      password: 'secret123',
      display_name: 'GRPC User',
      language: 'en',
    });

    const loaded = await call('GetUser', { user_id: user.id });
    expect(loaded.user.username).toBe('grpc-user');
    expect(loaded.user.language).toBe('en');

    const login = await call('Login', { username: 'GRPC-USER', password: 'secret123' });
    expect(login.user.id).toBe(user.id);

    const favorite = await call(
      'SetFavorite',
      { user_id: user.id, location_id: 'tor-cn-tower', favorite: true },
      user.id,
    );
    expect(favorite).toEqual({ location_id: 'tor-cn-tower', favorite: true });
    const ids = await call('ListFavoriteIds', { user_id: user.id }, user.id);
    expect(ids.ids).toEqual(['tor-cn-tower']);
  });

  test('updates only the profile fields present in the request', async () => {
    if (!service || !client) return;
    const user = await service.createUser({
      username: 'grpc-profile',
      password: 'secret123',
      display_name: 'Before',
      language: 'en',
    });

    const updated = await call(
      'UpdateUser',
      { user_id: user.id, color: '#123456' },
      user.id,
    );
    expect(updated.user.display_name).toBe('Before');
    expect(updated.user.language).toBe('en');
    expect(updated.user.color).toBe('#123456');

    const cleared = await call(
      'UpdateUser',
      { user_id: user.id, display_name: 'After', avatar_url: '' },
      user.id,
    );
    expect(cleared.user.display_name).toBe('After');
    expect(cleared.user.avatar_url).toBe('');
  });

  test('requires the internal token and actor metadata', async () => {
    if (!service || !client) return;
    const user = await service.createUser({
      username: 'grpc-guard',
      password: 'secret123',
      display_name: 'Guard',
    });

    await expect(call('GetUser', { user_id: user.id }, undefined, 'wrong')).rejects.toMatchObject({
      code: grpc.status.UNAUTHENTICATED,
    });
    await expect(call('ListNotifications', { user_id: user.id })).rejects.toMatchObject({
      code: grpc.status.UNAUTHENTICATED,
    });
    await expect(
      call('ListNotifications', { user_id: user.id }, '22222222-2222-4222-8222-222222222222'),
    ).rejects.toMatchObject({ code: grpc.status.PERMISSION_DENIED });
  });

  test('records gRPC calls and status codes in Prometheus metrics', async () => {
    if (!service || !client) return;
    const user = await service.createUser({
      username: 'grpc-metrics',
      password: 'secret123',
      display_name: 'Metrics',
    });

    await call('GetUser', { user_id: user.id });
    // bun test can race a trailers-only response on a just-used channel.
    await new Promise((resolve) => setTimeout(resolve, 100));
    await expect(call('GetUser', { user_id: user.id }, undefined, 'wrong')).rejects.toMatchObject({
      code: grpc.status.UNAUTHENTICATED,
    });

    const { body } = await renderMetrics();
    expect(body).toContain('triplanner_grpc_requests_total');
    expect(body).toContain('triplanner_grpc_request_duration_seconds');
    expect(body).toContain('method="GetUser"');
    expect(body).toContain('status="OK"');
    expect(body).toContain('status="UNAUTHENTICATED"');
    expect(body).toContain('service="users"');
  });
});
