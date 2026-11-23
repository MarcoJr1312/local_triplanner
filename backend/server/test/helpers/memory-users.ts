// In-memory UsersStore for API orchestration tests. The real store is the users
// service; this double keeps resolver tests independent of both databases.

import { randomUUID } from 'node:crypto';
import { usersError } from '../../src/users/errors.ts';
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
} from '../../src/users/types.ts';

const PROTECTED = new Set([
  'demo-user',
  'demo-friend',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
]);

interface StoredUser extends UserRecord {
  password: string;
}

export class MemoryUsersStore implements UsersStore {
  private readonly users = new Map<string, StoredUser>();
  private readonly notifications = new Map<string, NotificationRecord>();
  private readonly favorites = new Map<string, Set<string>>();

  private publicUser(user: StoredUser): UserRecord {
    const { password: _password, ...publicUser } = user;
    return publicUser;
  }

  private findStoredByUsername(username: string): StoredUser | null {
    const value = username.trim().toLowerCase();
    return (
      [...this.users.values()].find(
        (user) => !user.deleted_at && user.username.toLowerCase() === value,
      ) ?? null
    );
  }

  async getUser(id: string): Promise<UserRecord | null> {
    const user = this.users.get(id);
    return user ? this.publicUser(user) : null;
  }

  async getByUsername(username: string): Promise<UserRecord | null> {
    const user = this.findStoredByUsername(username);
    return user ? this.publicUser(user) : null;
  }

  async getByEmail(email: string): Promise<UserRecord | null> {
    const value = email.trim().toLowerCase();
    const user = [...this.users.values()].find(
      (row) => !row.deleted_at && row.email?.toLowerCase() === value,
    );
    return user ? this.publicUser(user) : null;
  }

  async listUsers(query = ''): Promise<UserRecord[]> {
    const value = query.trim().toLowerCase();
    return [...this.users.values()]
      .filter((user) => !user.deleted_at)
      .filter(
        (user) =>
          !value ||
          user.username.toLowerCase().includes(value) ||
          user.display_name.toLowerCase().includes(value),
      )
      .sort((a, b) => a.username.localeCompare(b.username))
      .map(({ password: _password, ...user }) => user);
  }

  async batchUsers(ids: readonly string[]): Promise<UserRecord[]> {
    return [...new Set(ids)]
      .map((id) => this.users.get(id))
      .filter((user): user is StoredUser => Boolean(user))
      .map(({ password: _password, ...user }) => user);
  }

  async login(username: string, password: string): Promise<UserRecord> {
    const stored = this.findStoredByUsername(username);
    if (!stored || stored.password !== password) {
      throw usersError('INVALID_CREDENTIALS', 'Usuario o contraseña incorrectos.');
    }
    return this.publicUser(stored);
  }

