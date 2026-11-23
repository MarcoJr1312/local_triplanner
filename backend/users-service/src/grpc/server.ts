// Users service gRPC listener. It wraps the same domain service as the HTTP
// routes; GraphQL keeps using the API facade.

import * as grpc from '@grpc/grpc-js';
import * as loader from '@grpc/proto-loader';
import { fileURLToPath } from 'node:url';
import { AppError, type ErrorCode } from '../errors.ts';
import type { UsersService } from '../domain/service.ts';
import type { NotificationPublic, UserPublic } from '../domain/types.ts';

const PROTO_PATH =
  process.env.PROTO_PATH ??
  fileURLToPath(new URL('../../../../proto/triplanner/users/v1/users.proto', import.meta.url));

const ERROR_STATUS: Partial<Record<ErrorCode, grpc.status>> = {
  UNAUTHORIZED: grpc.status.UNAUTHENTICATED,
  ACTOR_REQUIRED: grpc.status.UNAUTHENTICATED,
  INVALID_ARGUMENT: grpc.status.INVALID_ARGUMENT,
  USER_NOT_FOUND: grpc.status.NOT_FOUND,
  NOTIFICATION_NOT_FOUND: grpc.status.NOT_FOUND,
  FORBIDDEN: grpc.status.PERMISSION_DENIED,
  PROTECTED_USER: grpc.status.PERMISSION_DENIED,
  USERNAME_TAKEN: grpc.status.ALREADY_EXISTS,
  EMAIL_TAKEN: grpc.status.ALREADY_EXISTS,
  INVALID_CREDENTIALS: grpc.status.UNAUTHENTICATED,
  UNAVAILABLE: grpc.status.UNAVAILABLE,
};

function grpcError(error: unknown): grpc.ServiceError {
  const app = error instanceof AppError ? error : null;
  const status = app ? (ERROR_STATUS[app.code] ?? grpc.status.INTERNAL) : grpc.status.INTERNAL;
  const message = app ? app.message : 'Internal error';
  const metadata = new grpc.Metadata();
  if (app) metadata.set('x-error-code', app.code);
  const serviceError = new Error(message) as grpc.ServiceError;
  serviceError.code = status;
  serviceError.metadata = metadata;
  return serviceError;
}

function requireToken(call: grpc.ServerUnaryCall<unknown, unknown>, expected: string): void {
  const values = call.metadata.get('x-internal-token');
  const provided = Array.isArray(values) ? String(values[0] ?? '') : '';
  if (!expected || provided !== expected) {
    throw new AppError('UNAUTHORIZED', 'Token interno inválido.');
  }
}

function actor(call: grpc.ServerUnaryCall<unknown, unknown>): string {
  const values = call.metadata.get('x-actor-id');
  return Array.isArray(values) ? String(values[0] ?? '').trim() : '';
}

function requireActor(call: grpc.ServerUnaryCall<unknown, unknown>): string {
  const value = actor(call);
  if (!value) throw new AppError('ACTOR_REQUIRED', 'x-actor-id requerido.');
  return value;
}

function emptyIfNull(value: string | null | undefined): string {
  return value ?? '';
}

function toUser(user: UserPublic) {
  return {
    id: user.id,
    username: user.username,
    email: emptyIfNull(user.email),
    display_name: user.display_name,
    color: emptyIfNull(user.color),
    avatar_url: emptyIfNull(user.avatar_url),
    language: user.language,
    created_at: user.created_at,
    deleted_at: emptyIfNull(user.deleted_at),
  };
}

function toNotification(notification: NotificationPublic) {
  return {
    id: notification.id,
    user_id: '',
    type: notification.type,
    trip_id: notification.trip_id,
    trip_name: notification.trip_name,
    invitation_id: emptyIfNull(notification.invitation_id),
    inviter_user_id: emptyIfNull(notification.inviter_user_id),
    role: emptyIfNull(notification.role),
    item_id: emptyIfNull(notification.item_id),
    item_title: emptyIfNull(notification.item_title),
    start_at: emptyIfNull(notification.start_at),
    lead_minutes: notification.lead_minutes ?? 0,
    dedupe_key: '',
    status: notification.status,
    created_at: notification.created_at,
    read_at: emptyIfNull(notification.read_at),
    inviter: notification.inviter ? toUser(notification.inviter) : null,
  };
}

export interface UsersGrpcOptions {
  service: UsersService;
  port: number;
  internalToken: string;
}

export interface UsersGrpcHandle {
  server: grpc.Server;
  stop: () => Promise<void>;
}

