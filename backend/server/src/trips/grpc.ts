// gRPC adapter for the trips service. The GraphQL resolvers keep using the
// TripsStore port; this adapter is selected by TRIPS_TRANSPORT=grpc.

import * as grpc from '@grpc/grpc-js';
import * as loader from '@grpc/proto-loader';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GraphQLError } from 'graphql';
import type { InvitationRow } from '../schema-types.ts';
import { tripError } from './errors.ts';
import type {
  AddItemInput,
  CreateInvitationInput,
  CreateTripInput,
  DueReminderData,
  InvitationResult,
  InviteRole,
  ItemReminder,
  ItemReminderInput,
  JoinInput,
  JoinResult,
  TripData,
  TripItemRow,
  TripMemberRow,
  TripPreviewData,
  TripRole,
  TripRowFull,
  TripSummaryData,
  TripsStore,
  UpdateItemInput,
  UpdateTripInput,
} from './types.ts';

const PROTO_ROOT =
  process.env.PROTO_ROOT ??
  fileURLToPath(new URL('../../../../proto', import.meta.url));
const PROTO_PATH = path.join(PROTO_ROOT, 'triplanner', 'trips', 'v1', 'trips.proto');

export interface GrpcTripsOptions {
  baseUrl: string;
  internalToken: string;
  timeoutMs: number;
}

function asRole(value: string | null | undefined): TripRole | null {
  return value === 'owner' || value === 'editor' || value === 'viewer' ? value : null;
}

function nullable<T>(value: T | null | undefined): T | null {
  return value === undefined ? null : value;
}

function codeOf(error: unknown): string | undefined {
  return error instanceof GraphQLError
    ? (error.extensions.code as string | undefined)
    : undefined;
}

function errorCode(error: any): string {
  const values = error?.metadata?.get?.('x-error-code');
  if (Array.isArray(values) && values.length > 0) return String(values[0]);
  switch (error?.code) {
    case grpc.status.NOT_FOUND:
      return 'TRIP_NOT_FOUND';
    case grpc.status.PERMISSION_DENIED:
      return 'FORBIDDEN';
    case grpc.status.UNAUTHENTICATED:
      return 'UNAUTHORIZED';
    case grpc.status.INVALID_ARGUMENT:
      return 'INVALID_ARGUMENT';
    case grpc.status.ALREADY_EXISTS:
      return 'ALREADY_MEMBER';
    case grpc.status.FAILED_PRECONDITION:
      return 'INVITE_ALREADY_USED';
    case grpc.status.UNAVAILABLE:
    case grpc.status.DEADLINE_EXCEEDED:
    default:
      return 'TRIPS_UNAVAILABLE';
  }
}

function toError(error: any): GraphQLError {
  return tripError(
    errorCode(error),
    String(error?.details ?? error?.message ?? 'trips error'),
  );
}

function toTrip(raw: any): TripRowFull {
  return {
    id: String(raw.id ?? ''),
    name: String(raw.name ?? ''),
    destination_id: nullable(raw.destination_id),
    destination_name: nullable(raw.destination_name),
    destination_lat: nullable(raw.destination_lat),
    destination_lng: nullable(raw.destination_lng),
    start_date: String(raw.start_date ?? ''),
    end_date: String(raw.end_date ?? ''),
    total_budget: Number(raw.total_budget ?? 0),
    cover_preset: nullable(raw.cover_preset),
    cover_photo_url: nullable(raw.cover_photo_url),
    timezone: String(raw.timezone ?? 'UTC'),
    owner_id: String(raw.owner_id ?? ''),
    invite_code: String(raw.invite_code ?? ''),
    created_at: String(raw.created_at ?? ''),
    updated_at: String(raw.updated_at ?? ''),
  };
}

function toMember(raw: any): TripMemberRow {
  return {
    user_id: String(raw.user_id ?? ''),
    role: String(raw.role ?? 'viewer'),
    joined_at: nullable(raw.joined_at),
    invited_email: nullable(raw.invited_email),
  };
}

