// Trips domain service. Authorization is enforced here, not in the API, so the
// service is safe even if it is called by another internal component.

import { randomBytes, randomUUID } from 'node:crypto';
import type { Db } from '../db.ts';
import { AppError } from '../errors.ts';
import {
  buildInviteEvent,
  buildMemberJoinedEvent,
  type InviteNotify,
  type MemberJoinedNotify,
} from './events.ts';
import {
  LocationsUnavailableError,
  type LocationSnapshot,
  type LocationsClient,
} from './locations.ts';
import * as store from './store.ts';
import type {
  InvitationPreview,
  InvitationResult,
  InvitationRole,
  ItemWriteResult,
  JoinResult,
  LocalInvitationResult,
  LocalInvitationRow,
  LocalJoinResult,
  Role,
  TripAggregate,
  TripContext,
  TripItemRow,
  TripMemberRow,
  TripSummaryRow,
  TripWriteResult,
} from './types.ts';
import {
  INVITE_ROLES,
  has,
  optionalBoolean,
  optionalEmail,
  optionalId,
  optionalLanguage,
  optionalObject,
  optionalString,
  optionalTime,
  pathId,
  pathInviteCode,
  requiredBoolean,
  requiredDate,
  requiredEmail,
  requiredId,
  requiredInteger,
  requiredInviteCode,
  requiredNumber,
  requiredRole,
  requiredString,
  requiredUrl,
  validateTimeZone,
} from './validation.ts';

export interface LeaveResult {
  left: true;
  trip: TripAggregate;
}

export interface TripsServiceOptions {
  brokerTopic: string;
}

interface ResolvedPlace {
  snapshot: LocationSnapshot | null;
  resolved: boolean;
}

const MAX_MONEY = 1_000_000_000;

export class TripsService {
  private readonly brokerTopic: string;

  constructor(
    private readonly db: Db,
    private readonly locations: LocationsClient,
    options: TripsServiceOptions = { brokerTopic: 'TripInvitation' },
  ) {
    this.brokerTopic = options.brokerTopic;
  }

  // ---------------------------------------------------------------- reads

  async listTrips(actorId: string): Promise<TripSummaryRow[]> {
    return store.listTripsForUser(this.db, actorId);
  }

  async getTrip(actorId: string, tripId: string): Promise<TripAggregate> {
    const id = pathId(tripId, 'trip_id');
    const trip = await this.requireTrip(id);
    await this.requireRole(id, actorId);
    return store.buildAggregate(this.db, trip, actorId);
  }

  async listMembers(actorId: string, tripId: string): Promise<TripMemberRow[]> {
    const id = pathId(tripId, 'trip_id');
    await this.requireTrip(id);
    await this.requireRole(id, actorId);
    return store.listMembers(this.db, id);
  }

  async listItems(actorId: string, tripId: string): Promise<TripItemRow[]> {
    const id = pathId(tripId, 'trip_id');
    await this.requireTrip(id);
    await this.requireRole(id, actorId);
    return store.listItems(this.db, id);
  }

  async getItemForActor(
    actorId: string,
    itemId: string,
  ): Promise<{ trip_id: string; item: TripItemRow }> {
    const id = pathId(itemId, 'item_id');
    const item = await store.getItemAnyTrip(this.db, id);
    if (!item) throw new AppError('ITEM_NOT_FOUND', 'Ítem no encontrado.');
    await this.requireRole(item.trip_id, actorId);
    return { trip_id: item.trip_id, item };
  }

  async getContext(actorId: string, tripId: string): Promise<TripContext> {
    const id = pathId(tripId, 'trip_id');
    const trip = await this.requireTrip(id);
    const myRole = await this.requireRole(id, actorId);
    const items = await store.listItems(this.db, id);
    const members = await store.listMembers(this.db, id);
    const stats = store.computeTripStats(items);

    const byDay = new Map<string, TripContext['days'][number]['items']>();
    for (const item of items) {
      const list = byDay.get(item.day) ?? [];
      list.push({
        id: item.id,
        title: item.title,
        category: item.category ?? 'activity',
        cost: Number(item.cost) || 0,
        day: item.day,
        start_time: item.start_time,
        location_id: item.location_id,
      });
      byDay.set(item.day, list);
    }

    return {
      trip: {
        id: trip.id,
        name: trip.name,
        destination_id: trip.destination_id,
        destination_name: trip.destination_name,
        destination_lat: trip.destination_lat,
        destination_lng: trip.destination_lng,
        start_date: trip.start_date,
        end_date: trip.end_date,
        total_budget: Number(trip.total_budget) || 0,
        spent: stats.spent,
      },
      days: [...byDay.entries()].map(([date, dayItems]) => ({ date, items: dayItems })),
      members: members.map((member) => ({ user_id: member.user_id, role: member.role })),
      my_role: myRole,
    };
  }

