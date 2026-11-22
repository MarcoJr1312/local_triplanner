// Local adapter: wraps the existing Postgres trip/invitation functions. Used
// while TRIPS_MODE=local and as the rollback path until M9.11.

import { brokerPublisher } from '../broker.ts';
import { buildJoinUrl } from '../invite-links.ts';
import type { AsyncDb } from '../pg/db.ts';
import {
  acceptInvitation,
  createInvitation as createInvitationRow,
  findInvitationByCode,
} from '../pg/invitations.ts';
import { recomputeItemReminder } from '../pg/reminders.ts';
import {
  addInvitedMember,
  addItem as addItemRow,
  computeTripStats,
  createTrip as createTripRow,
  deleteTripCascade,
  getItem,
  getMemberRole,
  getTrip,
  inviteMember as inviteMemberRow,
  isTripMember,
  listItems,
  listMembers,
  listTripsForUser,
  moveItem as moveItemRow,
  removeItem as removeItemRow,
  removeMember as removeMemberRow,
  setBudget as setBudgetRow,
  setItemCost as setItemCostRow,
  transferOwnershipAndLeave,
  updateItemFields,
  updateMemberRole as updateMemberRoleRow,
  type TripItemRow,
  type TripRowFull,
} from '../pg/trips.ts';
import { tripError } from './errors.ts';
import type {
  AddItemInput,
  CreateInvitationInput,
  CreateTripInput,
  InvitationResult,
  InviteRole,
  JoinInput,
  JoinResult,
  TripData,
  TripPreviewData,
  TripRole,
  TripSummaryData,
  TripsStore,
  UpdateItemInput,
  UpdateTripInput,
} from './types.ts';

function asRole(value: string | null | undefined): TripRole | null {
  return value === 'owner' || value === 'editor' || value === 'viewer' ? value : null;
}

export class LocalTripsStore implements TripsStore {
  constructor(private readonly db: AsyncDb) {}