function toReminder(raw: any): ItemReminder {
  return {
    enabled: Boolean(raw.enabled),
    lead_minutes: Number(raw.lead_minutes ?? 0),
    recipient_ids: raw.recipient_ids ?? [],
    can_edit: Boolean(raw.can_edit),
  };
}

function toItem(raw: any): TripItemRow {
  return {
    id: String(raw.id ?? ''),
    trip_id: String(raw.trip_id ?? ''),
    day: String(raw.day ?? ''),
    order: Number(raw.order ?? 0),
    location_id: nullable(raw.location_id),
    location_text: nullable(raw.location_text),
    location_name: nullable(raw.location_name),
    location_address: nullable(raw.location_address),
    lat: nullable(raw.lat),
    lng: nullable(raw.lng),
    title: String(raw.title ?? ''),
    category: nullable(raw.category),
    cost: Number(raw.cost ?? 0),
    start_time: nullable(raw.start_time),
    notes: nullable(raw.notes),
    image_url: nullable(raw.image_url),
    created_by: nullable(raw.created_by),
    created_at: String(raw.created_at ?? ''),
    ...(raw.reminder ? { reminder: toReminder(raw.reminder) } : {}),
  };
}

function toTripData(raw: any): TripData {
  const aggregate = raw ?? {};
  return {
    trip: toTrip(aggregate.trip ?? {}),
    members: (aggregate.members ?? []).map(toMember),
    items: (aggregate.items ?? []).map(toItem),
    myRole: asRole(aggregate.my_role) ?? 'viewer',
    spent: Number(aggregate.spent ?? 0),
    spentByCategory: (aggregate.spent_by_category ?? []).map((row: any) => ({
      category: String(row.category ?? ''),
      amount: Number(row.amount ?? 0),
    })),
  };
}

function toInvitation(raw: any): InvitationRow {
  return {
    id: String(raw.id ?? ''),
    trip_id: String(raw.trip_id ?? ''),
    email: nullable(raw.email),
    code: nullable(raw.code),
    role: raw.role as InvitationRow['role'],
    status: raw.status as InvitationRow['status'],
    created_by: String(raw.created_by ?? ''),
    created_at: String(raw.created_at ?? ''),
    accepted_at: nullable(raw.accepted_at),
    channel: raw.channel === 'local' ? 'local' : 'email',
    invitee_user_id: nullable(raw.invitee_user_id),
  };
}

function toNotificationReason(value: string | undefined): 'ALREADY_MEMBER' | undefined {
  return value === 'ALREADY_MEMBER' ? 'ALREADY_MEMBER' : undefined;
}

export class GrpcTripsStore implements TripsStore {
  private readonly client: any;
  private readonly token: string;
  private readonly timeoutMs: number;

