// Postgres port of the trip/item persistence that lives inline in resolvers.ts.
// Permission checks stay in the resolver; this module owns the SQL and the
// invariants that must hold regardless of who calls it (owner membership,
// atomic ownership transfer, cascade delete).

import { randomUUID } from 'node:crypto';
import type { AsyncDb } from './db.ts';

export interface TripRowFull {
  id: string;
  name: string;
  destination_id: string | null;
  destination_name: string | null;
  destination_lat: number | null;
  destination_lng: number | null;
  start_date: string | null;
  end_date: string | null;
  total_budget: number | null;
  cover_preset: string | null;
  cover_photo_url: string | null;
  timezone: string | null;
  owner_id: string;
  invite_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface TripMemberRow {
  user_id: string;
  role: string;
  joined_at: string | null;
  invited_email: string | null;
}

export interface TripItemRow {
  id: string;
  trip_id: string;
  day: string | null;
  order: number | null;
  location_id: string | null;
  location_text: string | null;
  location_name: string | null;
  location_address: string | null;
  lat: number | null;
  lng: number | null;
  title: string;
  category: string | null;
  cost: number | null;
  start_time: string | null;
  notes: string | null;
  image_url: string | null;
  created_by: string | null;
  reminder_enabled: number;
  reminder_sent: number;
  reminder_due_at: string | null;
}

export interface CreateTripInput {
  name: string;
  destinationId?: string | null;
  destinationName?: string | null;
  /** Schema requires both dates; callers must supply them. */
  startDate: string;
  endDate: string;
  totalBudget?: number | null;
  timezone?: string | null;
}

// Project rule: every trip has an owner membership row, so it is created in the
// same transaction as the trip itself.
export async function createTrip(
  db: AsyncDb,
  ownerId: string,
  input: CreateTripInput,
  id: string = randomUUID(),
): Promise<TripRowFull> {
  const inviteCode = randomUUID().slice(0, 8).toUpperCase();
  return db.transaction(async (tx) => {
    await tx
      .prepare(
        `INSERT INTO trips
           (id, name, destination_id, destination_name, start_date, end_date, total_budget, timezone, owner_id, invite_code)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.destinationId ?? null,
        input.destinationName ?? null,
        input.startDate,
        input.endDate,
        input.totalBudget ?? 0,
        input.timezone?.trim() || 'UTC',
        ownerId,
        inviteCode,
      );
    await tx.prepare("INSERT INTO trip_members (trip_id, user_id, role) VALUES (?, ?, 'owner')").run(id, ownerId);
    const row = await tx.prepare('SELECT * FROM trips WHERE id = ?').get<TripRowFull>(id);
    if (!row) throw new Error('No se pudo crear el viaje');
    return row;
  });
}

export async function getTrip(db: AsyncDb, tripId: string): Promise<TripRowFull | null> {
  const row = await db.prepare('SELECT * FROM trips WHERE id = ?').get<TripRowFull>(tripId);
  return row ?? null;
}

export async function listTripsForUser(
  db: AsyncDb,
  userId: string,
): Promise<
  {
    id: string;
    name: string;
    destination_name: string | null;
    start_date: string | null;
    end_date: string | null;
    role: string;
    joined_at: string | null;
  }[]
> {
  return db
    .prepare(
      `SELECT t.id, t.name, t.destination_name, t.start_date, t.end_date, m.role, m.joined_at
       FROM trip_members m
       JOIN trips t ON t.id = m.trip_id
       WHERE m.user_id = ?
       ORDER BY m.joined_at DESC`,
    )
    .all(userId);
}

export async function updateTripSettings(
  db: AsyncDb,
  tripId: string,
  patch: { name: string; startDate: string | null; endDate: string | null; destinationId: string | null; destinationName: string | null },
): Promise<void> {
  await db
    .prepare(
      `UPDATE trips SET name = ?, start_date = ?, end_date = ?, destination_id = ?, destination_name = ?, updated_at = now()
       WHERE id = ?`,
    )
    .run(patch.name, patch.startDate, patch.endDate, patch.destinationId, patch.destinationName, tripId);
}

export async function setBudget(db: AsyncDb, tripId: string, totalBudget: number): Promise<void> {
  await db.prepare('UPDATE trips SET total_budget = ?, updated_at = now() WHERE id = ?').run(totalBudget, tripId);
}

export async function listMembers(db: AsyncDb, tripId: string): Promise<TripMemberRow[]> {
  return db
    .prepare(
      'SELECT user_id, role, joined_at, invited_email FROM trip_members WHERE trip_id = ? ORDER BY joined_at ASC',
    )
    .all<TripMemberRow>(tripId);
}

export async function getMemberRole(db: AsyncDb, tripId: string, userId: string): Promise<string | null> {
  const row = await db
    .prepare('SELECT role FROM trip_members WHERE trip_id = ? AND user_id = ?')
    .get<{ role: string }>(tripId, userId);
  return row?.role ?? null;
}

export async function isTripMember(db: AsyncDb, tripId: string, userId: string): Promise<boolean> {
  return (await getMemberRole(db, tripId, userId)) !== null;
}

export async function inviteMember(db: AsyncDb, tripId: string, userId: string, role: string): Promise<void> {
  await db
    .prepare('INSERT INTO trip_members (trip_id, user_id, role) VALUES (?, ?, ?) ON CONFLICT DO NOTHING')
    .run(tripId, userId, role);
}

// Join flow: preserve the address the recruiter typed, even if the demo user
// later edits their profile email. Existing rows keep their first invited email.
export async function addInvitedMember(
  db: AsyncDb,
  tripId: string,
  userId: string,
  role: string,
  invitedEmail: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO trip_members (trip_id, user_id, role, invited_email)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (trip_id, user_id) DO UPDATE
       SET invited_email = COALESCE(trip_members.invited_email, EXCLUDED.invited_email)`,
    )
    .run(tripId, userId, role, invitedEmail);
}

export async function updateMemberRole(db: AsyncDb, tripId: string, userId: string, role: string): Promise<void> {
  await db.prepare('UPDATE trip_members SET role = ? WHERE trip_id = ? AND user_id = ?').run(role, tripId, userId);
}

export async function removeMember(db: AsyncDb, tripId: string, userId: string): Promise<void> {
  await db.prepare('DELETE FROM trip_members WHERE trip_id = ? AND user_id = ?').run(tripId, userId);
}

// Leaves the trip as owner: the ownership moves first, in the same transaction,
// so a trip can never end up without an owner.
export async function transferOwnershipAndLeave(
  db: AsyncDb,
  tripId: string,
  currentOwnerId: string,
  newOwnerId: string,
): Promise<void> {
  const target = await getMemberRole(db, tripId, newOwnerId);
  if (!target || newOwnerId === currentOwnerId) {
    throw new Error('El nuevo propietario debe ser otro miembro del viaje.');
  }
  await db.transaction(async (tx) => {
    await tx.prepare('UPDATE trips SET owner_id = ?, updated_at = now() WHERE id = ?').run(newOwnerId, tripId);
    await tx.prepare("UPDATE trip_members SET role = 'owner' WHERE trip_id = ? AND user_id = ?").run(tripId, newOwnerId);
    await tx.prepare('DELETE FROM trip_members WHERE trip_id = ? AND user_id = ?').run(tripId, currentOwnerId);
  });
}

// Attachments are removed first; attachment_viewers cascades from item_attachments.
export async function deleteTripCascade(db: AsyncDb, tripId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .prepare(
        'DELETE FROM item_attachments WHERE item_id IN (SELECT id FROM trip_items WHERE trip_id = ?)',
      )
      .run(tripId);
    await tx.prepare('DELETE FROM trip_items WHERE trip_id = ?').run(tripId);
    await tx.prepare('DELETE FROM trip_members WHERE trip_id = ?').run(tripId);
    await tx.prepare('DELETE FROM invitations WHERE trip_id = ?').run(tripId);
    await tx.prepare('DELETE FROM trips WHERE id = ?').run(tripId);
  });
}

export async function listItems(db: AsyncDb, tripId: string): Promise<TripItemRow[]> {
  return db
    .prepare('SELECT * FROM trip_items WHERE trip_id = ? ORDER BY day ASC, "order" ASC')
    .all<TripItemRow>(tripId);
}

export async function getItem(db: AsyncDb, tripId: string, itemId: string): Promise<TripItemRow | null> {
  const row = await db
    .prepare('SELECT * FROM trip_items WHERE id = ? AND trip_id = ?')
    .get<TripItemRow>(itemId, tripId);
  return row ?? null;
}

export interface AddItemInput {
  locationId?: string | null;
  locationText?: string | null;
  locationName?: string | null;
  locationAddress?: string | null;
  lat?: number | null;
  lng?: number | null;
  title: string;
  category: string;
  cost?: number | null;
  /** Required by the schema: every item belongs to a day. */
  day: string;
  order?: number | null;
  startTime?: string | null;
  notes?: string | null;
  imageUrl?: string | null;
}

export async function addItem(
  db: AsyncDb,
  tripId: string,
  userId: string,
  input: AddItemInput,
  id: string = randomUUID(),
): Promise<TripItemRow> {
  await db
    .prepare(
      `INSERT INTO trip_items
         (id, trip_id, location_id, location_text, location_name, location_address, lat, lng,
          title, category, cost, day, "order", start_time, notes, image_url, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      tripId,
      input.locationId ?? null,
      input.locationText ?? null,
      input.locationName ?? null,
      input.locationAddress ?? null,
      input.lat ?? null,
      input.lng ?? null,
      input.title,
      input.category,
      input.cost ?? 0,
      input.day,
      input.order ?? 0,
      input.startTime ?? null,
      input.notes ?? null,
      input.imageUrl ?? null,
      userId,
    );
  const row = await db.prepare('SELECT * FROM trip_items WHERE id = ?').get<TripItemRow>(id);
  if (!row) throw new Error('No se pudo crear el ítem');
  return row;
}

export async function updateItemFields(
  db: AsyncDb,
  itemId: string,
  fields: {
    day: string | null;
    order: number | null;
    startTime: string | null;
    notes: string | null;
    title: string;
    locationText: string | null;
  },
): Promise<void> {
  await db
    .prepare('UPDATE trip_items SET day = ?, "order" = ?, start_time = ?, notes = ?, title = ?, location_text = ? WHERE id = ?')
    .run(fields.day, fields.order, fields.startTime, fields.notes, fields.title, fields.locationText, itemId);
}

export async function setItemCost(db: AsyncDb, itemId: string, cost: number): Promise<void> {
  await db.prepare('UPDATE trip_items SET cost = ? WHERE id = ?').run(cost, itemId);
}

export async function moveItem(db: AsyncDb, itemId: string, day: string, order: number): Promise<void> {
  await db.prepare('UPDATE trip_items SET day = ?, "order" = ? WHERE id = ?').run(day, order, itemId);
}

export async function removeItem(db: AsyncDb, itemId: string): Promise<void> {
  await db.prepare('DELETE FROM trip_items WHERE id = ?').run(itemId);
}

export interface TripStats {
  spent: number;
  spentByCategory: { category: string; amount: number }[];
}

// Pure: the itinerary summary is derived from the items, never stored.
export function computeTripStats(items: readonly { category: string | null; cost: number | null }[]): TripStats {
  const spent = items.reduce((sum, item) => sum + (item.cost ?? 0), 0);
  const byCategory = new Map<string, number>();
  for (const item of items) {
    const category = item.category ?? 'activity';
    byCategory.set(category, (byCategory.get(category) ?? 0) + (item.cost ?? 0));
  }
  return {
    spent,
    spentByCategory: [...byCategory.entries()].map(([category, amount]) => ({ category, amount })),
  };
}
