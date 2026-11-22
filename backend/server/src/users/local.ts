// Local adapter over the platform users table plus the temporary notifications
// table. Used by tests and by USERS_MODE=local during the cutover. The remote
// adapter is the production path after the M10.10 data migration.

import { randomUUID } from 'node:crypto';
import type { AsyncDb } from '../pg/db.ts';
import { DEMO_PASSWORD, DEMO_USERS } from '../pg/auth.ts';
import { usersError } from './errors.ts';
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

const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=2,p=1$MTupKnjGDJAio8C95xdbkcRt+pvgGsUoZ8oukwIB96A$BGsTnwinuP4HRoLoCPFLP0WPq3EetHwaJMStUf0sU6Y';

const PROTECTED_IDS = new Set([
  'demo-user',
  'demo-friend',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
]);

const USER_COLUMNS = `id, username, email, display_name, color, avatar_url, language,
                      created_at, deleted_at`;

interface LocalUserRow {
  id: string;
  username: string | null;
  email: string | null;
  display_name: string;
  color: string | null;
  avatar_url: string | null;
  language: string | null;
  created_at: string;
  deleted_at: string | null;
}

interface LocalNotificationRow {
  id: string;
  user_id: string;
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

function toRecord(row: LocalUserRow): UserRecord {
  return {
    id: row.id,
    username: row.username ?? row.id,
    email: row.email,
    display_name: row.display_name,
    color: row.color,
    avatar_url: row.avatar_url,
    language: row.language ?? 'es',
    created_at: row.created_at,
    deleted_at: row.deleted_at,
  };
}

function toNotification(row: LocalNotificationRow): NotificationRecord {
  return {
    id: row.id,
    user_id: row.user_id,
    type: row.type,
    trip_id: row.trip_id,
    trip_name: row.trip_name,
    invitation_id: row.invitation_id,
    inviter_user_id: row.inviter_user_id,
    role: row.role,
    status: row.status as NotificationStatus,
    created_at: row.created_at,
    read_at: row.read_at,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string }).code === '23505';
}

interface DemoRow {
  id: string;
  username: string | null;
  password_hash: string | null;
}

/**
 * Idempotent demo seed for USERS_MODE=local. Fills username/password_hash for
 * databases created before local credentials existed. The remote service seeds
 * its own copies with the fixed UUIDs.
 */
export async function ensureLocalDemoUsers(db: AsyncDb): Promise<void> {
  for (const user of DEMO_USERS) {
    const existing = await db
      .prepare('SELECT id, username, password_hash FROM users WHERE id = ?')
      .get<DemoRow>(user.id);
    if (existing?.username && existing.password_hash) continue;

    const hash = await Bun.password.hash(DEMO_PASSWORD, { algorithm: 'argon2id' });
    if (existing) {
      await db
        .prepare(
          `UPDATE users
              SET username = COALESCE(username, ?),
                  password_hash = COALESCE(password_hash, ?)
            WHERE id = ?`,
        )
        .run(user.username, hash, user.id);
      continue;
    }

    await db
      .prepare(
        `INSERT INTO users (id, username, email, password_hash, display_name, color, language)
         VALUES (?, ?, ?, ?, ?, ?, 'es')
         ON CONFLICT DO NOTHING`,
      )
      .run(user.id, user.username, user.email, hash, user.name, user.color);

    const inserted = await db
      .prepare('SELECT id FROM users WHERE id = ?')
      .get(user.id);
    if (!inserted) {
      throw new Error(
        `[users] legacy demo identity "${user.username}" blocks ${user.id}; ` +
          'run backend/users-service/scripts/migrate-users.ts before starting USERS_MODE=local',
      );
    }
  }
}

function validateUsername(value: string): string {
  const username = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(username)) {
    throw usersError(
      'INVALID_ARGUMENT',
      'username debe tener 3-32 caracteres: minúsculas, números, guion o guion bajo.',
    );
  }
  return username;
}

function validatePassword(value: string): string {
  if (value.length < 6 || value.length > 128) {
    throw usersError('INVALID_ARGUMENT', 'La contraseña debe tener entre 6 y 128 caracteres.');
  }
  return value;
}

export class LocalUsersStore implements UsersStore {
  constructor(private readonly db: AsyncDb) {}

