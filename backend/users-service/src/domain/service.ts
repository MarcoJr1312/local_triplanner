// Users domain service. It owns account creation, password login, profile
// updates and soft deletion. The service never calls the API or trips; the API
// orchestrates local invites and enforces the trip-owner delete guard.

import { randomUUID } from 'node:crypto';
import type { Db } from '../db.ts';
import { isProtectedUserId } from '../db/seed.ts';
import { AppError } from '../errors.ts';
import * as favorites from './favorites-store.ts';
import * as notifications from './notifications-store.ts';
import * as store from './store.ts';
import {
  toPublicFavorite,
  toPublicNotification,
  toPublicUser,
  type FavoritePublic,
  type NotificationJoinedRow,
  type NotificationPublic,
  type UserPublic,
} from './types.ts';
import {
  batchIds,
  favoriteLocationId,
  loginUsername,
  notificationLimit,
  notificationRole,
  notificationStatus,
  notificationStatusFilter,
  optionalAvatarUrl,
  optionalColor,
  optionalLanguage,
  optionalString,
  pathNotificationId,
  pathUuid,
  requiredId,
  requiredInteger,
  requiredPassword,
  requiredString,
  searchLimit,
  searchQuery,
} from './validation.ts';

// A real Argon2id hash so a missing username costs the same as a wrong
// password. The plain value is irrelevant and never matches user input.
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=2,p=1$MTupKnjGDJAio8C95xdbkcRt+pvgGsUoZ8oukwIB96A$BGsTnwinuP4HRoLoCPFLP0WPq3EetHwaJMStUf0sU6Y';

function uniqueViolation(error: unknown): never {
  const code = (error as { code?: string }).code;
  if (code === '23505') {
    const constraint = (error as { constraint?: string }).constraint ?? '';
    if (constraint.includes('email')) {
      throw new AppError('EMAIL_TAKEN', 'El correo ya está registrado.');
    }
    throw new AppError('USERNAME_TAKEN', 'El nombre de usuario ya está en uso.');
  }
  throw error;
}

export interface DeleteResult {
  deleted: true;
}

export class UsersService {
  constructor(private readonly db: Db) {}

  async listUsers(query: unknown, limit: unknown): Promise<UserPublic[]> {
    const rows = await store.search(this.db, searchQuery(query), searchLimit(limit));
    return rows.map(toPublicUser);
  }

  /** Profile lookup includes soft-deleted accounts for enrichment. */
  async getUser(id: string): Promise<UserPublic> {
    return toPublicUser(await this.requireAny(id));
  }

  async getByUsername(username: string): Promise<UserPublic> {
    const value = String(username ?? '').trim().toLowerCase();
    if (value === '' || value.length > 64) {
      throw new AppError('USER_NOT_FOUND', 'Usuario no encontrado.');
    }
    const row = await store.findByUsername(this.db, value);
    if (!row) throw new AppError('USER_NOT_FOUND', 'Usuario no encontrado.');
    return toPublicUser(row);
  }

  /** Used by the agent to resolve legacy demo emails; active accounts only. */
  async getByEmail(email: string): Promise<UserPublic> {
    const value = String(email ?? '').trim().toLowerCase();
    if (value === '' || value.length > 254) {
      throw new AppError('USER_NOT_FOUND', 'Usuario no encontrado.');
    }
    const row = await store.findByEmail(this.db, value);
    if (!row) throw new AppError('USER_NOT_FOUND', 'Usuario no encontrado.');
    return toPublicUser(row);
  }

  async batchUsers(ids: unknown): Promise<UserPublic[]> {
    const rows = await store.batch(this.db, batchIds(ids));
    return rows.map(toPublicUser);
  }

  async createUser(body: Record<string, unknown>): Promise<UserPublic> {
    const username = String(body.username ?? '')
      .trim()
      .toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(username)) {
      throw new AppError(
        'INVALID_ARGUMENT',
        'username debe tener 3-32 caracteres: minúsculas, números, guion o guion bajo.',
      );
    }
    const password = requiredPassword(body.password);
    const displayName = requiredString(body.display_name, 'display_name', 1, 80);
    const language = optionalLanguage(body.language) ?? 'en';

    const passwordHash = await Bun.password.hash(password, { algorithm: 'argon2id' });

    const row = await store
      .insert(this.db, {
        id: randomUUID(),
        username,
        passwordHash,
        displayName,
        language,
      })
      .catch(uniqueViolation);