export async function startUsersGrpcServer(
  options: UsersGrpcOptions,
): Promise<UsersGrpcHandle> {
  const definition = loader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: false,
    oneofs: true,
  });
  const proto = grpc.loadPackageDefinition(definition) as any;
  const descriptor = proto.triplanner.users.v1.UsersService;
  const service = options.service;

  const server = new grpc.Server();
  server.addService(descriptor.service, {
    GetUser: async (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
      try {
        requireToken(call, options.internalToken);
        callback(null, { user: toUser(await service.getUser(call.request.user_id)) });
      } catch (error) {
        callback(grpcError(error));
      }
    },
    GetByUsername: async (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
      try {
        requireToken(call, options.internalToken);
        callback(null, {
          user: toUser(await service.getByUsername(call.request.username)),
        });
      } catch (error) {
        callback(grpcError(error));
      }
    },
    GetByEmail: async (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
      try {
        requireToken(call, options.internalToken);
        callback(null, { user: toUser(await service.getByEmail(call.request.email)) });
      } catch (error) {
        callback(grpcError(error));
      }
    },
    ListUsers: async (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
      try {
        requireToken(call, options.internalToken);
        const items = await service.listUsers(call.request.query, call.request.limit);
        callback(null, { items: items.map(toUser) });
      } catch (error) {
        callback(grpcError(error));
      }
    },
    BatchUsers: async (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
      try {
        requireToken(call, options.internalToken);
        const items = await service.batchUsers(call.request.ids ?? []);
        callback(null, { items: items.map(toUser) });
      } catch (error) {
        callback(grpcError(error));
      }
    },
    Login: async (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
      try {
        requireToken(call, options.internalToken);
        callback(null, {
          user: toUser(
            await service.login({
              username: call.request.username,
              password: call.request.password,
            }),
          ),
        });
      } catch (error) {
        callback(grpcError(error));
      }
    },
    CreateUser: async (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
      try {
        requireToken(call, options.internalToken);
        const user = await service.createUser({
          username: call.request.username,
          password: call.request.password,
          displayName: call.request.display_name,
          language: call.request.language,
        });
        callback(null, { user: toUser(user) });
      } catch (error) {
        callback(grpcError(error));
      }
    },
    UpdateUser: async (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
      try {
        requireToken(call, options.internalToken);
        const user = await service.updateProfile(requireActor(call), call.request.user_id, {
          display_name: call.request.display_name,
          language: call.request.language,
          avatar_url: call.request.avatar_url,
          color: call.request.color,
        });
        callback(null, { user: toUser(user) });
      } catch (error) {
        callback(grpcError(error));
      }
    },
    DeleteUser: async (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
      try {
        requireToken(call, options.internalToken);
        await service.deleteUser(call.request.user_id);
        callback(null, {});
      } catch (error) {
        callback(grpcError(error));
      }
    },
    CreateNotification: async (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
      try {
        requireToken(call, options.internalToken);
        const request = call.request;
        const result = await service.createNotification({
          user_id: request.user_id,
          type: request.type || 'trip_invite',
          trip_id: request.trip_id,
          trip_name: request.trip_name,
          invitation_id: request.invitation_id,
          inviter_user_id: request.inviter_user_id,
          role: request.role,
          item_id: request.item_id,
          item_title: request.item_title,
          start_at: request.start_at,
          lead_minutes: request.lead_minutes,
          dedupe_key: request.dedupe_key,
        });
        callback(null, {
          notification: toNotification(result.notification),
          created: result.created,
        });
      } catch (error) {
        callback(grpcError(error));
      }
    },
    ListNotifications: async (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
      try {
        requireToken(call, options.internalToken);
        const items = await service.listNotifications(
          requireActor(call),
          call.request.user_id,
          call.request.status || null,
          call.request.limit || null,
        );
        callback(null, { items: items.map(toNotification) });
      } catch (error) {
        callback(grpcError(error));
      }
    },
    GetNotification: async (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
      try {
        requireToken(call, options.internalToken);
        callback(null, {
          notification: toNotification(
            await service.getNotification(requireActor(call), call.request.notification_id),
          ),
        });
      } catch (error) {
        callback(grpcError(error));
      }
    },
    UpdateNotification: async (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
      try {
        requireToken(call, options.internalToken);
        callback(null, {
          notification: toNotification(
            await service.updateNotification(
              requireActor(call),
              call.request.notification_id,
              call.request.status,
            ),
          ),
        });
      } catch (error) {
        callback(grpcError(error));
      }
    },
    ListFavoriteIds: async (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
      try {
        requireToken(call, options.internalToken);
        const actorId = requireActor(call);
        if (actorId !== call.request.user_id) {
          throw new AppError('FORBIDDEN', 'No autorizado para leer estos favoritos.');
        }
        const items = await service.listFavorites(call.request.user_id);
        callback(null, { ids: items.map((item) => item.location_id) });
      } catch (error) {
        callback(grpcError(error));
      }
    },
    SetFavorite: async (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
      try {
        requireToken(call, options.internalToken);
        const actorId = requireActor(call);
        if (actorId !== call.request.user_id) {
          throw new AppError('FORBIDDEN', 'No autorizado para modificar estos favoritos.');
        }
        const result = await service.setFavorite(
          call.request.user_id,
          call.request.location_id,
          Boolean(call.request.favorite),
        );
        callback(null, {
          location_id: result.location_id,
          favorite: result.favorite,
        });
      } catch (error) {
        callback(grpcError(error));
      }
    },
  });

  await new Promise<void>((resolve, reject) => {
    server.bindAsync(
      `0.0.0.0:${options.port}`,
      grpc.ServerCredentials.createInsecure(),
      (error) => (error ? reject(error) : resolve()),
    );
  });

  return {
    server,
    stop: async () => {
      await new Promise<void>((resolve) => {
        server.tryShutdown(() => resolve());
      });
    },
  };
}