  constructor(options: GrpcTripsOptions) {
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
    const descriptor = proto.triplanner.trips.v1.TripsService;
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

  async listMyTrips(userId: string): Promise<TripSummaryData[]> {
    const response = await this.invoke<any>('ListTrips', {}, userId);
    return (response.items ?? []).map((row: any) => ({
      id: String(row.id ?? ''),
      name: String(row.name ?? ''),
      destination_name: nullable(row.destination_name),
      start_date: String(row.start_date ?? ''),
      end_date: String(row.end_date ?? ''),
      role: asRole(row.role) ?? 'viewer',
      joined_at: String(row.joined_at ?? ''),
    }));
  }

  async getTrip(userId: string, tripId: string): Promise<TripData> {
    return toTripData((await this.invoke<any>('GetTrip', { trip_id: tripId }, userId)).trip);
  }

  async createTrip(userId: string, input: CreateTripInput): Promise<TripData> {
    const response = await this.invoke<any>(
      'CreateTrip',
      {
        name: input.name,
        ...(input.destinationId !== undefined ? { destination_id: input.destinationId } : {}),
        ...(input.destinationName !== undefined
          ? { destination_name: input.destinationName }
          : {}),
        start_date: input.startDate,
        end_date: input.endDate,
        total_budget: input.totalBudget ?? 0,
        timezone: input.timezone ?? 'UTC',
      },
      userId,
    );
    return toTripData(response.trip);
  }

  async updateTrip(
    userId: string,
    tripId: string,
    input: UpdateTripInput,
  ): Promise<TripData> {
    const request: Record<string, unknown> = { trip_id: tripId };
    if (input.name !== undefined) request.name = input.name;
    if (input.startDate !== undefined) request.start_date = input.startDate;
    if (input.endDate !== undefined) request.end_date = input.endDate;
    if (input.destinationId === null) request.clear_destination_id = true;
    else if (input.destinationId !== undefined) request.destination_id = input.destinationId;
    if (input.destinationName === null) request.clear_destination_name = true;
    else if (input.destinationName !== undefined) {
      request.destination_name = input.destinationName;
    }
    if (input.totalBudget !== undefined) request.total_budget = input.totalBudget;
    if (input.coverPreset === null) request.clear_cover_preset = true;
    else if (input.coverPreset !== undefined) request.cover_preset = input.coverPreset;
    if (input.coverPhotoUrl === null) request.remove_cover_photo = true;
    else if (input.coverPhotoUrl !== undefined) request.cover_photo_url = input.coverPhotoUrl;
    if (input.removePhoto) request.remove_cover_photo = true;

    if (Object.keys(request).length === 1) return this.getTrip(userId, tripId);
    const response = await this.invoke<any>('UpdateTrip', request, userId);
    return toTripData(response.trip);
  }

  async deleteTrip(userId: string, tripId: string): Promise<void> {
    await this.invoke('DeleteTrip', { trip_id: tripId }, userId);
  }

  async inviteMember(
    userId: string,
    tripId: string,
    targetUserId: string,
    role: InviteRole,
  ): Promise<TripData> {
    await this.invoke(
      'AddMember',
      { trip_id: tripId, user_id: targetUserId, role },
      userId,
    );
    return this.getTrip(userId, tripId);
  }

  async updateMemberRole(
    userId: string,
    tripId: string,
    targetUserId: string,
    role: InviteRole,
  ): Promise<TripData> {
    await this.invoke(
      'UpdateMemberRole',
      { trip_id: tripId, user_id: targetUserId, role },
      userId,
    );
    return this.getTrip(userId, tripId);
  }

  async removeMember(
    userId: string,
    tripId: string,
    targetUserId: string,
  ): Promise<TripData> {
    await this.invoke('RemoveMember', { trip_id: tripId, user_id: targetUserId }, userId);
    return this.getTrip(userId, tripId);
  }

  async leaveTrip(
    userId: string,
    tripId: string,
    newOwnerId?: string | null,
  ): Promise<TripData> {
    const response = await this.invoke<any>(
      'LeaveTrip',
      {
        trip_id: tripId,
        ...(newOwnerId ? { new_owner_id: newOwnerId } : {}),
      },
      userId,
    );
    return toTripData(response.trip);
  }

  async getMemberRole(userId: string, tripId: string): Promise<TripRole | null> {
    try {
      const response = await this.invoke<any>('ListMembers', { trip_id: tripId }, userId);
      return asRole(
        (response.items ?? []).find((member: any) => member.user_id === userId)?.role,
      );
    } catch (error) {
      const code = codeOf(error);
      if (code === 'NOT_TRIP_MEMBER' || code === 'TRIP_NOT_FOUND') return null;
      throw error;
    }
  }

  async isMember(userId: string, tripId: string): Promise<boolean> {
    return (await this.getMemberRole(userId, tripId)) !== null;
  }

  async assertMember(userId: string, tripId: string): Promise<void> {
    await this.getTrip(userId, tripId);
  }

  async listMemberIds(userId: string, tripId: string): Promise<string[]> {
    const response = await this.invoke<any>('ListMembers', { trip_id: tripId }, userId);
    return (response.items ?? []).map((member: any) => String(member.user_id));
  }

  async addItem(userId: string, tripId: string, input: AddItemInput): Promise<TripItemRow> {
    const response = await this.invoke<any>(
      'AddItem',
      {
        trip_id: tripId,
        ...(input.locationId !== undefined ? { location_id: input.locationId } : {}),
        ...(input.locationText !== undefined ? { location_text: input.locationText } : {}),
        title: input.title,
        category: input.category,
        cost: input.cost ?? 0,
        day: input.day,
        order: input.order ?? 0,
        ...(input.startTime !== undefined ? { start_time: input.startTime } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.imageUrl !== undefined ? { image_url: input.imageUrl } : {}),
      },
      userId,
    );
    return toItem(response.item);
  }

  async updateItem(
    userId: string,
    tripId: string,
    itemId: string,
    input: UpdateItemInput,
  ): Promise<TripItemRow> {
    const request: Record<string, unknown> = { trip_id: tripId, item_id: itemId };
    if (input.day !== undefined) request.day = input.day;
    if (input.order !== undefined) request.order = input.order;
    if (input.startTime === null) request.clear_start_time = true;
    else if (input.startTime !== undefined) request.start_time = input.startTime;
    if (input.notes === null) request.clear_notes = true;
    else if (input.notes !== undefined) request.notes = input.notes;
    if (input.title !== undefined) request.title = input.title;
    if (input.locationText === null) request.clear_location_text = true;
    else if (input.locationText !== undefined) request.location_text = input.locationText;
    if (input.cost !== undefined) request.cost = input.cost;

    if (Object.keys(request).length === 2) {
      const existing = await this.getItemForActor(userId, itemId);
      return existing.item;
    }
    const response = await this.invoke<any>('UpdateItem', request, userId);
    return toItem(response.item);
  }

  async setItemCost(
    userId: string,
    tripId: string,
    itemId: string,
    cost: number,
  ): Promise<TripItemRow> {
    const response = await this.invoke<any>(
      'SetItemCost',
      { trip_id: tripId, item_id: itemId, cost },
      userId,
    );
    return toItem(response.item);
  }

  async moveItem(
    userId: string,
    tripId: string,
    itemId: string,
    day: string,
    order: number,
  ): Promise<TripItemRow> {
    const response = await this.invoke<any>(
      'MoveItem',
      { trip_id: tripId, item_id: itemId, day, order },
      userId,
    );
    return toItem(response.item);
  }

  async removeItem(userId: string, tripId: string, itemId: string): Promise<TripItemRow> {
    const response = await this.invoke<any>(
      'DeleteItem',
      { trip_id: tripId, item_id: itemId },
      userId,
    );
    return toItem(response.item);
  }

  async setItemReminder(
    userId: string,
    tripId: string,
    itemId: string,
    input: ItemReminderInput,
  ): Promise<TripItemRow> {
    const request: Record<string, unknown> = {
      trip_id: tripId,
      item_id: itemId,
      enabled: input.enabled,
    };
    if (input.leadMinutes !== undefined) request.lead_minutes = input.leadMinutes;
    if (input.recipientIds !== undefined) request.recipient_ids = input.recipientIds;
    if (input.startTime === null) request.clear_start_time = true;
    else if (input.startTime !== undefined) request.start_time = input.startTime;

    const response = await this.invoke<any>('SetReminder', request, userId);
    return toItem(response.item);
  }

  async getItemReminder(
    userId: string,
    tripId: string,
    itemId: string,
  ): Promise<ItemReminder> {
    const response = await this.invoke<any>(
      'GetReminder',
      { trip_id: tripId, item_id: itemId },
      userId,
    );
    return toReminder(response.reminder ?? {});
  }

  async dueReminders(now?: string): Promise<DueReminderData[]> {
    const response = await this.invoke<any>('DueReminders', {
      ...(now ? { now } : {}),
    });
    return (response.items ?? []).map((row: any) => ({
      item_id: String(row.item_id ?? ''),
      trip_id: String(row.trip_id ?? ''),
      trip_name: String(row.trip_name ?? ''),
      item_title: String(row.item_title ?? ''),
      day: String(row.day ?? ''),
      start_at: String(row.start_at ?? ''),
      due_at: String(row.due_at ?? ''),
      lead_minutes: Number(row.lead_minutes ?? 0),
      recipient_ids: row.recipient_ids ?? [],
    }));
  }

  async markRemindersSent(itemId: string, userIds: string[]): Promise<void> {
    await this.invoke('MarkReminderSent', { item_id: itemId, user_ids: userIds });
  }

  async getItemForActor(
    userId: string,
    itemId: string,
  ): Promise<{ tripId: string; item: TripItemRow }> {
    const response = await this.invoke<any>('GetItemForActor', { item_id: itemId }, userId);
    return {
      tripId: String(response.trip_id ?? ''),
      item: toItem(response.item ?? {}),
    };
  }

  async previewInvitation(code: string): Promise<TripPreviewData> {
    const response = await this.invoke<any>('PreviewInvitation', { code });
    const preview = response.preview ?? {};
    return {
      invitation: toInvitation(preview.invitation ?? {}),
      trip: {
        id: String(preview.trip_id ?? ''),
        name: String(preview.trip_name ?? ''),
        destination_name: nullable(preview.destination_name),
        owner_id: String(preview.owner_id ?? ''),
      },
    };
  }

  async createInvitation(
    userId: string,
    tripId: string,
    input: CreateInvitationInput,
  ): Promise<InvitationResult> {
    const response = await this.invoke<any>(
      'CreateInvitation',
      {
        trip_id: tripId,
        email: input.email,
        role: input.role,
        ...(input.notify
          ? {
              notify: {
                inviter_name: input.notify.inviterName,
                language: input.notify.language,
                app_url: input.notify.appUrl,
                demo: input.notify.demo,
              },
            }
          : {}),
      },
      userId,
    );
    return {
      invitation: toInvitation(response.invitation ?? {}),
      emailQueued: Boolean(response.email_queued),
    };
  }

  async createLocalInvitation(
    userId: string,
    tripId: string,
    inviteeUserId: string,
    role: InviteRole,
  ): Promise<InvitationRow> {
    const response = await this.invoke<any>(
      'CreateLocalInvitation',
      { trip_id: tripId, invitee_user_id: inviteeUserId, role },
      userId,
    );
    return toInvitation(response.invitation ?? {});
  }

  async joinLocal(
    userId: string,
    tripId: string,
    invitationId: string,
  ): Promise<{ joined: boolean; data: TripData }> {
    const response = await this.invoke<any>(
      'JoinLocal',
      { trip_id: tripId, user_id: userId, invitation_id: invitationId },
      userId,
    );
    return { joined: Boolean(response.joined), data: toTripData(response.trip) };
  }

  async declineLocalInvitation(
    userId: string,
    tripId: string,
    invitationId: string,
  ): Promise<InvitationRow> {
    const response = await this.invoke<any>(
      'DeclineLocalInvitation',
      { trip_id: tripId, invitation_id: invitationId, user_id: userId },
      userId,
    );
    return toInvitation(response.invitation ?? {});
  }

  async revokeLocalInvitation(
    userId: string,
    tripId: string,
    invitationId: string,
  ): Promise<InvitationRow> {
    const response = await this.invoke<any>(
      'RevokeLocalInvitation',
      { trip_id: tripId, invitation_id: invitationId },
      userId,
    );
    return toInvitation(response.invitation ?? {});
  }

  async joinTrip(userId: string, tripId: string, input: JoinInput): Promise<JoinResult> {
    const response = await this.invoke<any>(
      'JoinTrip',
      {
        trip_id: tripId,
        user_id: input.userId,
        email: input.email,
        code: input.code,
        ...(input.notify
          ? {
              notify: {
                owner_email: input.notify.ownerEmail,
                owner_name: input.notify.ownerName,
                member_name: input.notify.memberName,
                language: input.notify.language,
              },
            }
          : {}),
      },
      userId,
    );
    return {
      joined: Boolean(response.joined),
      data: toTripData(response.trip),
      memberEmailQueued: Boolean(response.member_email_queued),
      reason: toNotificationReason(response.member_email_reason),
    };
  }
}