  // --------------------------------------------------------------- create

  async createTrip(actorId: string, body: Record<string, unknown>): Promise<TripWriteResult> {
    const id = optionalId(body, 'id') ?? randomUUID();
    const name = requiredString(body, 'name', 200);
    const startDate = requiredDate(body, 'start_date');
    const endDate = requiredDate(body, 'end_date');
    if (endDate < startDate) {
      throw new AppError('INVALID_ARGUMENT', 'end_date: debe ser mayor o igual a start_date');
    }

    const totalBudget = has(body, 'total_budget')
      ? requiredNumber(body, 'total_budget', 0, MAX_MONEY)
      : 0;
    const timezone = validateTimeZone(optionalString(body, 'timezone', 64) ?? 'UTC');
    const destinationId = optionalId(body, 'destination_id') ?? null;
    const destinationNameInput = optionalString(body, 'destination_name', 200) ?? null;
    const { snapshot, resolved } = await this.resolvePlace(destinationId);
    const destinationName = destinationNameInput ?? snapshot?.name ?? null;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const inviteCode = randomUUID().slice(0, 8).toUpperCase();
      try {
        const trip = await this.db.transaction(async (tx) => {
          const inserted = await store.insertTrip(tx, {
            id,
            name,
            destination_id: destinationId,
            destination_name: destinationName,
            destination_lat: snapshot?.lat ?? null,
            destination_lng: snapshot?.lng ?? null,
            start_date: startDate,
            end_date: endDate,
            total_budget: totalBudget,
            timezone,
            owner_id: actorId,
            invite_code: inviteCode,
          });

          if (!inserted) {
            const existing = await store.getTrip(tx, id);
            if (!existing) throw new Error('No se pudo leer el viaje existente');
            const role = await store.getMemberRole(tx, id, actorId);
            if (!role) {
              throw new AppError('INVALID_ARGUMENT', 'id: ya utilizado por otro viaje');
            }
            return existing;
          }

          await store.insertOwnerMembership(tx, id, actorId);
          const row = await store.getTrip(tx, id);
          if (!row) throw new Error('No se pudo crear el viaje');
          return row;
        });

        const aggregate = await store.buildAggregate(this.db, trip, actorId);
        return { ...aggregate, place_resolved: resolved };
      } catch (error) {
        if (store.isUniqueViolation(error) && attempt < 4) continue;
        throw error;
      }
    }