    return toPublicUser(row);
  }

  async login(body: Record<string, unknown>): Promise<UserPublic> {
    const username = loginUsername(body.username);
    const password = body.password;
    if (typeof password !== 'string' || password.length === 0 || password.length > 128) {
      throw new AppError('INVALID_CREDENTIALS', 'Usuario o contraseña incorrectos.');
    }

    const row = await store.findByUsername(this.db, username);
    // Verify against a dummy hash on a miss so timing does not reveal accounts.
    const hash = row?.password_hash ?? DUMMY_HASH;
    let valid = false;
    try {
      valid = await Bun.password.verify(password, hash);
    } catch {
      valid = false;
    }
    if (!row || !valid) {
      throw new AppError('INVALID_CREDENTIALS', 'Usuario o contraseña incorrectos.');
    }

    return toPublicUser(row);
  }

  async updateProfile(
    actorId: string,
    id: string,
    body: Record<string, unknown>,
  ): Promise<UserPublic> {
    const userId = pathUuid(id);
    if (actorId !== userId) {
      throw new AppError('FORBIDDEN', 'No autorizado para modificar este perfil.');
    }

    const displayName = optionalString(body.display_name, 'display_name', 1, 80);
    const language = optionalLanguage(body.language);
    const avatarUrl = optionalAvatarUrl(body.avatar_url);
    const color = optionalColor(body.color);

    if (
      displayName === undefined &&
      language === undefined &&
      avatarUrl === undefined &&
      color === undefined
    ) {
      throw new AppError('INVALID_ARGUMENT', 'No hay cambios.');
    }

    const row = await store.update(this.db, userId, {
      ...(displayName !== undefined ? { displayName } : {}),
      ...(language !== undefined ? { language } : {}),
      ...(avatarUrl !== undefined ? { avatarUrl } : {}),
      ...(color !== undefined ? { color } : {}),
    });
    if (!row) throw new AppError('USER_NOT_FOUND', 'Usuario no encontrado.');
    return toPublicUser(row);
  }

  async deleteUser(id: string): Promise<DeleteResult> {
    const userId = pathUuid(id);
    if (isProtectedUserId(userId)) {
      throw new AppError('PROTECTED_USER', 'Las cuentas demo no se pueden eliminar.');
    }
    const exists = await store.softDelete(this.db, userId);
    if (!exists) throw new AppError('USER_NOT_FOUND', 'Usuario no encontrado.');
    return { deleted: true };
  }

  // --------------------------------------------------------- favorites

  async listFavorites(userId: string): Promise<FavoritePublic[]> {
    const id = await this.requireActiveId(userId);
    const rows = await favorites.listForUser(this.db, id);
    return rows.map(toPublicFavorite);
  }

  async setFavorite(
    userId: string,
    locationId: string,
    favorite: boolean,
  ): Promise<{ location_id: string; favorite: boolean }> {
    const id = await this.requireActiveId(userId);
    const location = favoriteLocationId(locationId);
    if (favorite) await favorites.add(this.db, id, location);
    else await favorites.remove(this.db, id, location);
    return { location_id: location, favorite };
  }

  // ------------------------------------------------------- notifications

  async createNotification(
    body: Record<string, unknown>,
  ): Promise<{ notification: NotificationPublic; created: boolean }> {
    if (body.type === 'activity_reminder') {
      return this.createReminderNotification(body);
    }
    const userId = pathUuid(String(body.user_id ?? ''));
    const target = await store.findActiveById(this.db, userId);
    if (!target) throw new AppError('USER_NOT_FOUND', 'Usuario no encontrado.');

    const inviterUserId = pathUuid(String(body.inviter_user_id ?? ''));
    if (inviterUserId === userId) {
      throw new AppError('INVALID_ARGUMENT', 'No puedes invitarte a ti mismo.');
    }
    const inviter = await store.findAnyById(this.db, inviterUserId);
    if (!inviter) throw new AppError('USER_NOT_FOUND', 'Usuario no encontrado.');

    if (body.type !== undefined && body.type !== 'trip_invite') {
      throw new AppError('INVALID_ARGUMENT', "type debe ser 'trip_invite'.");
    }

    const result = await notifications.insert(this.db, {
      id: randomUUID(),
      userId,
      type: 'trip_invite',
      tripId: requiredId(body.trip_id, 'trip_id'),
      tripName: requiredId(body.trip_name, 'trip_name', 200),
      invitationId: requiredId(body.invitation_id, 'invitation_id'),
      inviterUserId,
      role: notificationRole(body.role),
    });

    const row = await notifications.findById(this.db, result.id);
    if (!row) throw new Error('notification disappeared after insert');
    return { notification: toPublicNotification(row), created: result.created };
  }

  private async createReminderNotification(
    body: Record<string, unknown>,
  ): Promise<{ notification: NotificationPublic; created: boolean }> {
    const userId = pathUuid(String(body.user_id ?? ''));
    const target = await store.findActiveById(this.db, userId);
    if (!target) throw new AppError('USER_NOT_FOUND', 'User not found.');

    const leadMinutes = requiredInteger(body.lead_minutes, 'lead_minutes', 1, 1440);
    if (![15, 30, 60, 120].includes(leadMinutes)) {
      throw new AppError(
        'INVALID_ARGUMENT',
        'lead_minutes must be 15, 30, 60 or 120.',
      );
    }
    const startAt = requiredString(body.start_at, 'start_at', 1, 40);
    if (!Number.isFinite(Date.parse(startAt))) {
      throw new AppError('INVALID_ARGUMENT', 'start_at must be an ISO timestamp.');
    }

    const result = await notifications.insertReminder(this.db, {
      id: randomUUID(),
      userId,
      tripId: requiredId(body.trip_id, 'trip_id'),
      tripName: requiredString(body.trip_name, 'trip_name', 1, 200),
      itemId: requiredId(body.item_id, 'item_id'),
      itemTitle: requiredString(body.item_title, 'item_title', 1, 300),
      startAt,
      leadMinutes,
      dedupeKey: requiredString(body.dedupe_key, 'dedupe_key', 1, 256),
    });

    const row = await notifications.findById(this.db, result.id);
    if (!row) throw new Error('notification disappeared after insert');
    return { notification: toPublicNotification(row), created: result.created };
  }

  async listNotifications(
    actorId: string,
    userId: string,
    status: unknown,
    limit: unknown,
  ): Promise<NotificationPublic[]> {
    const targetId = pathUuid(userId);
    if (actorId !== targetId) {
      throw new AppError('FORBIDDEN', 'No autorizado para leer estas notificaciones.');
    }
    const rows = await notifications.listForUser(
      this.db,
      targetId,
      notificationStatusFilter(status),
      notificationLimit(limit),
    );
    return rows.map(toPublicNotification);
  }

  async getNotification(actorId: string, id: string): Promise<NotificationPublic> {
    return toPublicNotification(await this.requireNotification(actorId, id));
  }

  async updateNotification(
    actorId: string,
    id: string,
    body: Record<string, unknown>,
  ): Promise<NotificationPublic> {
    const current = await this.requireNotification(actorId, id);
    const next = notificationStatus(body.status);

    // Terminal notifications never flip; marking one read is a harmless no-op.
    if (current.status === 'accepted' || current.status === 'declined') {
      if (next !== 'read' && next !== current.status) {
        throw new AppError('INVALID_ARGUMENT', 'La notificación ya fue resuelta.');
      }
      return toPublicNotification(current);
    }
    if (next === 'read' && current.status === 'read') {
      return toPublicNotification(current);
    }

    await notifications.setStatus(this.db, current.id, next === 'read' ? 'read' : next);
    const updated = await notifications.findById(this.db, current.id);
    if (!updated) throw new Error('notification disappeared after update');
    return toPublicNotification(updated);
  }

  private async requireNotification(
    actorId: string,
    id: string,
  ): Promise<NotificationJoinedRow> {
    const row = await notifications.findById(this.db, pathNotificationId(id));
    if (!row || row.user_id !== actorId) {
      throw new AppError('NOTIFICATION_NOT_FOUND', 'Notificación no encontrada.');
    }
    return row;
  }

  private async requireAny(id: string) {
    const row = await store.findAnyById(this.db, pathUuid(id));
    if (!row) throw new AppError('USER_NOT_FOUND', 'Usuario no encontrado.');
    return row;
  }

  private async requireActiveId(id: string): Promise<string> {
    const userId = pathUuid(id);
    const row = await store.findActiveById(this.db, userId);
    if (!row) throw new AppError('USER_NOT_FOUND', 'Usuario no encontrado.');
    return userId;
  }
}
