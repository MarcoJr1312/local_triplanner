// gRPC adapter for the users service. The GraphQL resolvers keep using the
// UsersStore port; this adapter is selected by USERS_TRANSPORT=grpc.

import * as grpc from '@grpc/grpc-js';
import * as loader from '@grpc/proto-loader';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { usersError } from './errors.ts';
import type {
  CreateNotificationData,
  CreateNotificationResult,
  CreateReminderNotificationData,
  CreateUserData,
  NotificationRecord,
  NotificationStatus,
  UpdateUserData,
  UserRecord,
  UsersStore,
} from './types.ts';

const PROTO_ROOT =
  process.env.PROTO_ROOT ??
  fileURLToPath(new URL('../../../../proto', import.meta.url));
const PROTO_PATH = path.join(PROTO_ROOT, 'triplanner', 'users', 'v1', 'users.proto');

interface GrpcUsersOptions {
  baseUrl: string;
  internalToken: string;
  timeoutMs: number;
}

function emptyToNull(value: string | null | undefined): string | null {
  return value ? value : null;
}

function toUser(raw: any): UserRecord {
  return {
    id: String(raw.id ?? ''),
    username: String(raw.username ?? ''),
    email: emptyToNull(raw.email),
    display_name: String(raw.display_name ?? ''),
    color: emptyToNull(raw.color),
    avatar_url: emptyToNull(raw.avatar_url),
    language: String(raw.language ?? 'en'),
    created_at: String(raw.created_at ?? ''),
    deleted_at: emptyToNull(raw.deleted_at),
  };
}

function toNotification(raw: any): NotificationRecord {
  return {
    id: String(raw.id ?? ''),
    user_id: String(raw.user_id ?? ''),
    type: String(raw.type ?? 'trip_invite'),
    trip_id: String(raw.trip_id ?? ''),
    trip_name: String(raw.trip_name ?? ''),
    invitation_id: emptyToNull(raw.invitation_id),
    inviter_user_id: emptyToNull(raw.inviter_user_id),
    role: emptyToNull(raw.role),
    item_id: emptyToNull(raw.item_id),
    item_title: emptyToNull(raw.item_title),
    start_at: emptyToNull(raw.start_at),
    lead_minutes: raw.lead_minutes ? Number(raw.lead_minutes) : null,
    dedupe_key: emptyToNull(raw.dedupe_key),
    status: String(raw.status ?? 'unread') as NotificationStatus,
    created_at: String(raw.created_at ?? ''),
    read_at: emptyToNull(raw.read_at),
  };
}

function errorCode(error: any): string {
  const metadata = error?.metadata as grpc.Metadata | undefined;
  const values = metadata?.get('x-error-code');
  if (Array.isArray(values) && values.length > 0) return String(values[0]);
  switch (error?.code) {
    case grpc.status.NOT_FOUND:
      return 'USER_NOT_FOUND';
    case grpc.status.PERMISSION_DENIED:
      return 'FORBIDDEN';
    case grpc.status.UNAUTHENTICATED:
      return 'UNAUTHORIZED';
    case grpc.status.ALREADY_EXISTS:
      return 'USERNAME_TAKEN';
    case grpc.status.UNAVAILABLE:
    case grpc.status.DEADLINE_EXCEEDED:
      return 'USERS_UNAVAILABLE';
    default:
      return 'USERS_UNAVAILABLE';
  }
}

function toError(error: any): Error {
  return usersError(errorCode(error), String(error?.details ?? error?.message ?? 'users error'));
}

export class GrpcUsersStore implements UsersStore {
  private readonly client: any;
  private readonly token: string;
  private readonly timeoutMs: number;