    throw new AppError('UNAVAILABLE', 'No se pudo generar un código de invitación único.');
  }

  // --------------------------------------------------------------- update

  async updateTrip(
    actorId: string,
    tripId: string,
    body: Record<string, unknown>,
  ): Promise<TripWriteResult> {
    const id = pathId(tripId, 'trip_id');
    const trip = await this.requireTrip(id);
    const role = await this.requireRole(id, actorId);

    const touchesCover =
      has(body, 'cover_preset') ||
      has(body, 'cover_photo_url') ||
      has(body, 'remove_cover_photo');
    if (touchesCover) this.requireOwner(role);
    else this.requireEditor(role);

    const columns: store.TripColumns = {};

    if (has(body, 'name')) columns.name = requiredString(body, 'name', 200);
    if (has(body, 'start_date')) columns.start_date = requiredDate(body, 'start_date');
    if (has(body, 'end_date')) columns.end_date = requiredDate(body, 'end_date');
    const startDate = columns.start_date ?? trip.start_date;
    const endDate = columns.end_date ?? trip.end_date;
    if (endDate < startDate) {
      throw new AppError('INVALID_ARGUMENT', 'end_date: debe ser mayor o igual a start_date');
    }

    if (has(body, 'total_budget')) {
      columns.total_budget = requiredNumber(body, 'total_budget', 0, MAX_MONEY);
    }
    if (has(body, 'timezone')) {
      columns.timezone = validateTimeZone(requiredString(body, 'timezone', 64));
    }

    let placeResolved = true;
    if (has(body, 'destination_id')) {
      const destinationId = optionalId(body, 'destination_id') ?? null;
      const nameInput = has(body, 'destination_name')
        ? optionalString(body, 'destination_name', 200)
        : undefined;

      if (destinationId === null) {
        columns.destination_id = null;
        columns.destination_name = nameInput ?? null;
        columns.destination_lat = null;
        columns.destination_lng = null;
      } else {
        const place = await this.resolvePlace(destinationId);
        placeResolved = place.resolved;
        columns.destination_id = destinationId;
        columns.destination_name = nameInput ?? place.snapshot?.name ?? trip.destination_name;
        columns.destination_lat = place.snapshot?.lat ?? null;
        columns.destination_lng = place.snapshot?.lng ?? null;
      }
    } else if (has(body, 'destination_name')) {
      columns.destination_name = optionalString(body, 'destination_name', 200) ?? null;
    }

    const removeCover = optionalBoolean(body, 'remove_cover_photo') === true;
    if (removeCover) {
      columns.cover_photo_url = null;
    } else {
      if (has(body, 'cover_preset')) {
        columns.cover_preset = optionalString(body, 'cover_preset', 64) ?? null;
      }
      if (has(body, 'cover_photo_url')) {
        columns.cover_photo_url = optionalString(body, 'cover_photo_url', 2048) ?? null;
      }
    }
    // A preset replaces the uploaded photo, matching the API cover rules.
    if (typeof columns.cover_preset === 'string') {
      columns.cover_photo_url = null;
    }

    if (Object.keys(columns).length === 0) {
      throw new AppError('INVALID_ARGUMENT', 'No hay campos para actualizar.');
    }

    await this.db.transaction((tx) => store.updateTripColumns(tx, id, columns));
    const updated = await this.requireTrip(id);
    const aggregate = await store.buildAggregate(this.db, updated, actorId);
    return { ...aggregate, place_resolved: placeResolved };
  }

  async deleteTrip(actorId: string, tripId: string): Promise<{ deleted: true }> {
    const id = pathId(tripId, 'trip_id');
    await this.requireTrip(id);
    const role = await this.requireRole(id, actorId);
    this.requireOwner(role);
    await this.db.transaction((tx) => store.deleteTripRow(tx, id));
    return { deleted: true };
  }

  // -------------------------------------------------------------- members

  async addMember(
    actorId: string,
    tripId: string,
    body: Record<string, unknown>,
  ): Promise<TripMemberRow> {
    const id = pathId(tripId, 'trip_id');
    await this.requireTrip(id);
    this.requireEditor(await this.requireRole(id, actorId));

    const userId = requiredId(body, 'user_id');
    const role = requiredRole(body, 'role', INVITE_ROLES);
    const invitedEmail = optionalEmail(body, 'invited_email') ?? null;

    return this.db.transaction((tx) => store.upsertMember(tx, id, userId, role, invitedEmail));
  }

  async updateMemberRole(
    actorId: string,
    tripId: string,
    userId: string,
    body: Record<string, unknown>,
  ): Promise<TripMemberRow> {
    const id = pathId(tripId, 'trip_id');
    const targetId = pathId(userId, 'user_id');
    const trip = await this.requireTrip(id);
    this.requireOwner(await this.requireRole(id, actorId));

    const role = requiredRole(body, 'role', INVITE_ROLES);
    if (targetId === trip.owner_id) {
      throw new AppError('OWNER_ROLE_PROTECTED', 'El rol del propietario no se puede cambiar.');
    }

    const updated = await this.db.transaction((tx) =>
      store.updateMemberRoleRow(tx, id, targetId, role),
    );
    if (!updated) throw new AppError('MEMBER_NOT_FOUND', 'Miembro no encontrado.');
    return updated;
  }

  async removeMember(
    actorId: string,
    tripId: string,
    userId: string,
  ): Promise<{ removed: true }> {
    const id = pathId(tripId, 'trip_id');
    const targetId = pathId(userId, 'user_id');
    const trip = await this.requireTrip(id);
    this.requireOwner(await this.requireRole(id, actorId));

    if (targetId === trip.owner_id) {
      throw new AppError(
        'OWNER_CANNOT_BE_REMOVED',
        'El propietario no se puede eliminar: transfiere la propiedad primero.',
      );
    }

    const removed = await this.db.transaction((tx) => store.removeMemberRow(tx, id, targetId));
    if (!removed) throw new AppError('MEMBER_NOT_FOUND', 'Miembro no encontrado.');
    return { removed: true };
  }

  async leaveTrip(
    actorId: string,
    tripId: string,
    body: Record<string, unknown>,
  ): Promise<LeaveResult> {
    const id = pathId(tripId, 'trip_id');
    await this.requireTrip(id);
    const role = await this.requireRole(id, actorId);
    const newOwnerId = has(body, 'new_owner_id')
      ? (optionalId(body, 'new_owner_id') ?? null)
      : null;

    if (role === 'owner') {
      if (!newOwnerId) {
        throw new AppError('OWNER_MUST_TRANSFER', 'Debes transferir la propiedad antes de salir.');
      }
      if (newOwnerId === actorId) {
        throw new AppError('INVALID_TRANSFER_TARGET', 'El nuevo propietario debe ser otro miembro.');
      }
      const targetRole = await store.getMemberRole(this.db, id, newOwnerId);
      if (!targetRole) {
        throw new AppError('INVALID_TRANSFER_TARGET', 'El nuevo propietario debe ser otro miembro.');
      }
      await this.db.transaction((tx) =>
        store.transferOwnershipAndLeave(tx, id, actorId, newOwnerId),
      );
    } else {
      await this.db.transaction((tx) => store.removeMemberRow(tx, id, actorId));
    }

    const updated = await this.requireTrip(id);
    return { left: true, trip: await store.buildAggregate(this.db, updated, actorId) };
  }

  // --------------------------------------------------------- invitations

  async createInvitation(
    actorId: string,
    tripId: string,
    body: Record<string, unknown>,
  ): Promise<InvitationResult> {
    const id = pathId(tripId, 'trip_id');
    const trip = await this.requireTrip(id);
    this.requireEditor(await this.requireRole(id, actorId));

    const email = requiredEmail(body, 'email');
    const role = requiredRole(body, 'role', INVITE_ROLES) as InvitationRole;
    const notify = this.parseInviteNotify(body);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const invitationId = randomUUID();
      const code = randomBytes(9).toString('base64url');

      try {
        const invitation = await this.db.transaction(async (tx) => {
          const row = await store.insertInvitation(tx, {
            id: invitationId,
            trip_id: id,
            email,
            code,
            role,
            created_by: actorId,
          });

          if (notify) {
            await store.enqueueOutbox(tx, {
              id: row.id,
              topic: this.brokerTopic,
              event_key: row.id,
              payload: buildInviteEvent(trip, row, notify),
            });
          }

          return row;
        });

        return {
          invitation,
          email: notify ? { queued: true } : { queued: false, reason: 'NO_NOTIFY' },
        };
      } catch (error) {
        if (store.isUniqueViolation(error) && attempt < 4) continue;
        throw error;
      }
    }

    throw new AppError('UNAVAILABLE', 'No se pudo generar un código de invitación único.');
  }

  async previewInvitation(code: string): Promise<InvitationPreview> {
    const invitationCode = pathInviteCode(code);
    const invitation = await store.findInvitationByCode(this.db, invitationCode);
    if (!invitation) {
      throw new AppError('INVITE_CODE_NOT_FOUND', 'Código de invitación no encontrado.');
    }

    const trip = await store.getTrip(this.db, invitation.trip_id);
    if (!trip) {
      throw new AppError('INVITE_CODE_NOT_FOUND', 'Código de invitación no encontrado.');
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

  async joinTrip(
    actorId: string,
    tripId: string,
    body: Record<string, unknown>,
  ): Promise<JoinResult> {
    const id = pathId(tripId, 'trip_id');
    const trip = await this.requireTrip(id);

    const userId = requiredId(body, 'user_id');
    const email = requiredEmail(body, 'email');
    const code = requiredInviteCode(body, 'code');
    const notify = this.parseJoinNotify(body);

    const outcome = await this.db.transaction<{
      joined: boolean;
      emailQueued: boolean;
      reason?: 'ALREADY_MEMBER';
    }>(async (tx) => {
      const invitation = await store.findInvitationForJoin(tx, id, code);
      if (!invitation) {
        throw new AppError('INVITE_CODE_NOT_FOUND', 'Código de invitación no encontrado.');
      }

      if (invitation.status === 'accepted') {
        const existingRole = await store.getMemberRole(tx, id, userId);
        if (existingRole) {
          return { joined: false, emailQueued: false, reason: 'ALREADY_MEMBER' };
        }
        throw new AppError('INVITE_ALREADY_USED', 'La invitación ya fue utilizada.');
      }

      if (invitation.status !== 'pending') {
        throw new AppError('INVITE_ALREADY_USED', 'La invitación ya fue utilizada.');
      }

      if (invitation.email.toLowerCase() !== email.toLowerCase()) {
        throw new AppError('INVITE_EMAIL_MISMATCH', 'El email no coincide con la invitación.');
      }

      await store.upsertMember(tx, id, userId, invitation.role, email);
      await store.acceptInvitation(tx, invitation.id);

      if (notify) {
        const outboxId = randomUUID();
        await store.enqueueOutbox(tx, {
          id: outboxId,
          topic: this.brokerTopic,
          event_key: outboxId,
          payload: buildMemberJoinedEvent({
            id: outboxId,
            tripName: trip.name,
            notify,
          }),
        });
      }

      return { joined: true, emailQueued: Boolean(notify) };
    });

    const updated = await this.requireTrip(id);
    const aggregate = await store.buildAggregate(this.db, updated, actorId);

    return {
      joined: outcome.joined,
      trip: aggregate,
      member_email: outcome.emailQueued
        ? { queued: true }
        : { queued: false, reason: outcome.reason ?? 'NO_NOTIFY' },
    };
  }

  /**
   * Creates a pending invitation addressed to an existing user id. No code, no
   * email and no outbox row: the API stores the notification and publishes it.
   */
  async createLocalInvitation(
    actorId: string,
    tripId: string,
    body: Record<string, unknown>,
  ): Promise<LocalInvitationResult> {
    const id = pathId(tripId, 'trip_id');
    await this.requireTrip(id);
    this.requireEditor(await this.requireRole(id, actorId));

    const inviteeUserId = requiredId(body, 'invitee_user_id');
    const role = requiredRole(body, 'role', INVITE_ROLES) as InvitationRole;
    if (inviteeUserId === actorId) {
      throw new AppError('INVALID_ARGUMENT', 'No puedes invitarte a ti mismo.');
    }
    if (await store.getMemberRole(this.db, id, inviteeUserId)) {
      throw new AppError('ALREADY_MEMBER', 'El usuario ya es miembro de este viaje.');
    }

    return this.db.transaction(async (tx) => {
      // Re-check inside the transaction to close the join race.
      if (await store.getMemberRole(tx, id, inviteeUserId)) {
        throw new AppError('ALREADY_MEMBER', 'El usuario ya es miembro de este viaje.');
      }
      return store.insertLocalInvitation(tx, {
        id: randomUUID(),
        trip_id: id,
        invitee_user_id: inviteeUserId,
        role,
        created_by: actorId,
      });
    });
  }

  /** Membership + accepted invitation in one transaction; no email outbox. */
  async joinLocal(
    actorId: string,
    tripId: string,
    body: Record<string, unknown>,
  ): Promise<LocalJoinResult> {
    const id = pathId(tripId, 'trip_id');
    await this.requireTrip(id);

    const userId = requiredId(body, 'user_id');
    if (userId !== actorId) {
      throw new AppError('FORBIDDEN', 'Solo el invitado puede aceptar esta invitación.');
    }
    const invitationId = requiredId(body, 'invitation_id');

    const outcome = await this.db.transaction<{ joined: boolean }>(async (tx) => {
      const invitation = await store.findLocalInvitationForUpdate(tx, id, invitationId);
      if (!invitation) {
        throw new AppError('INVITE_NOT_FOUND', 'Invitación no encontrada.');
      }
      if (invitation.invitee_user_id !== userId) {
        throw new AppError('INVITE_INVITEE_MISMATCH', 'La invitación es para otro usuario.');
      }

      if (invitation.status === 'accepted') {
        if (await store.getMemberRole(tx, id, userId)) return { joined: false };
        throw new AppError('INVITE_ALREADY_USED', 'La invitación ya fue utilizada.');
      }
      if (invitation.status !== 'pending') {
        throw new AppError('INVITE_ALREADY_USED', 'La invitación ya fue utilizada.');
      }

      await store.upsertMember(tx, id, userId, invitation.role, null);
      await store.acceptInvitation(tx, invitation.id);
      return { joined: true };
    });

    const updated = await this.requireTrip(id);
    return {
      joined: outcome.joined,
      trip: await store.buildAggregate(this.db, updated, actorId),
    };
  }

  /** Declines a pending local invitation; repeat declines are idempotent. */
  async declineLocalInvitation(
    actorId: string,
    tripId: string,
    body: Record<string, unknown>,
  ): Promise<LocalInvitationRow> {
    const id = pathId(tripId, 'trip_id');
    await this.requireTrip(id);

    const userId = requiredId(body, 'user_id');
    if (userId !== actorId) {
      throw new AppError('FORBIDDEN', 'Solo el invitado puede rechazar esta invitación.');
    }
    const invitationId = requiredId(body, 'invitation_id');

    return this.db.transaction(async (tx) => {
      const invitation = await store.findLocalInvitationForUpdate(tx, id, invitationId);
      if (!invitation) {
        throw new AppError('INVITE_NOT_FOUND', 'Invitación no encontrada.');
      }
      if (invitation.invitee_user_id !== userId) {
        throw new AppError('INVITE_INVITEE_MISMATCH', 'La invitación es para otro usuario.');
      }
      if (invitation.status === 'declined') return invitation;
      if (invitation.status !== 'pending') {
        throw new AppError('INVITE_ALREADY_USED', 'La invitación ya fue utilizada.');
      }

      const declined = await store.declineInvitation(tx, invitation.id);
      if (!declined) {
        throw new AppError('INVITE_ALREADY_USED', 'La invitación ya fue utilizada.');
      }
      return declined;
    });
  }

  /**
   * Cancels a pending local invite as the inviter/editor. Used by the API to
   * compensate when the notification cannot be stored.
   */
  async revokeLocalInvitation(
    actorId: string,
    tripId: string,
    invitationId: string,
  ): Promise<LocalInvitationRow> {
    const id = pathId(tripId, 'trip_id');
    await this.requireTrip(id);
    this.requireEditor(await this.requireRole(id, actorId));
    const target = pathId(invitationId, 'invitation_id');

    return this.db.transaction(async (tx) => {
      const invitation = await store.findLocalInvitationForUpdate(tx, id, target);
      if (!invitation) {
        throw new AppError('INVITE_NOT_FOUND', 'Invitación no encontrada.');
      }
      if (invitation.status === 'revoked') return invitation;
      if (invitation.status !== 'pending') {
        throw new AppError('INVITE_ALREADY_USED', 'La invitación ya fue utilizada.');
      }

      const revoked = await store.revokeInvitation(tx, invitation.id);
      if (!revoked) {
        throw new AppError('INVITE_ALREADY_USED', 'La invitación ya fue utilizada.');
      }
      return revoked;
    });
  }

  // ---------------------------------------------------------------- items

  async addItem(
    actorId: string,
    tripId: string,
    body: Record<string, unknown>,
  ): Promise<ItemWriteResult> {
    const id = pathId(tripId, 'trip_id');
    await this.requireTrip(id);
    this.requireEditor(await this.requireRole(id, actorId));

    const itemId = optionalId(body, 'id') ?? randomUUID();
    const day = requiredDate(body, 'day');
    // `order: -1` is the client's append marker; resolve it inside the
    // transaction so new items land at the end of the day.
    const requestedOrder = has(body, 'order')
      ? requiredInteger(body, 'order', -1, 1_000_000)
      : 0;
    const title = requiredString(body, 'title', 300);
    const category = optionalString(body, 'category', 64) ?? 'activity';
    const cost = has(body, 'cost') ? requiredNumber(body, 'cost', 0, MAX_MONEY) : 0;
    const startTime = optionalTime(body, 'start_time') ?? null;
    const notes = optionalString(body, 'notes', 5_000) ?? null;
    const imageUrl = optionalString(body, 'image_url', 2_048) ?? null;
    const locationId = optionalId(body, 'location_id') ?? null;
    const locationText = optionalString(body, 'location_text', 200) ?? null;
    const place = await this.resolvePlace(locationId);

    const item = await this.db.transaction(async (tx) => {
      const order =
        requestedOrder < 0 ? await store.nextItemOrder(tx, id, day) : requestedOrder;
      const row = await store.insertItem(tx, {
        id: itemId,
        trip_id: id,
        location_id: locationId,
        location_text: locationText,
        location_name: place.snapshot?.name ?? null,
        location_address: place.snapshot?.address ?? null,
        lat: place.snapshot?.lat ?? null,
        lng: place.snapshot?.lng ?? null,
        title,
        category,
        cost,
        day,
        order,
        start_time: startTime,
        notes,
        image_url: imageUrl,
        created_by: actorId,
      });
      await store.recomputeReminder(tx, itemId);
      return (await store.getItem(tx, id, itemId)) ?? row;
    });

    return { ...item, place_resolved: place.resolved };
  }

  async updateItem(
    actorId: string,
    tripId: string,
    itemId: string,
    body: Record<string, unknown>,
  ): Promise<ItemWriteResult> {
    const id = pathId(tripId, 'trip_id');
    const targetItemId = pathId(itemId, 'item_id');
    await this.requireTrip(id);
    this.requireEditor(await this.requireRole(id, actorId));
    await this.requireItem(id, targetItemId);

    const columns: store.ItemColumns = {};
    let placeResolved = true;

    if (has(body, 'day')) columns.day = requiredDate(body, 'day');
    if (has(body, 'order')) columns.order = requiredInteger(body, 'order', 0, 1_000_000);
    if (has(body, 'title')) columns.title = requiredString(body, 'title', 300);
    if (has(body, 'category')) columns.category = optionalString(body, 'category', 64) ?? null;
    if (has(body, 'cost')) columns.cost = requiredNumber(body, 'cost', 0, MAX_MONEY);
    if (has(body, 'start_time')) columns.start_time = optionalTime(body, 'start_time') ?? null;
    if (has(body, 'notes')) columns.notes = optionalString(body, 'notes', 5_000) ?? null;
    if (has(body, 'image_url')) columns.image_url = optionalString(body, 'image_url', 2_048) ?? null;
    if (has(body, 'location_text')) {
      columns.location_text = optionalString(body, 'location_text', 200) ?? null;
    }

    if (has(body, 'location_id')) {
      const locationId = optionalId(body, 'location_id') ?? null;
      columns.location_id = locationId;
      if (locationId === null) {
        columns.location_name = null;
        columns.location_address = null;
        columns.lat = null;
        columns.lng = null;
      } else {
        const place = await this.resolvePlace(locationId);
        placeResolved = place.resolved;
        columns.location_name = place.snapshot?.name ?? null;
        columns.location_address = place.snapshot?.address ?? null;
        columns.lat = place.snapshot?.lat ?? null;
        columns.lng = place.snapshot?.lng ?? null;
      }
    }

    if (Object.keys(columns).length === 0) {
      throw new AppError('INVALID_ARGUMENT', 'No hay campos para actualizar.');
    }

    await this.db.transaction(async (tx) => {
      await store.updateItemColumns(tx, id, targetItemId, columns);
      await store.recomputeReminder(tx, targetItemId);
    });

    const item = await this.requireItem(id, targetItemId);
    return { ...item, place_resolved: placeResolved };
  }

  async deleteItem(
    actorId: string,
    tripId: string,
    itemId: string,
  ): Promise<TripItemRow> {
    const id = pathId(tripId, 'trip_id');
    const targetItemId = pathId(itemId, 'item_id');
    await this.requireTrip(id);
    this.requireEditor(await this.requireRole(id, actorId));
    await this.requireItem(id, targetItemId);

    const deleted = await this.db.transaction((tx) =>
      store.deleteItemRow(tx, id, targetItemId),
    );
    if (!deleted) throw new AppError('ITEM_NOT_FOUND', 'Ítem no encontrado.');
    return deleted;
  }

  async moveItem(
    actorId: string,
    tripId: string,
    itemId: string,
    body: Record<string, unknown>,
  ): Promise<TripItemRow> {
    const id = pathId(tripId, 'trip_id');
    const targetItemId = pathId(itemId, 'item_id');
    await this.requireTrip(id);
    this.requireEditor(await this.requireRole(id, actorId));
    await this.requireItem(id, targetItemId);

    const day = requiredDate(body, 'day');
    const order = requiredInteger(body, 'order', 0, 1_000_000);

    await this.db.transaction(async (tx) => {
      await store.updateItemColumns(tx, id, targetItemId, { day, order });
      await store.recomputeReminder(tx, targetItemId);
    });
    return this.requireItem(id, targetItemId);
  }

  async setReminder(
    actorId: string,
    tripId: string,
    itemId: string,
    body: Record<string, unknown>,
  ): Promise<TripItemRow> {
    const id = pathId(tripId, 'trip_id');
    const targetItemId = pathId(itemId, 'item_id');
    await this.requireTrip(id);
    this.requireEditor(await this.requireRole(id, actorId));
    await this.requireItem(id, targetItemId);

    const enabled = requiredBoolean(body, 'enabled');

    await this.db.transaction(async (tx) => {
      await store.updateItemColumns(tx, id, targetItemId, {
        reminder_enabled: enabled ? 1 : 0,
      });
      await store.recomputeReminder(tx, targetItemId);
    });
    return this.requireItem(id, targetItemId);
  }

  // --------------------------------------------------------------- helpers

  private async requireTrip(tripId: string) {
    const trip = await store.getTrip(this.db, tripId);
    if (!trip) throw new AppError('TRIP_NOT_FOUND', 'Viaje no encontrado.');
    return trip;
  }

  private async requireRole(tripId: string, actorId: string): Promise<Role> {
    const role = await store.getMemberRole(this.db, tripId, actorId);
    if (!role) throw new AppError('NOT_TRIP_MEMBER', 'No eres miembro de este viaje.');
    return role;
  }

  private async requireItem(tripId: string, itemId: string): Promise<TripItemRow> {
    const item = await store.getItem(this.db, tripId, itemId);
    if (!item) throw new AppError('ITEM_NOT_FOUND', 'Ítem no encontrado.');
    return item;
  }

  private requireEditor(role: Role): void {
    if (role === 'viewer') {
      throw new AppError(
        'FORBIDDEN_EDIT',
        'Solo el propietario o un editor puede modificar el itinerario.',
      );
    }
  }

  private requireOwner(role: Role): void {
    if (role !== 'owner') {
      throw new AppError('NOT_TRIP_OWNER', 'Solo el propietario puede realizar esta acción.');
    }
  }

  private parseInviteNotify(body: Record<string, unknown>): InviteNotify | null {
    const notify = optionalObject(body, 'notify');
    if (!notify) return null;
    return {
      inviter_name: requiredString(notify, 'inviter_name', 200),
      language: optionalLanguage(notify, 'language') ?? 'es',
      app_url: requiredUrl(notify, 'app_url', 2_048),
      demo: optionalBoolean(notify, 'demo') ?? true,
    };
  }

  private parseJoinNotify(body: Record<string, unknown>): MemberJoinedNotify | null {
    const notify = optionalObject(body, 'notify');
    if (!notify) return null;
    return {
      owner_email: requiredEmail(notify, 'owner_email'),
      owner_name: requiredString(notify, 'owner_name', 200),
      member_name: requiredString(notify, 'member_name', 200),
      language: optionalLanguage(notify, 'language') ?? 'es',
    };
  }

  private async resolvePlace(id: string | null): Promise<ResolvedPlace> {
    if (!id) return { snapshot: null, resolved: true };
    try {
      const snapshot = await this.locations.getById(id);
      return { snapshot, resolved: snapshot !== null };
    } catch (error) {
      if (error instanceof LocationsUnavailableError) {
        return { snapshot: null, resolved: false };
      }
      throw error;
    }
  }
}
