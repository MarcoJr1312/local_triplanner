// gRPC users adapter contract: metadata, mapping, partial updates and errors.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as grpc from '@grpc/grpc-js';
import * as loader from '@grpc/proto-loader';
import { fileURLToPath } from 'node:url';
import { GraphQLError } from 'graphql';
import { GrpcUsersStore } from '../src/users/grpc.ts';
import { createUsersStore } from '../src/users/index.ts';
import { RemoteUsersStore } from '../src/users/remote.ts';

const PROTO_PATH = fileURLToPath(
  new URL('../../../proto/triplanner/users/v1/users.proto', import.meta.url),
);

const USER = {
  id: '11111111-1111-4111-8111-111111111111',
  username: 'demo',
  email: 'demo@triplanner.local',
  display_name: 'Demo',
  color: '#6366f1',
  avatar_url: '',
  language: 'en',
  created_at: '2026-11-21T00:00:00.000Z',
  deleted_at: '',
};

const NOTIFICATION = {
  id: '33333333-3333-4333-8333-333333333333',
  user_id: USER.id,
  type: 'trip_invite',
  trip_id: 'demo-trip',
  trip_name: 'Toronto',
  invitation_id: 'inv-1',
  inviter_user_id: '',
  role: 'viewer',
  item_id: '',
  item_title: '',
  start_at: '',
  lead_minutes: 0,
  dedupe_key: '',
  status: 'unread',
  created_at: '2026-11-21T00:00:00.000Z',
  read_at: '',
};

interface SeenCall {
  method: string;
  token?: string;
  actor?: string;
  request: Record<string, unknown>;
}

const seen: SeenCall[] = [];
let server: grpc.Server;
let port = 0;
let store: GrpcUsersStore;

function value(md: grpc.Metadata, key: string): string | undefined {
  const values = md.get(key);
  return Array.isArray(values) && values.length > 0 ? String(values[0]) : undefined;
}

function fail(callback: grpc.sendUnaryData<any>, status: grpc.status, code: string): void {
  const metadata = new grpc.Metadata();
  metadata.set('x-error-code', code);
  callback({ code: status, details: code, metadata });
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
  });
  const proto = grpc.loadPackageDefinition(definition) as any;
  const descriptor = proto.triplanner.users.v1.UsersService;

  server = new grpc.Server();
  server.addService(descriptor.service, {
    GetUser: (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
      seen.push({
        method: 'GetUser',
        token: value(call.metadata, 'x-internal-token'),
        actor: value(call.metadata, 'x-actor-id'),
        request: call.request,
      });
      if (call.request.user_id !== USER.id) {
        fail(callback, grpc.status.NOT_FOUND, 'USER_NOT_FOUND');
        return;
      }
      callback(null, { user: USER });
    },
    GetByUsername: (
      call: grpc.ServerUnaryCall<any, any>,
      callback: grpc.sendUnaryData<any>,
    ) => {
      if (call.request.username !== USER.username) {
        fail(callback, grpc.status.NOT_FOUND, 'USER_NOT_FOUND');
        return;
      }
      callback(null, { user: USER });
    },
    GetByEmail: (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
      if (call.request.email !== USER.email) {
        fail(callback, grpc.status.NOT_FOUND, 'USER_NOT_FOUND');
        return;
      }
      callback(null, { user: USER });
    },
    UpdateUser: (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
      seen.push({
        method: 'UpdateUser',
        token: value(call.metadata, 'x-internal-token'),
        actor: value(call.metadata, 'x-actor-id'),
        request: call.request,
      });
      callback(null, {
        user: {
          ...USER,
          display_name: call.request.display_name ?? USER.display_name,
          language: call.request.language ?? USER.language,
          color: call.request.color ?? USER.color,
          avatar_url: call.request.avatar_url ?? USER.avatar_url,
        },
      });
    },
    Login: (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
      if (call.request.password !== 'secret') {
        fail(callback, grpc.status.UNAUTHENTICATED, 'INVALID_CREDENTIALS');
        return;
      }
      callback(null, { user: USER });
    },
    ListNotifications: (
      call: grpc.ServerUnaryCall<any, any>,
      callback: grpc.sendUnaryData<any>,
    ) => {
      seen.push({
        method: 'ListNotifications',
        actor: value(call.metadata, 'x-actor-id'),
        request: call.request,
      });
      callback(null, { items: [NOTIFICATION] });
    },
    ListFavoriteIds: (
      call: grpc.ServerUnaryCall<any, any>,
      callback: grpc.sendUnaryData<any>,
    ) => {
      seen.push({
        method: 'ListFavoriteIds',
        actor: value(call.metadata, 'x-actor-id'),
        request: call.request,
      });
      callback(null, { ids: ['tor-cn-tower'] });
    },
    SetFavorite: (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
      seen.push({
        method: 'SetFavorite',
        actor: value(call.metadata, 'x-actor-id'),
        request: call.request,
      });
      callback(null, {
        location_id: call.request.location_id,
        favorite: call.request.favorite,
      });
    },
  });

  ({ port } = await new Promise<{ port: number }>((resolve, reject) => {
    server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (error, bound) => {
      if (error) reject(error);
      else resolve({ port: bound });
    });
  }));

  store = new GrpcUsersStore({
    baseUrl: `127.0.0.1:${port}`,
    internalToken: 'secret',
    timeoutMs: 2000,
  });
});