  async createUser(input: CreateUserData): Promise<UserRecord> {
    const username = input.username.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(username)) {
      throw usersError('INVALID_ARGUMENT', 'username inválido.');
    }
    if (input.password.length < 6 || input.password.length > 128) {
      throw usersError('INVALID_ARGUMENT', 'password inválida.');
    }
    if (await this.getByUsername(username)) {
      throw usersError('USERNAME_TAKEN', 'El nombre de usuario ya está en uso.');
    }
    const user: StoredUser = {
      id: randomUUID(),
      username,
      email: null,
      display_name: input.displayName.trim(),
      color: null,
      avatar_url: null,
      language: input.language ?? 'en',
      created_at: new Date().toISOString(),
      deleted_at: null,
      password: input.password,
    };
    this.users.set(user.id, user);
    const { password: _password, ...publicUser } = user;
    return publicUser;
  }

  async updateUser(id: string, patch: UpdateUserData): Promise<UserRecord> {
    const user = this.users.get(id);
    if (!user || user.deleted_at) throw usersError('USER_NOT_FOUND', 'Usuario no encontrado.');
    if (patch.displayName !== undefined) user.display_name = patch.displayName.trim();
    if (patch.language !== undefined) user.language = patch.language;
    if (patch.avatarUrl !== undefined) user.avatar_url = patch.avatarUrl;
    if (patch.color !== undefined) user.color = patch.color;
    const { password: _password, ...publicUser } = user;
    return publicUser;
  }

  async deleteUser(id: string): Promise<void> {
    if (PROTECTED.has(id)) {
      throw usersError('PROTECTED_USER', 'Las cuentas demo no se pueden eliminar.');
    }
    const user = this.users.get(id);
    if (!user) throw usersError('USER_NOT_FOUND', 'Usuario no encontrado.');
    user.deleted_at = new Date().toISOString();
  }

  async createNotification(
    input: CreateNotificationData,
  ): Promise<CreateNotificationResult> {
    const target = this.users.get(input.userId);
    if (!target || target.deleted_at) {
      throw usersError('USER_NOT_FOUND', 'Usuario no encontrado.');
    }
    const inviter = this.users.get(input.inviterUserId);
    if (!inviter) throw usersError('USER_NOT_FOUND', 'Usuario no encontrado.');
    if (input.userId === input.inviterUserId) {
      throw usersError('INVALID_ARGUMENT', 'No puedes invitarte a ti mismo.');
    }

    const existing = [...this.notifications.values()].find(
      (row) => row.user_id === input.userId && row.invitation_id === input.invitationId,
    );
    if (existing) return { notification: existing, created: false };

    const notification: NotificationRecord = {
      id: randomUUID(),
      user_id: input.userId,
      type: input.type,
      trip_id: input.tripId,
      trip_name: input.tripName,
      invitation_id: input.invitationId,
      inviter_user_id: input.inviterUserId,
      role: input.role,
      item_id: null,
      item_title: null,
      start_at: null,
      lead_minutes: null,
      dedupe_key: null,
      status: 'unread',
      created_at: new Date().toISOString(),
      read_at: null,
    };
    this.notifications.set(notification.id, notification);
    return { notification, created: true };
  }

  async createReminderNotification(
    input: CreateReminderNotificationData,
  ): Promise<CreateNotificationResult> {
    const target = this.users.get(input.userId);
    if (!target || target.deleted_at) {
      throw usersError('USER_NOT_FOUND', 'Usuario no encontrado.');
    }
    const existing = [...this.notifications.values()].find(
      (row) => row.user_id === input.userId && row.dedupe_key === input.dedupeKey,
    );
    if (existing) return { notification: existing, created: false };

    const notification: NotificationRecord = {
      id: randomUUID(),
      user_id: input.userId,
      type: 'activity_reminder',
      trip_id: input.tripId,
      trip_name: input.tripName,
      invitation_id: null,
      inviter_user_id: null,
      role: null,
      item_id: input.itemId,
      item_title: input.itemTitle,
      start_at: input.startAt,
      lead_minutes: input.leadMinutes,
      dedupe_key: input.dedupeKey,
      status: 'unread',
      created_at: new Date().toISOString(),
      read_at: null,
    };
    this.notifications.set(notification.id, notification);
    return { notification, created: true };
  }

  async listNotifications(
    userId: string,
    status?: NotificationStatus | null,
  ): Promise<NotificationRecord[]> {
    return [...this.notifications.values()]
      .filter((row) => row.user_id === userId && (!status || row.status === status))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async getNotification(userId: string, id: string): Promise<NotificationRecord> {
    const row = this.notifications.get(id);
    if (!row || row.user_id !== userId) {
      throw usersError('NOTIFICATION_NOT_FOUND', 'Notificación no encontrada.');
    }
    return row;
  }

  async updateNotification(
    userId: string,
    id: string,
    status: 'read' | 'accepted' | 'declined',
  ): Promise<NotificationRecord> {
    const row = await this.getNotification(userId, id);
    if (row.status === 'accepted' || row.status === 'declined') {
      if (status !== 'read' && status !== row.status) {
        throw usersError('INVALID_ARGUMENT', 'La notificación ya fue resuelta.');
      }
      return row;
    }
    if (status === 'read' && row.status === 'read') return row;
    row.status = status;
    row.read_at = row.read_at ?? new Date().toISOString();
    return row;
  }

  async listFavoriteIds(userId: string): Promise<Set<string>> {
    return new Set(this.favorites.get(userId) ?? []);
  }

  async setFavorite(
    userId: string,
    locationId: string,
    favorite: boolean,
  ): Promise<boolean> {
    const current = this.favorites.get(userId) ?? new Set<string>();
    if (favorite) current.add(locationId);
    else current.delete(locationId);
    this.favorites.set(userId, current);
    return favorite;
  }
}
