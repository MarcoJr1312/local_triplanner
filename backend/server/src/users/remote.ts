// Remote adapter: calls the users service. This is the only path after the
// M10.13 decommission; there is no local users table.

import type {
  CreateNotificationData,
  CreateNotificationResult,
  CreateUserData,
  NotificationRecord,
  NotificationStatus,
  UpdateUserData,
  UserRecord,
  UsersStore,
} from './types.ts';
import { usersError } from './errors.ts';

export interface RemoteUsersOptions {
  baseUrl: string;
  internalToken: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

interface RemoteUser {
  id: string;
  username: string;
  email: string | null;
  display_name: string;
  color: string | null;
  avatar_url: string | null;
  language: string;
  created_at: string;
  deleted_at: string | null;
}

interface RemoteNotification {
  id: string;
  user_id?: string;
  type: string;
  trip_id: string;
  trip_name: string;
  invitation_id: string;
  inviter_user_id: string | null;
  role: string;
  status: string;
  created_at: string;
  read_at: string | null;
}

function toUser(raw: RemoteUser): UserRecord {
  return {
    id: raw.id,
    username: raw.username,
    email: raw.email,
    display_name: raw.display_name,
    color: raw.color,
    avatar_url: raw.avatar_url,
    language: raw.language,
    created_at: raw.created_at,
    deleted_at: raw.deleted_at,
  };
}

function toNotification(raw: RemoteNotification): NotificationRecord {
  return {
    id: raw.id,
    user_id: raw.user_id ?? '',
    type: raw.type,
    trip_id: raw.trip_id,
    trip_name: raw.trip_name,
    invitation_id: raw.invitation_id,
    inviter_user_id: raw.inviter_user_id,
    role: raw.role,
    status: raw.status as NotificationStatus,
    created_at: raw.created_at,
    read_at: raw.read_at,
  };
}

export class RemoteUsersStore implements UsersStore {
  private readonly root: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: RemoteUsersOptions) {
    this.root = options.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getUser(id: string): Promise<UserRecord | null> {
    return this.getOrNull(`/internal/v1/users/${encodeURIComponent(id)}`, null);
  }

  async getByUsername(username: string): Promise<UserRecord | null> {
    return this.getOrNull(
      `/internal/v1/users/by-username/${encodeURIComponent(username)}`,
      null,
    );
  }

  async getByEmail(email: string): Promise<UserRecord | null> {
    return this.getOrNull(`/internal/v1/users/by-email/${encodeURIComponent(email)}`, null);
  }

  async listUsers(query = ''): Promise<UserRecord[]> {
    const params = new URLSearchParams();
    if (query.trim()) params.set('query', query.trim());
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    const response = await this.request<{ items: RemoteUser[] }>(
      'GET',
      `/internal/v1/users${suffix}`,
      null,
    );
    return response.items.map(toUser);
  }

  async batchUsers(ids: readonly string[]): Promise<UserRecord[]> {
    if (ids.length === 0) return [];
    const response = await this.request<{ items: RemoteUser[] }>(
      'POST',
      '/internal/v1/users/batch',
      null,
      { ids },
    );
    return response.items.map(toUser);
  }

  async login(username: string, password: string): Promise<UserRecord> {
    return toUser(
      await this.request<RemoteUser>('POST', '/internal/v1/auth/login', null, {
        username,
        password,
      }),
    );
  }

  async createUser(input: CreateUserData): Promise<UserRecord> {
    return toUser(
      await this.request<RemoteUser>('POST', '/internal/v1/users', null, {
        username: input.username,
        password: input.password,
        display_name: input.displayName,
        language: input.language ?? 'en',
      }),
    );
  }

  async updateUser(id: string, patch: UpdateUserData): Promise<UserRecord> {
    const body: Record<string, unknown> = {};
    if (patch.displayName !== undefined) body.display_name = patch.displayName;
    if (patch.language !== undefined) body.language = patch.language;
    if (patch.avatarUrl !== undefined) body.avatar_url = patch.avatarUrl;
    if (patch.color !== undefined) body.color = patch.color;

    return toUser(
      await this.request<RemoteUser>(
        'PATCH',
        `/internal/v1/users/${encodeURIComponent(id)}`,
        id,
        body,
      ),
    );
  }

  async deleteUser(id: string): Promise<void> {
    await this.request(
      'DELETE',
      `/internal/v1/users/${encodeURIComponent(id)}`,
      null,
    );
  }

  async createNotification(
    input: CreateNotificationData,
  ): Promise<CreateNotificationResult> {
    const response = await this.send('POST', '/internal/v1/notifications', null, {
      user_id: input.userId,
      type: input.type,
      trip_id: input.tripId,
      trip_name: input.tripName,
      invitation_id: input.invitationId,
      inviter_user_id: input.inviterUserId,
      role: input.role,
    });
    return {
      notification: toNotification(response.data as RemoteNotification),
      created: response.status === 201,
    };
  }

  async listNotifications(
    userId: string,
    status?: NotificationStatus | null,
  ): Promise<NotificationRecord[]> {
    const suffix = status ? `?status=${encodeURIComponent(status)}` : '';
    const response = await this.request<{ items: RemoteNotification[] }>(
      'GET',
      `/internal/v1/users/${encodeURIComponent(userId)}/notifications${suffix}`,
      userId,
    );
    return response.items.map(toNotification);
  }

  async getNotification(userId: string, id: string): Promise<NotificationRecord> {
    return toNotification(
      await this.request<RemoteNotification>(
        'GET',
        `/internal/v1/notifications/${encodeURIComponent(id)}`,
        userId,
      ),
    );
  }

  async updateNotification(
    userId: string,
    id: string,
    status: 'read' | 'accepted' | 'declined',
  ): Promise<NotificationRecord> {
    return toNotification(
      await this.request<RemoteNotification>(
        'PATCH',
        `/internal/v1/notifications/${encodeURIComponent(id)}`,
        userId,
        { status },
      ),
    );
  }

  // --------------------------------------------------------------- helpers

  private async getOrNull(path: string, actorId: string | null): Promise<UserRecord | null> {
    try {
      return toUser(await this.request<RemoteUser>('GET', path, actorId));
    } catch (error) {
      if (error instanceof Error && 'extensions' in error) {
        const code = (error as { extensions?: { code?: string } }).extensions?.code;
        if (code === 'USER_NOT_FOUND') return null;
      }
      throw error;
    }
  }

  async listFavoriteIds(userId: string): Promise<Set<string>> {
    const data = await this.request<{ items: { location_id: string }[] }>(
      'GET',
      `/internal/v1/users/${encodeURIComponent(userId)}/favorites`,
      userId,
    );
    return new Set(data.items.map((item) => item.location_id));
  }

  async setFavorite(
    userId: string,
    locationId: string,
    favorite: boolean,
  ): Promise<boolean> {
    const data = await this.request<{ favorite: boolean }>(
      favorite ? 'PUT' : 'DELETE',
      `/internal/v1/users/${encodeURIComponent(userId)}/favorites/${encodeURIComponent(locationId)}`,
      userId,
    );
    return data.favorite;
  }

  private async request<T>(
    method: string,
    path: string,
    actorId: string | null,
    body?: unknown,
  ): Promise<T> {
    const response = await this.send(method, path, actorId, body);
    return response.data as T;
  }

  private async send(
    method: string,
    path: string,
    actorId: string | null,
    body?: unknown,
  ): Promise<{ status: number; data: unknown }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);