after(async () => {
  await new Promise<void>((resolve) => server.tryShutdown(() => resolve()));
});

describe('GrpcUsersStore', () => {
  test('maps a user and sends the internal token without an actor', async () => {
    seen.length = 0;
    const user = await store.getUser(USER.id);
    assert.equal(user?.id, USER.id);
    assert.equal(user?.avatar_url, null);
    assert.equal(seen[0]!.token, 'secret');
    assert.equal(seen[0]!.actor, undefined);
  });

  test('returns null when the service reports NOT_FOUND', async () => {
    assert.equal(await store.getUser('missing'), null);
    assert.equal(await store.getByUsername('missing'), null);
    assert.equal(await store.getByEmail('missing@example.com'), null);
  });

  test('sends the actor for favorites and notifications', async () => {
    seen.length = 0;
    const favorites = await store.listFavoriteIds(USER.id);
    assert.deepEqual([...favorites], ['tor-cn-tower']);
    assert.equal(seen[0]!.actor, USER.id);

    assert.equal(await store.setFavorite(USER.id, 'tor-cn-tower', true), true);
    assert.deepEqual(seen[1]!.request, {
      user_id: USER.id,
      location_id: 'tor-cn-tower',
      favorite: true,
    });

    const notifications = await store.listNotifications(USER.id, 'unread');
    assert.equal(notifications[0]!.id, NOTIFICATION.id);
    assert.equal(notifications[0]!.inviter_user_id, null);
    assert.equal(seen[2]!.request.status, 'unread');
  });

  test('sends only the profile fields present in the patch', async () => {
    seen.length = 0;
    const user = await store.updateUser(USER.id, { color: '#123456' });
    assert.equal(user.color, '#123456');
    assert.equal(seen[0]!.request.display_name, undefined);
    assert.equal(seen[0]!.request.color, '#123456');
    assert.equal(seen[0]!.actor, USER.id);

    await store.updateUser(USER.id, { avatarUrl: null });
    assert.equal(seen[1]!.request.avatar_url, '');
    assert.equal(seen[1]!.request.display_name, undefined);
  });

  test('maps gRPC status plus x-error-code to the GraphQL error code', async () => {
    await assert.rejects(
      () => store.login('demo', 'wrong'),
      (error) => codeOf(error) === 'INVALID_CREDENTIALS',
    );
  });

  test('factory keeps HTTP as the default and selects gRPC by flag', () => {
    const http = createUsersStore({
      baseUrl: 'http://users',
      grpcUrl: `127.0.0.1:${port}`,
      internalToken: 'secret',
      timeoutMs: 100,
    });
    assert.ok(http instanceof RemoteUsersStore);
    const grpcStore = createUsersStore({
      baseUrl: 'http://users',
      grpcUrl: `127.0.0.1:${port}`,
      transport: 'grpc',
      internalToken: 'secret',
      timeoutMs: 100,
    });
    assert.ok(grpcStore instanceof GrpcUsersStore);
  });
});
