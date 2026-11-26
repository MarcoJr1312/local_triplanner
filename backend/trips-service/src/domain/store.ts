// SQL for trips, members and items. Every function here is scoped to the trips
// database; no platform tables are referenced.

import type { Queryable } from '../db.ts';
import type {
  CategorySpend,
  EmailInvitationRow,
  InvitationRole,
  LocalInvitationRow,
  OutboxRow,
  Role,
  TripAggregate,
  TripItemRow,
  TripMemberRow,
  TripRow,
  TripSummaryRow,
} from './types.ts';

export interface NewTrip {
  id: string;
  name: string;
  destination_id: string | null;
  destination_name: string | null;
  destination_lat: number | null;
  destination_lng: number | null;
  start_date: string;
  end_date: string;
  total_budget: number;
  timezone: string;
  owner_id: string;
  invite_code: string;
}

export interface NewItem {
  id: string;
  trip_id: string;
  location_id: string | null;
  location_text: string | null;
  location_name: string | null;
  location_address: string | null;
  lat: number | null;
  lng: number | null;
  title: string;
  category: string;
  cost: number;
  day: string;
  order: number;
  start_time: string | null;
  notes: string | null;
  image_url: string | null;
  created_by: string;
}

export type TripColumns = Partial<
  Pick<
    TripRow,
    | 'name'
    | 'destination_id'
    | 'destination_name'
    | 'destination_lat'
    | 'destination_lng'
    | 'start_date'
    | 'end_date'
    | 'total_budget'
    | 'cover_preset'
    | 'cover_photo_url'
    | 'timezone'
    | 'owner_id'
  >
>;

export type ItemColumns = Partial<
  Pick<
    TripItemRow,
    | 'location_id'
    | 'location_text'
    | 'location_name'
    | 'location_address'
    | 'lat'
    | 'lng'
    | 'title'
    | 'category'
    | 'cost'
    | 'day'
    | 'order'
    | 'start_time'
    | 'notes'
    | 'image_url'
  >
>;

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}

function setClause(columns: Record<string, unknown>): { sql: string; values: unknown[] } {
  const entries = Object.entries(columns);
  return {
    sql: entries.map(([column], index) => `"${column}" = $${index + 1}`).join(', '),
    values: entries.map(([, value]) => value),
  };
}

export async function getTrip(db: Queryable, tripId: string): Promise<TripRow | null> {
  return db.one<TripRow>('SELECT * FROM trips WHERE id = $1', [tripId]);
}

export async function listTripsForUser(
  db: Queryable,
  userId: string,
): Promise<TripSummaryRow[]> {
  return db.query<TripSummaryRow>(
    `SELECT t.id, t.name, t.destination_name, t.start_date, t.end_date,
            m.role, m.joined_at
       FROM trip_members m
       JOIN trips t ON t.id = m.trip_id
      WHERE m.user_id = $1
      ORDER BY m.joined_at DESC`,
    [userId],
  );
}