    const headers: Record<string, string> = {
      'x-internal-token': this.options.internalToken,
    };
    if (actorId) headers['x-actor-id'] = actorId;
    if (body !== undefined) headers['content-type'] = 'application/json';

    try {
      let response: Response;
      try {
        response = await this.fetchImpl(`${this.root}${path}`, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (error) {
        const timedOut = error instanceof Error && error.name === 'AbortError';
        throw usersError(
          'USERS_UNAVAILABLE',
          timedOut
            ? 'El servicio de usuarios no respondió a tiempo.'
            : 'El servicio de usuarios no está disponible.',
        );
      }

      if (!response.ok) {
        let code = 'USERS_UNAVAILABLE';
        let message = `HTTP ${response.status}`;
        try {
          const payload = (await response.json()) as { error?: unknown; message?: unknown };
          if (typeof payload.error === 'string') code = payload.error;
          if (typeof payload.message === 'string') message = payload.message;
        } catch {
          // keep the HTTP status
        }
        if (code === 'UNAVAILABLE') code = 'USERS_UNAVAILABLE';
        throw usersError(code, message);
      }

      if (response.status === 204) return { status: response.status, data: undefined };
      return { status: response.status, data: await response.json() };
    } finally {
      clearTimeout(timer);
    }
  }
}