  async getUser(id: string): Promise<UserRecord | null> {
    const row = await this.db
      .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`)
      .get<LocalUserRow>(id);
    return row ? toRecord(row) : null;
  }

  async getByUsername(username: string): Promise<UserRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT ${USER_COLUMNS} FROM users
          WHERE lower(username) = lower(?) AND deleted_at IS NULL`,
      )
      .get<LocalUserRow>(username.trim());
    return row ? toRecord(row) : null;
  }

  async getByEmail(email: string): Promise<UserRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT ${USER_COLUMNS} FROM users
          WHERE lower(email) = lower(?) AND deleted_at IS NULL`,
      )
      .get<LocalUserRow>(email.trim());
    return row ? toRecord(row) : null;
  }

  async listUsers(query = ''): Promise<UserRecord[]> {
    const value = query.trim();
    const rows = value
      ? await this.db
          .prepare(
            `SELECT ${USER_COLUMNS} FROM users
              WHERE deleted_at IS NULL AND username IS NOT NULL
                AND (position(lower(?) in lower(username)) > 0
                     OR position(lower(?) in lower(display_name)) > 0)
              ORDER BY username
              LIMIT 50`,
          )
          .all<LocalUserRow>(value, value)
      : await this.db
          .prepare(
            `SELECT ${USER_COLUMNS} FROM users
              WHERE deleted_at IS NULL AND username IS NOT NULL
              ORDER BY username
              LIMIT 50`,
          )
          .all<LocalUserRow>();
    return rows.map(toRecord);
  }

  async batchUsers(ids: readonly string[]): Promise<UserRecord[]> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return [];
    const placeholders = unique.map(() => '?').join(',');
    const rows = await this.db
      .prepare(
        `SELECT ${USER_COLUMNS} FROM users WHERE id IN (${placeholders}) ORDER BY username`,
      )
      .all<LocalUserRow>(...unique);
    return rows.map(toRecord);
  }

  async login(username: string, password: string): Promise<UserRecord> {
    if (!username.trim() || !password) {
      throw usersError('INVALID_CREDENTIALS', 'Usuario o contraseña incorrectos.');
    }
    const row = await this.db
      .prepare(
        `SELECT ${USER_COLUMNS}, password_hash FROM users
          WHERE lower(username) = lower(?) AND deleted_at IS NULL`,
      )
      .get<LocalUserRow & { password_hash: string | null }>(username.trim());

    const hash = row?.password_hash ?? DUMMY_HASH;
    let valid = false;
    try {
      valid = await Bun.password.verify(password, hash);
    } catch {
      valid = false;
    }
    if (!row || !valid) {
      throw usersError('INVALID_CREDENTIALS', 'Usuario o contraseña incorrectos.');
    }
    return toRecord(row);
  }

  async createUser(input: CreateUserData): Promise<UserRecord> {
    const username = validateUsername(input.username);
    const password = validatePassword(input.password);
    const displayName = input.displayName.trim();
    if (displayName.length < 1 || displayName.length > 80) {
      throw usersError('INVALID_ARGUMENT', 'El nombre debe tener entre 1 y 80 caracteres.');
    }
    const language = input.language ?? 'es';
    if (language !== 'es' && language !== 'en') {
      throw usersError('INVALID_ARGUMENT', "language debe ser 'es' o 'en'.");
    }

    const id = randomUUID();
    const passwordHash = await Bun.password.hash(password, { algorithm: 'argon2id' });

    try {
      await this.db
        .prepare(
          `INSERT INTO users (id, username, email, password_hash, display_name, language)
           VALUES (?, ?, NULL, ?, ?, ?)`,
        )
        .run(id, username, passwordHash, displayName, language);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw usersError('USERNAME_TAKEN', 'El nombre de usuario ya está en uso.');
      }
      throw error;
    }

    const created = await this.getUser(id);
    if (!created) throw usersError('USER_NOT_FOUND', 'Usuario no encontrado.');
    return created;
  }

  async updateUser(id: string, patch: UpdateUserData): Promise<UserRecord> {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (patch.displayName !== undefined) {
      const name = patch.displayName.trim();
      if (name.length < 1 || name.length > 80) {
        throw usersError('INVALID_ARGUMENT', 'El nombre debe tener entre 1 y 80 caracteres.');
      }
      sets.push('display_name = ?');
      params.push(name);
    }
    if (patch.language !== undefined) {
      if (patch.language !== 'es' && patch.language !== 'en') {
        throw usersError('INVALID_ARGUMENT', "language debe ser 'es' o 'en'.");
      }
      sets.push('language = ?');
      params.push(patch.language);
    }
    if (patch.avatarUrl !== undefined) {
      sets.push('avatar_url = ?');
      params.push(patch.avatarUrl);
    }
    if (patch.color !== undefined) {
      sets.push('color = ?');
      params.push(patch.color);
    }

    if (sets.length === 0) {
      const current = await this.getUser(id);
      if (!current || current.deleted_at) {
        throw usersError('USER_NOT_FOUND', 'Usuario no encontrado.');
      }
      return current;
    }

    const row = await this.db
      .prepare(
        `UPDATE users SET ${sets.join(', ')}
          WHERE id = ? AND deleted_at IS NULL
          RETURNING ${USER_COLUMNS}`,
      )
      .get<LocalUserRow>(...params, id);
    if (!row) throw usersError('USER_NOT_FOUND', 'Usuario no encontrado.');
    return toRecord(row);
  }

  async deleteUser(id: string): Promise<void> {
    if (PROTECTED_IDS.has(id)) {
      throw usersError('PROTECTED_USER', 'Las cuentas demo no se pueden eliminar.');
    }
    const result = await this.db
      .prepare('UPDATE users SET deleted_at = now() WHERE id = ? AND deleted_at IS NULL')
      .run(id);
    if (result.changes > 0) return;

    const existing = await this.db
      .prepare('SELECT 1 AS ok FROM users WHERE id = ?')
      .get(id);
    if (!existing) throw usersError('USER_NOT_FOUND', 'Usuario no encontrado.');
  }

  // ------------------------------------------------------- notifications

  async createNotification(
    input: CreateNotificationData,
  ): Promise<CreateNotificationResult> {
    const target = await this.db
      .prepare('SELECT id FROM users WHERE id = ? AND deleted_at IS NULL')
      .get(input.userId);
    if (!target) throw usersError('USER_NOT_FOUND', 'Usuario no encontrado.');
    if (input.userId === input.inviterUserId) {
      throw usersError('INVALID_ARGUMENT', 'No puedes invitarte a ti mismo.');
    }
    const inviter = await this.db
      .prepare('SELECT 1 AS ok FROM users WHERE id = ?')
      .get(input.inviterUserId);
    if (!inviter) throw usersError('USER_NOT_FOUND', 'Usuario no encontrado.');

    const id = randomUUID();
    const result = await this.db
      .prepare(
        `INSERT INTO notifications
           (id, user_id, type, trip_id, trip_name, invitation_id, inviter_user_id, role)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, invitation_id) DO NOTHING`,
      )
      .run(
        id,
        input.userId,
        input.type,
        input.tripId,
        input.tripName,
        input.invitationId,
        input.inviterUserId,
        input.role,
      );

    if (result.changes > 0) {
      return { notification: await this.getNotification(input.userId, id), created: true };
    }

    const existing = await this.db
      .prepare(
        'SELECT id FROM notifications WHERE user_id = ? AND invitation_id = ?',
      )
      .get<{ id: string }>(input.userId, input.invitationId);
    if (!existing) throw new Error('notification conflict without an existing row');
    return {
      notification: await this.getNotification(input.userId, existing.id),
      created: false,
    };
  }

  async listNotifications(
    userId: string,
    status?: NotificationStatus | null,
  ): Promise<NotificationRecord[]> {
    const rows = status
      ? await this.db
          .prepare(
            `SELECT * FROM notifications
              WHERE user_id = ? AND status = ?
              ORDER BY created_at DESC
              LIMIT 50`,
          )
          .all<LocalNotificationRow>(userId, status)
      : await this.db
          .prepare(
            `SELECT * FROM notifications
              WHERE user_id = ?
              ORDER BY created_at DESC
              LIMIT 50`,
          )
          .all<LocalNotificationRow>(userId);
    return rows.map(toNotification);
  }

  async getNotification(userId: string, id: string): Promise<NotificationRecord> {
    const row = await this.db
      .prepare('SELECT * FROM notifications WHERE id = ? AND user_id = ?')
      .get<LocalNotificationRow>(id, userId);
    if (!row) throw usersError('NOTIFICATION_NOT_FOUND', 'Notificación no encontrada.');
    return toNotification(row);
  }

  async updateNotification(
    userId: string,
    id: string,
    status: 'read' | 'accepted' | 'declined',
  ): Promise<NotificationRecord> {
    const current = await this.getNotification(userId, id);

    if (current.status === 'accepted' || current.status === 'declined') {
      if (status !== 'read' && status !== current.status) {
        throw usersError('INVALID_ARGUMENT', 'La notificación ya fue resuelta.');
      }
      return current;
    }
    if (status === 'read' && current.status === 'read') return current;

    await this.db
      .prepare(
        `UPDATE notifications
            SET status = ?, read_at = COALESCE(read_at, now())
          WHERE id = ?`,
      )
      .run(status, id);
    return this.getNotification(userId, id);
  }
}
