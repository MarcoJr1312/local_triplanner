// SQL for the local notification inbox. Notifications are owned by the users
// service; trip_id / invitation_id are opaque references to the trips service.

import type { Db } from '../db.ts';
import type { NotificationJoinedRow, NotificationRow } from './types.ts';

const JOINED_COLUMNS = `
  n.id, n.user_id, n.type, n.trip_id, n.trip_name, n.invitation_id,
  n.inviter_user_id, n.role, n.item_id, n.item_title, n.start_at,
  n.lead_minutes, n.dedupe_key, n.status, n.created_at, n.read_at,
  u.id AS inviter_id, u.username AS inviter_username, u.email AS inviter_email,
  u.display_name AS inviter_display_name, u.color AS inviter_color,
  u.avatar_url AS inviter_avatar_url, u.language AS inviter_language,
  u.created_at AS inviter_created_at, u.deleted_at AS inviter_deleted_at`;

const JOINED_FROM = `FROM notifications n LEFT JOIN users u ON u.id = n.inviter_user_id`;

export async function findById(
  db: Db,
  id: string,
): Promise<NotificationJoinedRow | null> {
  return db.one<NotificationJoinedRow>(
    `SELECT ${JOINED_COLUMNS} ${JOINED_FROM} WHERE n.id = $1`,
    [id],
  );
}

export async function listForUser(
  db: Db,
  userId: string,
  status: string | null,
  limit: number,
): Promise<NotificationJoinedRow[]> {
  if (status) {
    return db.query<NotificationJoinedRow>(
      `SELECT ${JOINED_COLUMNS} ${JOINED_FROM}
        WHERE n.user_id = $1 AND n.status = $2
        ORDER BY n.created_at DESC
        LIMIT $3`,
      [userId, status, limit],
    );
  }
  return db.query<NotificationJoinedRow>(
    `SELECT ${JOINED_COLUMNS} ${JOINED_FROM}
      WHERE n.user_id = $1
      ORDER BY n.created_at DESC
      LIMIT $2`,
    [userId, limit],
  );
}

export interface InsertNotification {
  id: string;
  userId: string;
  type: string;
  tripId: string;
  tripName: string;
  invitationId: string;
  inviterUserId: string;
  role: string;
}

export interface InsertResult {
  id: string;
  created: boolean;
}

export async function insert(
  db: Db,
  notification: InsertNotification,
): Promise<InsertResult> {
  const row = await db.one<NotificationRow>(
    `INSERT INTO notifications
       (id, user_id, type, trip_id, trip_name, invitation_id, inviter_user_id, role)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (user_id, invitation_id) DO NOTHING
     RETURNING id`,
    [
      notification.id,
      notification.userId,
      notification.type,
      notification.tripId,
      notification.tripName,
      notification.invitationId,
      notification.inviterUserId,
      notification.role,
    ],
  );
  if (row) return { id: row.id, created: true };

  const existing = await db.one<{ id: string }>(
    'SELECT id FROM notifications WHERE user_id = $1 AND invitation_id = $2',
    [notification.userId, notification.invitationId],
  );
  if (!existing) throw new Error('notification insert conflicted but no row exists');
  return { id: existing.id, created: false };
}

export interface InsertReminderNotification {
  id: string;
  userId: string;
  tripId: string;
  tripName: string;
  itemId: string;
  itemTitle: string;
  startAt: string;
  leadMinutes: number;
  dedupeKey: string;
}

export async function insertReminder(
  db: Db,
  notification: InsertReminderNotification,
): Promise<InsertResult> {
  const row = await db.one<{ id: string }>(
    `INSERT INTO notifications
       (id, user_id, type, trip_id, trip_name, item_id, item_title, start_at,
        lead_minutes, dedupe_key)
     VALUES ($1, $2, 'activity_reminder', $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (user_id, dedupe_key) DO NOTHING
     RETURNING id`,
    [
      notification.id,
      notification.userId,
      notification.tripId,
      notification.tripName,
      notification.itemId,
      notification.itemTitle,
      notification.startAt,
      notification.leadMinutes,
      notification.dedupeKey,
    ],
  );
  if (row) return { id: row.id, created: true };

  const existing = await db.one<{ id: string }>(
    'SELECT id FROM notifications WHERE user_id = $1 AND dedupe_key = $2',
    [notification.userId, notification.dedupeKey],
  );
  if (!existing) throw new Error('notification insert conflicted but no row exists');
  return { id: existing.id, created: false };
}

export async function setStatus(
  db: Db,
  id: string,
  status: string,
): Promise<void> {
  await db.run(
    `UPDATE notifications
        SET status = $2,
            read_at = COALESCE(read_at, now())
      WHERE id = $1`,
    [id, status],
  );
}