  async listMyTrips(userId: string): Promise<TripSummaryData[]> {
    const rows = await listTripsForUser(this.db, userId);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      destination_name: row.destination_name,
      start_date: row.start_date ?? '',
      end_date: row.end_date ?? '',
      role: asRole(row.role) ?? 'viewer',
      joined_at: row.joined_at ?? '',
    }));
  }

  async getTrip(userId: string, tripId: string): Promise<TripData> {
    await this.requireTrip(tripId);
    await this.requireMember(tripId, userId);
    return this.aggregate(tripId, userId);
  }

  async createTrip(userId: string, input: CreateTripInput): Promise<TripData> {
    const trip = await createTripRow(this.db, userId, {
      name: input.name,
      destinationId: input.destinationId ?? null,
      destinationName: input.destinationName ?? null,
      startDate: input.startDate,
      endDate: input.endDate,
      totalBudget: input.totalBudget ?? 0,
      timezone: input.timezone ?? 'UTC',
    });

    if (input.destinationLat != null || input.destinationLng != null) {
      await this.db
        .prepare('UPDATE trips SET destination_lat = ?, destination_lng = ? WHERE id = ?')
        .run(input.destinationLat ?? null, input.destinationLng ?? null, trip.id);
    }

    return this.aggregate(trip.id, userId);
  }

  async updateTrip(
    userId: string,
    tripId: string,
    input: UpdateTripInput,
  ): Promise<TripData> {
    const role = await this.requireMember(tripId, userId);
    const touchesCover =
      input.removePhoto !== undefined ||
      input.coverPreset !== undefined ||
      input.coverPhotoUrl !== undefined;
    if (touchesCover) this.requireOwner(role);
    else this.requireEditor(role);

    const trip = await this.requireTrip(tripId);
    const startDate = input.startDate ?? trip.start_date ?? '';
    const endDate = input.endDate ?? trip.end_date ?? '';
    if (endDate < startDate) {
      throw tripError('INVALID_ARGUMENT', 'end_date: debe ser mayor o igual a start_date');
    }
    if (input.totalBudget !== undefined && input.totalBudget < 0) {
      throw tripError('INVALID_ARGUMENT', 'total_budget: debe ser mayor o igual a 0');
    }

    await this.db
      .prepare(
        `UPDATE trips
            SET name = ?, start_date = ?, end_date = ?, destination_id = ?,
                destination_name = ?, destination_lat = ?, destination_lng = ?,
                updated_at = now()
          WHERE id = ?`,
      )
      .run(
        input.name ?? trip.name,
        startDate,
        endDate,
        input.destinationId !== undefined ? input.destinationId : trip.destination_id,
        input.destinationName !== undefined ? input.destinationName : trip.destination_name,
        input.destinationLat !== undefined ? input.destinationLat : trip.destination_lat,
        input.destinationLng !== undefined ? input.destinationLng : trip.destination_lng,
        tripId,
      );

    if (input.totalBudget !== undefined) {
      await setBudgetRow(this.db, tripId, input.totalBudget);
    }

    if (touchesCover) {
      let preset = trip.cover_preset;
      let photo = trip.cover_photo_url;
      if (input.removePhoto) {
        photo = null;
      } else if (input.coverPreset !== undefined) {
        preset = input.coverPreset;
        photo = null;
      } else if (input.coverPhotoUrl !== undefined) {
        photo = input.coverPhotoUrl;
      }
      await this.db
        .prepare(
          'UPDATE trips SET cover_preset = ?, cover_photo_url = ?, updated_at = now() WHERE id = ?',
        )
        .run(preset, photo, tripId);
    }

    return this.aggregate(tripId, userId);
  }

  async deleteTrip(userId: string, tripId: string): Promise<void> {
    await this.requireTrip(tripId);
    this.requireOwner(await this.requireMember(tripId, userId));
    await deleteTripCascade(this.db, tripId);
  }

  async inviteMember(
    userId: string,
    tripId: string,
    targetUserId: string,
    role: InviteRole,
  ): Promise<TripData> {
    await this.requireTrip(tripId);
    this.requireEditor(await this.requireMember(tripId, userId));
    await inviteMemberRow(this.db, tripId, targetUserId, role);
    return this.aggregate(tripId, userId);
  }

  async updateMemberRole(
    userId: string,
    tripId: string,
    targetUserId: string,
    role: InviteRole,
  ): Promise<TripData> {
    const trip = await this.requireTrip(tripId);
    this.requireOwner(await this.requireMember(tripId, userId));
    if (targetUserId === trip.owner_id) {
      throw tripError('OWNER_ROLE_PROTECTED', 'El rol del propietario no se puede cambiar.');
    }
    if (!(await isTripMember(this.db, tripId, targetUserId))) {
      throw tripError('MEMBER_NOT_FOUND', 'Miembro no encontrado.');
    }
    await updateMemberRoleRow(this.db, tripId, targetUserId, role);
    return this.aggregate(tripId, userId);
  }

  async removeMember(
    userId: string,
    tripId: string,
    targetUserId: string,
  ): Promise<TripData> {
    const trip = await this.requireTrip(tripId);
    this.requireOwner(await this.requireMember(tripId, userId));
    if (targetUserId === trip.owner_id) {
      throw tripError(
        'OWNER_CANNOT_BE_REMOVED',
        'El propietario no se puede eliminar: transfiere la propiedad primero.',
      );
    }
    if (!(await isTripMember(this.db, tripId, targetUserId))) {
      throw tripError('MEMBER_NOT_FOUND', 'Miembro no encontrado.');
    }
    await removeMemberRow(this.db, tripId, targetUserId);
    return this.aggregate(tripId, userId);
  }

  async leaveTrip(
    userId: string,
    tripId: string,
    newOwnerId?: string | null,
  ): Promise<TripData> {
    const trip = await this.requireTrip(tripId);
    const role = await this.requireMember(tripId, userId);

    if (role !== 'owner') {
      await removeMemberRow(this.db, tripId, userId);
      return this.aggregate(tripId, userId);
    }

    if (!newOwnerId) {
      throw tripError('OWNER_MUST_TRANSFER', 'Debes transferir la propiedad antes de salir.');
    }
    if (newOwnerId === userId) {
      throw tripError('INVALID_TRANSFER_TARGET', 'El nuevo propietario debe ser otro miembro.');
    }
    try {
      await transferOwnershipAndLeave(this.db, tripId, userId, newOwnerId);
    } catch {
      throw tripError('INVALID_TRANSFER_TARGET', 'El nuevo propietario debe ser otro miembro.');
    }
    return this.aggregate(tripId, userId);
  }

  async getMemberRole(userId: string, tripId: string): Promise<TripRole | null> {
    return asRole(await getMemberRole(this.db, tripId, userId));
  }

  async isMember(userId: string, tripId: string): Promise<boolean> {
    return isTripMember(this.db, tripId, userId);
  }

  async assertMember(userId: string, tripId: string): Promise<void> {
    if (!(await this.isMember(userId, tripId))) {
      throw tripError('NOT_TRIP_MEMBER', 'No eres miembro de este viaje.');
    }
  }

  async listMemberIds(_userId: string, tripId: string): Promise<string[]> {
    return (await listMembers(this.db, tripId)).map((member) => member.user_id);
  }

  async addItem(userId: string, tripId: string, input: AddItemInput): Promise<TripItemRow> {
    this.requireEditor(await this.requireMember(tripId, userId));
    const row = await addItemRow(this.db, tripId, userId, {
      locationId: input.locationId ?? null,
      locationText: input.locationText ?? null,
      locationName: input.locationName ?? null,
      locationAddress: input.locationAddress ?? null,
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      title: input.title,
      category: input.category,
      cost: input.cost ?? 0,
      day: input.day,
      order: input.order ?? 0,
      startTime: input.startTime ?? null,
      notes: input.notes ?? null,
      imageUrl: input.imageUrl ?? null,
    });
    await recomputeItemReminder(this.db, row.id);
    return (await getItem(this.db, tripId, row.id)) ?? row;
  }

  async updateItem(
    userId: string,
    tripId: string,
    itemId: string,
    input: UpdateItemInput,
  ): Promise<TripItemRow> {
    this.requireEditor(await this.requireMember(tripId, userId));
    const item = await this.requireItem(tripId, itemId);

    await updateItemFields(this.db, itemId, {
      day: input.day ?? item.day,
      order: input.order ?? item.order,
      startTime: input.startTime === undefined ? item.start_time : input.startTime,
      notes: input.notes === undefined ? item.notes : input.notes,
      title: input.title ?? item.title,
      locationText: input.locationText === undefined ? item.location_text : input.locationText,
    });
    if (input.cost !== undefined) {
      await setItemCostRow(this.db, itemId, input.cost);
    }
    await recomputeItemReminder(this.db, itemId);
    return this.requireItem(tripId, itemId);
  }

  async setItemCost(
    userId: string,
    tripId: string,
    itemId: string,
    cost: number,
  ): Promise<TripItemRow> {
    this.requireEditor(await this.requireMember(tripId, userId));
    await this.requireItem(tripId, itemId);
    await setItemCostRow(this.db, itemId, cost);
    return this.requireItem(tripId, itemId);
  }

  async moveItem(
    userId: string,
    tripId: string,
    itemId: string,
    day: string,
    order: number,
  ): Promise<TripItemRow> {
    this.requireEditor(await this.requireMember(tripId, userId));
    await this.requireItem(tripId, itemId);
    await moveItemRow(this.db, itemId, day, order);
    await recomputeItemReminder(this.db, itemId);
    return this.requireItem(tripId, itemId);
  }

  async removeItem(userId: string, tripId: string, itemId: string): Promise<TripItemRow> {
    this.requireEditor(await this.requireMember(tripId, userId));
    const item = await this.requireItem(tripId, itemId);
    await removeItemRow(this.db, itemId);
    return item;
  }

  async setItemReminder(
    userId: string,
    tripId: string,
    itemId: string,
    enabled: boolean,
  ): Promise<TripItemRow> {
    this.requireEditor(await this.requireMember(tripId, userId));
    await this.requireItem(tripId, itemId);
    if (!enabled) {
      await this.db
        .prepare(
          'UPDATE trip_items SET reminder_enabled = 0, reminder_sent = 1, reminder_due_at = NULL WHERE id = ?',
        )
        .run(itemId);
    } else {
      await this.db.prepare('UPDATE trip_items SET reminder_enabled = 1 WHERE id = ?').run(itemId);
      await recomputeItemReminder(this.db, itemId);
    }
    return this.requireItem(tripId, itemId);
  }

  async getItemForActor(
    userId: string,
    itemId: string,
  ): Promise<{ tripId: string; item: TripItemRow }> {
    const item = await this.db
      .prepare('SELECT * FROM trip_items WHERE id = ?')
      .get<TripItemRow>(itemId);
    if (!item) throw tripError('ITEM_NOT_FOUND', 'Ítem no encontrado.');
    await this.assertMember(userId, item.trip_id);
    return { tripId: item.trip_id, item };
  }

  async previewInvitation(code: string): Promise<TripPreviewData> {
    const invitation = await findInvitationByCode(this.db, code);
    if (!invitation) {
      throw tripError('INVITE_CODE_NOT_FOUND', 'Código de invitación no encontrado.');
    }
    const trip = await getTrip(this.db, invitation.trip_id);
    if (!trip) {
      throw tripError('INVITE_CODE_NOT_FOUND', 'Código de invitación no encontrado.');
    }
    return {
      invitation,
      trip: {
        id: trip.id,
        name: trip.name,
        destination_name: trip.destination_name,
        owner_id: trip.owner_id,
      },
    };
  }

  async createInvitation(
    userId: string,
    tripId: string,
    input: CreateInvitationInput,
  ): Promise<InvitationResult> {
    await this.requireTrip(tripId);
    this.requireEditor(await this.requireMember(tripId, userId));
    const trip = await this.requireTrip(tripId);

    const invitation = await createInvitationRow(this.db, {
      tripId,
      email: input.email,
      role: input.role,
      createdBy: userId,
    });

    if (input.notify) {
      const emailJoinUrl = buildJoinUrl(tripId, invitation.code, { autoAccept: true });
      try {
        await brokerPublisher.publish({
          id: invitation.id,
          type: 'email.invite.v1',
          version: 1,
          occurredAt: new Date().toISOString(),
          source: 'triplanner-api',
          payload: {
            to: invitation.email,
            tripName: trip.name,
            ownerName: input.notify.inviterName,
            code: invitation.code,
            joinUrl: emailJoinUrl,
            role: input.role,
            language: input.notify.language,
            demo: true,
          },
        });
      } catch (error) {
        console.error('[invite] broker publish failed', {
          invitationId: invitation.id,
          reason: error instanceof Error ? error.message : 'unknown error',
        });
      }
    }

    return { invitation, emailQueued: Boolean(input.notify) };
  }

  async joinTrip(userId: string, tripId: string, input: JoinInput): Promise<JoinResult> {
    const invitation = await findInvitationByCode(this.db, input.code);
    if (!invitation || invitation.trip_id !== tripId) {
      throw tripError('INVITE_CODE_NOT_FOUND', 'Código de invitación no encontrado.');
    }

    if (invitation.status === 'accepted') {
      if (await isTripMember(this.db, tripId, input.userId)) {
        return {
          joined: false,
          data: await this.aggregate(tripId, userId),
          memberEmailQueued: false,
          reason: 'ALREADY_MEMBER',
        };
      }
      throw tripError('INVITE_ALREADY_USED', 'Esta invitación ya fue usada.');
    }
    if (invitation.status !== 'pending') {
      throw tripError('INVITE_ALREADY_USED', 'Esta invitación ya fue usada.');
    }
    if (invitation.email.toLowerCase() !== input.email.trim().toLowerCase()) {
      throw tripError('INVITE_EMAIL_MISMATCH', 'El email no coincide con la invitación.');
    }

    await addInvitedMember(
      this.db,
      tripId,
      input.userId,
      invitation.role,
      invitation.email,
    );
    await acceptInvitation(this.db, invitation.id);

    return {
      joined: true,
      data: await this.aggregate(tripId, userId),
      memberEmailQueued: false,
    };
  }

  // --------------------------------------------------------------- helpers

  private async requireTrip(tripId: string): Promise<TripRowFull> {
    const trip = await getTrip(this.db, tripId);
    if (!trip) throw tripError('TRIP_NOT_FOUND', 'Viaje no encontrado.');
    return trip;
  }

  private async requireMember(tripId: string, userId: string): Promise<TripRole> {
    const role = asRole(await getMemberRole(this.db, tripId, userId));
    if (!role) throw tripError('NOT_TRIP_MEMBER', 'No eres miembro de este viaje.');
    return role;
  }

  private requireEditor(role: TripRole): void {
    if (role === 'viewer') {
      throw tripError(
        'FORBIDDEN_EDIT',
        'Solo el propietario o un editor puede modificar el itinerario.',
      );
    }
  }

  private requireOwner(role: TripRole): void {
    if (role !== 'owner') {
      throw tripError('NOT_TRIP_OWNER', 'Solo el propietario puede realizar esta acción.');
    }
  }

  private async requireItem(tripId: string, itemId: string): Promise<TripItemRow> {
    const item = await getItem(this.db, tripId, itemId);
    if (!item) throw tripError('ITEM_NOT_FOUND', 'Ítem no encontrado.');
    return item;
  }

  private async aggregate(tripId: string, userId: string): Promise<TripData> {
    const trip = await this.requireTrip(tripId);
    const members = await listMembers(this.db, tripId);
    const items = await listItems(this.db, tripId);
    const stats = computeTripStats(items);
    const role = asRole(await getMemberRole(this.db, tripId, userId));
    return {
      trip,
      members,
      items,
      myRole: role ?? 'viewer',
      spent: stats.spent,
      spentByCategory: stats.spentByCategory,
    };
  }
}