/** Returns false when the id already exists (idempotent retry). */
export async function insertTrip(tx: Queryable, input: NewTrip): Promise<boolean> {
  const row = await tx.one<{ id: string }>(
    `INSERT INTO trips
       (id, name, destination_id, destination_name, destination_lat, destination_lng,
        start_date, end_date, total_budget, timezone, owner_id, invite_code)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [
      input.id,
      input.name,
      input.destination_id,
      input.destination_name,
      input.destination_lat,
      input.destination_lng,
      input.start_date,
      input.end_date,
      input.total_budget,
      input.timezone,
      input.owner_id,
      input.invite_code,
    ],
  );
  return row !== null;
}

export async function insertOwnerMembership(
  tx: Queryable,
  tripId: string,
  ownerId: string,
): Promise<void> {
  await tx.run(
    `INSERT INTO trip_members (trip_id, user_id, role)
     VALUES ($1, $2, 'owner')
     ON CONFLICT (trip_id, user_id) DO NOTHING`,
    [tripId, ownerId],
  );
}

export async function updateTripColumns(
  tx: Queryable,
  tripId: string,
  columns: TripColumns,
): Promise<void> {
  const { sql, values } = setClause(columns);
  const suffix = sql === '' ? 'updated_at = now()' : `${sql}, updated_at = now()`;
  await tx.run(`UPDATE trips SET ${suffix} WHERE id = $${values.length + 1}`, [...values, tripId]);
}

export async function deleteTripRow(tx: Queryable, tripId: string): Promise<boolean> {
  const changes = await tx.run('DELETE FROM trips WHERE id = $1', [tripId]);
  return changes > 0;
}

export async function listMembers(db: Queryable, tripId: string): Promise<TripMemberRow[]> {
  return db.query<TripMemberRow>(
    `SELECT user_id, role, joined_at, invited_email
       FROM trip_members
      WHERE trip_id = $1
      ORDER BY joined_at ASC, user_id ASC`,
    [tripId],
  );
}

export async function getMemberRole(
  db: Queryable,
  tripId: string,
  userId: string,
): Promise<Role | null> {
  const row = await db.one<{ role: Role }>(
    'SELECT role FROM trip_members WHERE trip_id = $1 AND user_id = $2',
    [tripId, userId],
  );
  return row?.role ?? null;
}

export async function upsertMember(
  tx: Queryable,
  tripId: string,
  userId: string,
  role: Role,
  invitedEmail: string | null,
): Promise<TripMemberRow> {
  const row = await tx.one<TripMemberRow>(
    `INSERT INTO trip_members (trip_id, user_id, role, invited_email)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (trip_id, user_id) DO UPDATE
       SET invited_email = COALESCE(EXCLUDED.invited_email, trip_members.invited_email)
     RETURNING user_id, role, joined_at, invited_email`,
    [tripId, userId, role, invitedEmail],
  );
  if (!row) throw new Error('No se pudo agregar el miembro');
  return row;
}

export async function updateMemberRoleRow(
  tx: Queryable,
  tripId: string,
  userId: string,
  role: Role,
): Promise<TripMemberRow | null> {
  return tx.one<TripMemberRow>(
    `UPDATE trip_members
        SET role = $3
      WHERE trip_id = $1 AND user_id = $2
      RETURNING user_id, role, joined_at, invited_email`,
    [tripId, userId, role],
  );
}

export async function removeMemberRow(
  tx: Queryable,
  tripId: string,
  userId: string,
): Promise<TripMemberRow | null> {
  return tx.one<TripMemberRow>(
    `DELETE FROM trip_members
      WHERE trip_id = $1 AND user_id = $2
      RETURNING user_id, role, joined_at, invited_email`,
    [tripId, userId],
  );
}

/**
 * Deletes the old owner before promoting the new one: the partial unique index
 * allows exactly one owner row per trip.
 */
export async function transferOwnershipAndLeave(
  tx: Queryable,
  tripId: string,
  currentOwnerId: string,
  newOwnerId: string,
): Promise<void> {
  await tx.run('DELETE FROM trip_members WHERE trip_id = $1 AND user_id = $2', [
    tripId,
    currentOwnerId,
  ]);
  await tx.run(
    "UPDATE trip_members SET role = 'owner' WHERE trip_id = $1 AND user_id = $2",
    [tripId, newOwnerId],
  );
  await tx.run('UPDATE trips SET owner_id = $1, updated_at = now() WHERE id = $2', [
    newOwnerId,
    tripId,
  ]);
}

export async function listItems(db: Queryable, tripId: string): Promise<TripItemRow[]> {
  return db.query<TripItemRow>(
    `SELECT * FROM trip_items
      WHERE trip_id = $1
      ORDER BY day ASC, "order" ASC, created_at ASC`,
    [tripId],
  );
}

/** Next append position for a day. `-1` from clients means "append". */
export async function nextItemOrder(
  db: Queryable,
  tripId: string,
  day: string,
): Promise<number> {
  const row = await db.one<{ next: number }>(
    `SELECT COALESCE(MAX("order"), -1) + 1 AS next
       FROM trip_items
      WHERE trip_id = $1 AND day = $2`,
    [tripId, day],
  );
  return row?.next ?? 0;
}

export async function getItem(
  db: Queryable,
  tripId: string,
  itemId: string,
): Promise<TripItemRow | null> {
  return db.one<TripItemRow>('SELECT * FROM trip_items WHERE id = $1 AND trip_id = $2', [
    itemId,
    tripId,
  ]);
}

export async function getItemAnyTrip(
  db: Queryable,
  itemId: string,
): Promise<TripItemRow | null> {
  return db.one<TripItemRow>('SELECT * FROM trip_items WHERE id = $1', [itemId]);
}

export async function insertItem(tx: Queryable, input: NewItem): Promise<TripItemRow> {
  const row = await tx.one<TripItemRow>(
    `INSERT INTO trip_items
       (id, trip_id, location_id, location_text, location_name, location_address, lat, lng,
        title, category, cost, day, "order", start_time, notes, image_url, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     RETURNING *`,
    [
      input.id,
      input.trip_id,
      input.location_id,
      input.location_text,
      input.location_name,
      input.location_address,
      input.lat,
      input.lng,
      input.title,
      input.category,
      input.cost,
      input.day,
      input.order,
      input.start_time,
      input.notes,
      input.image_url,
      input.created_by,
    ],
  );
  if (!row) throw new Error('No se pudo crear el ítem');
  return row;
}

export async function updateItemColumns(
  tx: Queryable,
  tripId: string,
  itemId: string,
  columns: ItemColumns,
): Promise<void> {
  const { sql, values } = setClause(columns);
  if (sql === '') return;
  await tx.run(
    `UPDATE trip_items SET ${sql} WHERE id = $${values.length + 1} AND trip_id = $${values.length + 2}`,
    [...values, itemId, tripId],
  );
}

export async function deleteItemRow(
  tx: Queryable,
  tripId: string,
  itemId: string,
): Promise<TripItemRow | null> {
  return tx.one<TripItemRow>(
    'DELETE FROM trip_items WHERE id = $1 AND trip_id = $2 RETURNING *',
    [itemId, tripId],
  );
}

// ------------------------------------------------------------- reminders

export interface ReminderConfigRow {
  item_id: string;
  trip_id: string;
  enabled: boolean;
  lead_minutes: number;
  updated_by: string;
  recipient_ids: string[];
}

export interface DueReminderRow {
  item_id: string;
  trip_id: string;
  trip_name: string;
  timezone: string;
  item_title: string;
  day: string;
  start_time: string;
  lead_minutes: number;
  recipient_ids: string[];
}

export async function listReminderConfigs(
  db: Queryable,
  tripId: string,
): Promise<ReminderConfigRow[]> {
  return db.query<ReminderConfigRow>(
    `SELECT r.item_id, r.trip_id, r.enabled, r.lead_minutes, r.updated_by,
            COALESCE(
              array_agg(rc.user_id) FILTER (WHERE rc.user_id IS NOT NULL),
              ARRAY[]::text[]
            ) AS recipient_ids
       FROM trip_item_reminders r
       LEFT JOIN trip_item_reminder_recipients rc ON rc.item_id = r.item_id
      WHERE r.trip_id = $1
      GROUP BY r.item_id, r.trip_id, r.enabled, r.lead_minutes, r.updated_by`,
    [tripId],
  );
}

export async function upsertReminder(
  tx: Queryable,
  input: {
    item_id: string;
    trip_id: string;
    lead_minutes: number;
    updated_by: string;
  },
): Promise<void> {
  await tx.run(
    `INSERT INTO trip_item_reminders
       (item_id, trip_id, enabled, lead_minutes, updated_by)
     VALUES ($1, $2, true, $3, $4)
     ON CONFLICT (item_id) DO UPDATE
       SET enabled = true,
           lead_minutes = EXCLUDED.lead_minutes,
           updated_by = EXCLUDED.updated_by,
           updated_at = now()`,
    [input.item_id, input.trip_id, input.lead_minutes, input.updated_by],
  );
}

export async function replaceReminderRecipients(
  tx: Queryable,
  itemId: string,
  userIds: readonly string[],
): Promise<void> {
  if (userIds.length === 0) {
    await tx.run('DELETE FROM trip_item_reminder_recipients WHERE item_id = $1', [itemId]);
    return;
  }
  await tx.run(
    `DELETE FROM trip_item_reminder_recipients
      WHERE item_id = $1 AND user_id <> ALL($2::text[])`,
    [itemId, userIds],
  );
  for (const userId of userIds) {
    await tx.run(
      `INSERT INTO trip_item_reminder_recipients (item_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [itemId, userId],
    );
  }
}

export async function deleteReminder(tx: Queryable, itemId: string): Promise<void> {
  await tx.run('DELETE FROM trip_item_reminders WHERE item_id = $1', [itemId]);
}

export async function listDueReminders(db: Queryable): Promise<DueReminderRow[]> {
  return db.query<DueReminderRow>(
    `SELECT r.item_id, r.trip_id, t.name AS trip_name, t.timezone,
            i.title AS item_title, i.day, i.start_time, r.lead_minutes,
            COALESCE(
              array_agg(rc.user_id) FILTER (WHERE rc.user_id IS NOT NULL AND rc.sent_at IS NULL),
              ARRAY[]::text[]
            ) AS recipient_ids
       FROM trip_item_reminders r
       JOIN trips t ON t.id = r.trip_id
       JOIN trip_items i ON i.id = r.item_id
       LEFT JOIN trip_item_reminder_recipients rc ON rc.item_id = r.item_id
      WHERE r.enabled = true AND i.start_time IS NOT NULL
      GROUP BY r.item_id, r.trip_id, t.name, t.timezone,
               i.title, i.day, i.start_time, r.lead_minutes`,
  );
}

export async function markReminderRecipientsSent(
  db: Queryable,
  itemId: string,
  userIds: readonly string[],
  sentAt: string,
): Promise<void> {
  if (userIds.length === 0) return;
  await db.run(
    `UPDATE trip_item_reminder_recipients
        SET sent_at = $3
      WHERE item_id = $1 AND user_id = ANY($2::text[]) AND sent_at IS NULL`,
    [itemId, userIds, sentAt],
  );
}

export async function removeUserFromTripReminders(
  db: Queryable,
  tripId: string,
  userId: string,
): Promise<void> {
  await db.run(
    `DELETE FROM trip_item_reminder_recipients rc
      USING trip_item_reminders r
      WHERE rc.item_id = r.item_id AND r.trip_id = $1 AND rc.user_id = $2`,
    [tripId, userId],
  );
  await db.run(
    `DELETE FROM trip_item_reminders r
      WHERE r.trip_id = $1
        AND NOT EXISTS (
          SELECT 1 FROM trip_item_reminder_recipients rc WHERE rc.item_id = r.item_id
        )`,
    [tripId],
  );
}

export function computeTripStats(
  items: readonly Pick<TripItemRow, 'category' | 'cost'>[],
): { spent: number; spent_by_category: CategorySpend[] } {
  let spent = 0;
  const byCategory = new Map<string, number>();

  for (const item of items) {
    const cost = Number(item.cost) || 0;
    spent += cost;
    const category = item.category ?? 'activity';
    byCategory.set(category, (byCategory.get(category) ?? 0) + cost);
  }

  return {
    spent,
    spent_by_category: [...byCategory.entries()].map(([category, amount]) => ({
      category,
      amount,
    })),
  };
}

export async function buildAggregate(
  db: Queryable,
  trip: TripRow,
  actorId: string,
): Promise<TripAggregate> {
  const members = await listMembers(db, trip.id);
  const items = await listItems(db, trip.id);
  const role = await getMemberRole(db, trip.id, actorId);
  const stats = computeTripStats(items);

  return {
    ...trip,
    my_role: role ?? 'viewer',
    members,
    items,
    spent: stats.spent,
    spent_by_category: stats.spent_by_category,
  };
}

// ------------------------------------------------------------- invitations

export interface NewInvitation {
  id: string;
  trip_id: string;
  email: string;
  code: string;
  role: InvitationRole;
  created_by: string;
}

export async function insertInvitation(
  tx: Queryable,
  input: NewInvitation,
): Promise<EmailInvitationRow> {
  const row = await tx.one<EmailInvitationRow>(
    `INSERT INTO invitations (id, trip_id, email, code, role, status, created_by, channel)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6, 'email')
     RETURNING *`,
    [input.id, input.trip_id, input.email, input.code, input.role, input.created_by],
  );
  if (!row) throw new Error('No se pudo crear la invitación');
  return row;
}

export async function findInvitationByCode(
  db: Queryable,
  code: string,
): Promise<EmailInvitationRow | null> {
  return db.one<EmailInvitationRow>(
    "SELECT * FROM invitations WHERE code = $1 AND channel = 'email'",
    [code],
  );
}

/** Locks the invitation row for the join transaction. */
export async function findInvitationForJoin(
  tx: Queryable,
  tripId: string,
  code: string,
): Promise<EmailInvitationRow | null> {
  return tx.one<EmailInvitationRow>(
    `SELECT * FROM invitations
      WHERE code = $1 AND trip_id = $2 AND channel = 'email'
      FOR UPDATE`,
    [code, tripId],
  );
}

export interface NewLocalInvitation {
  id: string;
  trip_id: string;
  invitee_user_id: string;
  role: InvitationRole;
  created_by: string;
}

/**
 * Creates one pending local invitation per trip+user. A retry returns the
 * existing pending row instead of duplicating it.
 */
export async function insertLocalInvitation(
  tx: Queryable,
  input: NewLocalInvitation,
): Promise<{ invitation: LocalInvitationRow; created: boolean }> {
  const inserted = await tx.one<LocalInvitationRow>(
    `INSERT INTO invitations
       (id, trip_id, email, code, role, status, created_by, channel, invitee_user_id)
     VALUES ($1, $2, NULL, NULL, $3, 'pending', $4, 'local', $5)
     ON CONFLICT (trip_id, invitee_user_id)
       WHERE channel = 'local' AND status = 'pending'
       DO NOTHING
     RETURNING *`,
    [input.id, input.trip_id, input.role, input.created_by, input.invitee_user_id],
  );
  if (inserted) return { invitation: inserted, created: true };

  const existing = await tx.one<LocalInvitationRow>(
    `SELECT * FROM invitations
      WHERE trip_id = $1 AND invitee_user_id = $2
        AND channel = 'local' AND status = 'pending'`,
    [input.trip_id, input.invitee_user_id],
  );
  if (!existing) throw new Error('No se pudo crear la invitación local');
  return { invitation: existing, created: false };
}

/** Locks a local invitation for join/decline. */
export async function findLocalInvitationForUpdate(
  tx: Queryable,
  tripId: string,
  invitationId: string,
): Promise<LocalInvitationRow | null> {
  return tx.one<LocalInvitationRow>(
    `SELECT * FROM invitations
      WHERE id = $1 AND trip_id = $2 AND channel = 'local'
      FOR UPDATE`,
    [invitationId, tripId],
  );
}

export async function declineInvitation(
  tx: Queryable,
  invitationId: string,
): Promise<LocalInvitationRow | null> {
  return tx.one<LocalInvitationRow>(
    `UPDATE invitations
        SET status = 'declined'
      WHERE id = $1 AND status = 'pending'
      RETURNING *`,
    [invitationId],
  );
}

/** Inviter/editor cancels a pending local invite (notification compensation). */
export async function revokeInvitation(
  tx: Queryable,
  invitationId: string,
): Promise<LocalInvitationRow | null> {
  return tx.one<LocalInvitationRow>(
    `UPDATE invitations
        SET status = 'revoked'
      WHERE id = $1 AND status = 'pending'
      RETURNING *`,
    [invitationId],
  );
}

export async function acceptInvitation(
  tx: Queryable,
  invitationId: string,
): Promise<void> {
  await tx.run(
    "UPDATE invitations SET status = 'accepted', accepted_at = now() WHERE id = $1",
    [invitationId],
  );
}

// ------------------------------------------------------------------ outbox

export interface NewOutbox {
  id: string;
  topic: string;
  event_key: string;
  payload: unknown;
}

export async function enqueueOutbox(tx: Queryable, input: NewOutbox): Promise<void> {
  await tx.run(
    `INSERT INTO outbox (id, topic, event_key, payload)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [input.id, input.topic, input.event_key, JSON.stringify(input.payload)],
  );
}

export async function lockPendingOutbox(
  tx: Queryable,
  limit: number,
  maxAttempts: number,
): Promise<OutboxRow[]> {
  return tx.query<OutboxRow>(
    `SELECT * FROM outbox
      WHERE published_at IS NULL AND attempts < $1
      ORDER BY created_at ASC
      LIMIT $2
      FOR UPDATE SKIP LOCKED`,
    [maxAttempts, limit],
  );
}

export async function markOutboxPublished(
  tx: Queryable,
  id: string,
  brokerOffset: number,
): Promise<void> {
  await tx.run(
    `UPDATE outbox
        SET published_at = now(), broker_offset = $1, attempts = attempts + 1,
            last_error = NULL
      WHERE id = $2`,
    [brokerOffset, id],
  );
}

export async function markOutboxFailed(
  tx: Queryable,
  id: string,
  error: string,
): Promise<void> {
  await tx.run('UPDATE outbox SET attempts = attempts + 1, last_error = $1 WHERE id = $2', [
    error.slice(0, 2_000),
    id,
  ]);
}

export async function resetOutbox(db: Queryable, id: string): Promise<boolean> {
  const changes = await db.run(
    `UPDATE outbox
        SET published_at = NULL, attempts = 0, last_error = NULL, broker_offset = NULL
      WHERE id = $1`,
    [id],
  );
  return changes > 0;
}

export async function countPendingOutbox(db: Queryable): Promise<number> {
  const row = await db.one<{ count: number }>(
    'SELECT COUNT(*)::int AS count FROM outbox WHERE published_at IS NULL',
  );
  return Number(row?.count ?? 0);
}