  constructor(options: GrpcUsersOptions) {
    this.token = options.internalToken;
    this.timeoutMs = options.timeoutMs;
    const definition = loader.loadSync(PROTO_PATH, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: false,
      oneofs: true,
    });
    const proto = grpc.loadPackageDefinition(definition) as any;
    const descriptor = proto.triplanner.users.v1.UsersService;
    this.client = new descriptor(options.baseUrl, grpc.credentials.createInsecure());
  }

  private invoke<T>(
    method: string,
    request: Record<string, unknown>,
    actorId?: string | null,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const metadata = new grpc.Metadata();
      metadata.set('x-internal-token', this.token);
      if (actorId) metadata.set('x-actor-id', actorId);
      this.client[method](
        request,
        metadata,
        { deadline: Date.now() + this.timeoutMs },
        (error: any, value: T) => {
          if (error) reject(toError(error));
          else resolve(value);
        },
      );
    });
  }

  async getUser(id: string): Promise<UserRecord | null> {
    try {
      return toUser((await this.invoke<any>('GetUser', { user_id: id })).user);
    } catch (error) {
      if (errorCodeFromError(error) === 'USER_NOT_FOUND') return null;
      throw error;
    }
  }

  async getByUsername(username: string): Promise<UserRecord | null> {
    try {
      return toUser((await this.invoke<any>('GetByUsername', { username })).user);
    } catch (error) {
      if (errorCodeFromError(error) === 'USER_NOT_FOUND') return null;
      throw error;
    }
  }

  async getByEmail(email: string): Promise<UserRecord | null> {
    try {
      return toUser((await this.invoke<any>('GetByEmail', { email })).user);
    } catch (error) {
      if (errorCodeFromError(error) === 'USER_NOT_FOUND') return null;
      throw error;
    }
  }

  async listUsers(query = ''): Promise<UserRecord[]> {
    const response = await this.invoke<any>('ListUsers', { query });
    return (response.items ?? []).map(toUser);
  }

  async batchUsers(ids: readonly string[]): Promise<UserRecord[]> {
    if (ids.length === 0) return [];
    const response = await this.invoke<any>('BatchUsers', { ids: [...ids] });
    return (response.items ?? []).map(toUser);
  }

  async login(username: string, password: string): Promise<UserRecord> {
    const response = await this.invoke<any>('Login', { username, password });
    return toUser(response.user);
  }

  async createUser(input: CreateUserData): Promise<UserRecord> {
    const response = await this.invoke<any>('CreateUser', {
      username: input.username,
      password: input.password,
      display_name: input.displayName,
      language: input.language ?? 'en',
    });
    return toUser(response.user);
  }

  async updateUser(id: string, patch: UpdateUserData): Promise<UserRecord> {
    const response = await this.invoke<any>(
      'UpdateUser',
      {
        user_id: id,
        ...(patch.displayName !== undefined ? { display_name: patch.displayName } : {}),
        ...(patch.language !== undefined ? { language: patch.language } : {}),
        ...(patch.avatarUrl !== undefined ? { avatar_url: patch.avatarUrl ?? '' } : {}),
        ...(patch.color !== undefined ? { color: patch.color ?? '' } : {}),
      },
      id,
    );
    return toUser(response.user);
  }

  async deleteUser(id: string): Promise<void> {
    await this.invoke('DeleteUser', { user_id: id });
  }

  private notificationRequest(
    input: CreateNotificationData | CreateReminderNotificationData,
  ): Record<string, unknown> {
    if ('dedupeKey' in input) {
      return {
        user_id: input.userId,
        type: 'activity_reminder',
        trip_id: input.tripId,
        trip_name: input.tripName,
        item_id: input.itemId,
        item_title: input.itemTitle,
        start_at: input.startAt,
        lead_minutes: input.leadMinutes,
        dedupe_key: input.dedupeKey,
      };
    }
    return {
      user_id: input.userId,
      type: 'trip_invite',
      trip_id: input.tripId,
      trip_name: input.tripName,
      invitation_id: input.invitationId,
      inviter_user_id: input.inviterUserId,
      role: input.role,
    };
  }

  async createNotification(
    input: CreateNotificationData,
  ): Promise<CreateNotificationResult> {
    return this.createAnyNotification(input);
  }

  async createReminderNotification(
    input: CreateReminderNotificationData,
  ): Promise<CreateNotificationResult> {
    return this.createAnyNotification(input);
  }

  private async createAnyNotification(
    input: CreateNotificationData | CreateReminderNotificationData,
  ): Promise<CreateNotificationResult> {
    const response = await this.invoke<any>(
      'CreateNotification',
      this.notificationRequest(input),
    );
    return {
      notification: toNotification(response.notification),
      created: Boolean(response.created),
    };
  }

  async listNotifications(
    userId: string,
    status?: NotificationStatus | null,
  ): Promise<NotificationRecord[]> {
    const response = await this.invoke<any>(
      'ListNotifications',
      { user_id: userId, status: status ?? '' },
      userId,
    );
    return (response.items ?? []).map(toNotification);
  }

  async getNotification(userId: string, id: string): Promise<NotificationRecord> {
    const response = await this.invoke<any>(
      'GetNotification',
      { user_id: userId, notification_id: id },
      userId,
    );
    return toNotification(response.notification);
  }

  async updateNotification(
    userId: string,
    id: string,
    status: 'read' | 'accepted' | 'declined',
  ): Promise<NotificationRecord> {
    const response = await this.invoke<any>(
      'UpdateNotification',
      { user_id: userId, notification_id: id, status },
      userId,
    );
    return toNotification(response.notification);
  }

  async listFavoriteIds(userId: string): Promise<Set<string>> {
    const response = await this.invoke<any>('ListFavoriteIds', { user_id: userId }, userId);
    return new Set<string>(response.ids ?? []);
  }

  async setFavorite(
    userId: string,
    locationId: string,
    favorite: boolean,
  ): Promise<boolean> {
    const response = await this.invoke<any>(
      'SetFavorite',
      { user_id: userId, location_id: locationId, favorite },
      userId,
    );
    return Boolean(response.favorite);
  }
}

function errorCodeFromError(error: unknown): string | undefined {
  const value = error as { code?: string; extensions?: { code?: unknown } } | null;
  const extension = value?.extensions?.code;
  if (typeof extension === 'string') return extension;
  return value?.code;
}
