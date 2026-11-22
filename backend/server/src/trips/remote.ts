// Remote adapter: calls the trips service. This is the only path after the
// M9.11 decommission; the local Postgres adapter no longer exists.

import { GraphQLError } from 'graphql';
import type { InvitationRow } from '../schema-types.ts';
import type { TripItemRow, TripMemberRow, TripRowFull } from './types.ts';
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

export interface RemoteTripsOptions {
  baseUrl: string;
  internalToken: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

interface RemoteAggregate extends TripRowFull {
  my_role: TripRole;
  members: TripMemberRow[];
  items: TripItemRow[];
  spent: number;
  spent_by_category: { category: string; amount: number }[];
  place_resolved?: boolean;
}

interface RemoteItem extends TripItemRow {
  place_resolved?: boolean;
}

interface RemoteSummary {
  id: string;
  name: string;
  destination_name: string | null;
  start_date: string;
  end_date: string;
  role: string;
  joined_at: string;
}

interface RemoteInvitation {
  id: string;
  trip_id: string;
  email: string | null;
  code: string | null;
  role: string;
  status: string;
  created_by: string;
  created_at: string;
  accepted_at: string | null;
  channel?: string;
  invitee_user_id?: string | null;
}

function asRole(value: string | null | undefined): TripRole | null {
  return value === 'owner' || value === 'editor' || value === 'viewer' ? value : null;
}

function toInvitation(raw: RemoteInvitation): InvitationRow {
  return {
    id: raw.id,
    trip_id: raw.trip_id,
    email: raw.email ?? null,
    code: raw.code ?? null,
    role: raw.role as InvitationRow['role'],
    status: raw.status as InvitationRow['status'],
    created_by: raw.created_by,
    created_at: raw.created_at,
    accepted_at: raw.accepted_at,
    channel: raw.channel === 'local' ? 'local' : 'email',
    invitee_user_id: raw.invitee_user_id ?? null,
  };
}

export class RemoteTripsStore implements TripsStore {
  private readonly root: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: RemoteTripsOptions) {
    this.root = options.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async listMyTrips(userId: string): Promise<TripSummaryData[]> {
    const response = await this.request<{ items: RemoteSummary[] }>(
      'GET',
      '/internal/v1/trips',
      userId,
    );
    return response.items.map((row) => ({
      id: row.id,
      name: row.name,
      destination_name: row.destination_name,
      start_date: row.start_date,
      end_date: row.end_date,
      role: asRole(row.role) ?? 'viewer',
      joined_at: row.joined_at,
    }));
  }

  async getTrip(userId: string, tripId: string): Promise<TripData> {
    return this.mapAggregate(
      await this.request<RemoteAggregate>(
        'GET',
        `/internal/v1/trips/${encodeURIComponent(tripId)}`,
        userId,
      ),
    );
  }

  async createTrip(userId: string, input: CreateTripInput): Promise<TripData> {
    return this.mapAggregate(
      await this.request<RemoteAggregate>('POST', '/internal/v1/trips', userId, {
        name: input.name,
        destination_id: input.destinationId ?? null,
        destination_name: input.destinationName ?? null,
        start_date: input.startDate,
        end_date: input.endDate,
        total_budget: input.totalBudget ?? 0,
        timezone: input.timezone ?? 'UTC',
      }),
    );
  }

  async updateTrip(
    userId: string,
    tripId: string,
    input: UpdateTripInput,
  ): Promise<TripData> {
    const body: Record<string, unknown> = {};
    if (input.name !== undefined) body.name = input.name;
    if (input.startDate !== undefined) body.start_date = input.startDate;
    if (input.endDate !== undefined) body.end_date = input.endDate;
    if (input.destinationId !== undefined) body.destination_id = input.destinationId;
    if (input.destinationName !== undefined) body.destination_name = input.destinationName;
    if (input.totalBudget !== undefined) body.total_budget = input.totalBudget;
    if (input.coverPreset !== undefined) body.cover_preset = input.coverPreset;
    if (input.coverPhotoUrl !== undefined) body.cover_photo_url = input.coverPhotoUrl;
    if (input.removePhoto !== undefined) body.remove_cover_photo = input.removePhoto;

    if (Object.keys(body).length === 0) {
      return this.getTrip(userId, tripId);
    }

    return this.mapAggregate(
      await this.request<RemoteAggregate>(
        'PATCH',
        `/internal/v1/trips/${encodeURIComponent(tripId)}`,
        userId,
        body,
      ),
    );
  }

  async deleteTrip(userId: string, tripId: string): Promise<void> {
    await this.request('DELETE', `/internal/v1/trips/${encodeURIComponent(tripId)}`, userId);
  }

  async inviteMember(
    userId: string,
    tripId: string,
    targetUserId: string,
    role: InviteRole,
  ): Promise<TripData> {
    await this.request('POST', `/internal/v1/trips/${encodeURIComponent(tripId)}/members`, userId, {
      user_id: targetUserId,
      role,
    });
    return this.getTrip(userId, tripId);
  }

  async updateMemberRole(
    userId: string,
    tripId: string,
    targetUserId: string,
    role: InviteRole,
  ): Promise<TripData> {
    await this.request(
      'PATCH',
      `/internal/v1/trips/${encodeURIComponent(tripId)}/members/${encodeURIComponent(targetUserId)}`,
      userId,
      { role },
    );
    return this.getTrip(userId, tripId);
  }

  async removeMember(
    userId: string,
    tripId: string,
    targetUserId: string,
  ): Promise<TripData> {
    await this.request(
      'DELETE',
      `/internal/v1/trips/${encodeURIComponent(tripId)}/members/${encodeURIComponent(targetUserId)}`,
      userId,
    );
    return this.getTrip(userId, tripId);
  }

  async leaveTrip(
    userId: string,
    tripId: string,
    newOwnerId?: string | null,
  ): Promise<TripData> {
    const response = await this.request<{ left: true; trip: RemoteAggregate }>(
      'POST',
      `/internal/v1/trips/${encodeURIComponent(tripId)}/leave`,
      userId,
      newOwnerId ? { new_owner_id: newOwnerId } : {},
    );
    return this.mapAggregate(response.trip);
  }

  async getMemberRole(userId: string, tripId: string): Promise<TripRole | null> {
    try {
      const response = await this.request<{ items: TripMemberRow[] }>(
        'GET',
        `/internal/v1/trips/${encodeURIComponent(tripId)}/members`,
        userId,
      );
      return asRole(response.items.find((member) => member.user_id === userId)?.role);
    } catch (error) {
      if (error instanceof GraphQLError) {
        const code = error.extensions.code;
        if (code === 'NOT_TRIP_MEMBER' || code === 'TRIP_NOT_FOUND') return null;
      }
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
    const response = await this.request<{ items: TripMemberRow[] }>(
      'GET',
      `/internal/v1/trips/${encodeURIComponent(tripId)}/members`,
      userId,
    );
    return response.items.map((member) => member.user_id);
  }

  async addItem(userId: string, tripId: string, input: AddItemInput): Promise<TripItemRow> {
    const response = await this.request<RemoteItem>(
      'POST',
      `/internal/v1/trips/${encodeURIComponent(tripId)}/items`,
      userId,
      {
        location_id: input.locationId ?? null,
        location_text: input.locationText ?? null,
        title: input.title,
        category: input.category,
        cost: input.cost ?? 0,
        day: input.day,
        order: input.order ?? 0,
        start_time: input.startTime ?? null,
        notes: input.notes ?? null,
        image_url: input.imageUrl ?? null,
      },
    );
    return this.mapItem(response);
  }

  async updateItem(
    userId: string,
    tripId: string,
    itemId: string,
    input: UpdateItemInput,
  ): Promise<TripItemRow> {
    const body: Record<string, unknown> = {};
    if (input.day !== undefined) body.day = input.day;
    if (input.order !== undefined) body.order = input.order;
    if (input.startTime !== undefined) body.start_time = input.startTime;
    if (input.notes !== undefined) body.notes = input.notes;
    if (input.title !== undefined) body.title = input.title;
    if (input.locationText !== undefined) body.location_text = input.locationText;
    if (input.cost !== undefined) body.cost = input.cost;

    if (Object.keys(body).length === 0) {
      const existing = await this.getItemForActor(userId, itemId);
      return existing.item;
    }

    return this.mapItem(
      await this.request<RemoteItem>(
        'PATCH',
        `/internal/v1/trips/${encodeURIComponent(tripId)}/items/${encodeURIComponent(itemId)}`,
        userId,
        body,
      ),
    );
  }

  async setItemCost(
    userId: string,
    tripId: string,
    itemId: string,
    cost: number,
  ): Promise<TripItemRow> {
    return this.updateItem(userId, tripId, itemId, { cost });
  }

  async moveItem(
    userId: string,
    tripId: string,
    itemId: string,
    day: string,
    order: number,
  ): Promise<TripItemRow> {
    return this.mapItem(
      await this.request<RemoteItem>(
        'POST',
        `/internal/v1/trips/${encodeURIComponent(tripId)}/items/${encodeURIComponent(itemId)}/move`,
        userId,
        { day, order },
      ),
    );
  }

  async removeItem(userId: string, tripId: string, itemId: string): Promise<TripItemRow> {
    return this.mapItem(
      await this.request<RemoteItem>(
        'DELETE',
        `/internal/v1/trips/${encodeURIComponent(tripId)}/items/${encodeURIComponent(itemId)}`,
        userId,
      ),
    );
  }

  async setItemReminder(
    userId: string,
    tripId: string,
    itemId: string,
    enabled: boolean,
  ): Promise<TripItemRow> {
    return this.mapItem(
      await this.request<RemoteItem>(
        'POST',
        `/internal/v1/trips/${encodeURIComponent(tripId)}/items/${encodeURIComponent(itemId)}/reminder`,
        userId,
        { enabled },
      ),
    );
  }

  async getItemForActor(
    userId: string,
    itemId: string,
  ): Promise<{ tripId: string; item: TripItemRow }> {
    const response = await this.request<{ trip_id: string; item: RemoteItem }>(
      'GET',
      `/internal/v1/items/${encodeURIComponent(itemId)}`,
      userId,
    );
    return { tripId: response.trip_id, item: this.mapItem(response.item) };
  }

  async previewInvitation(code: string): Promise<TripPreviewData> {
    const response = await this.request<{
      invitation: RemoteInvitation;
      trip: { id: string; name: string; destination_name: string | null; owner_id: string };
    }>('GET', `/internal/v1/invitations/by-code/${encodeURIComponent(code)}`, null);

    return {
      invitation: toInvitation(response.invitation),
      trip: response.trip,
    };
  }

  async createInvitation(
    userId: string,
    tripId: string,
    input: CreateInvitationInput,
  ): Promise<InvitationResult> {
    const response = await this.request<{
      invitation: RemoteInvitation;
      email: { queued: boolean };
    }>(
      'POST',
      `/internal/v1/trips/${encodeURIComponent(tripId)}/invitations`,
      userId,
      {
        email: input.email,
        role: input.role,
        notify: input.notify
          ? {
              inviter_name: input.notify.inviterName,
              language: input.notify.language,
              app_url: input.notify.appUrl,
              demo: input.notify.demo,
            }
          : undefined,
      },
    );

    return {
      invitation: toInvitation(response.invitation),
      emailQueued: response.email.queued,
    };
  }

  async createLocalInvitation(
    userId: string,
    tripId: string,
    inviteeUserId: string,
    role: InviteRole,
  ): Promise<InvitationRow> {
    return toInvitation(
      await this.request<RemoteInvitation>(
        'POST',
        `/internal/v1/trips/${encodeURIComponent(tripId)}/local-invite`,
        userId,
        { invitee_user_id: inviteeUserId, role },
      ),
    );
  }

  async joinLocal(
    userId: string,
    tripId: string,
    invitationId: string,
  ): Promise<{ joined: boolean; data: TripData }> {
    const response = await this.request<{ joined: boolean; trip: RemoteAggregate }>(
      'POST',
      `/internal/v1/trips/${encodeURIComponent(tripId)}/join-local`,
      userId,
      { user_id: userId, invitation_id: invitationId },
    );
    return { joined: response.joined, data: this.mapAggregate(response.trip) };
  }

  async declineLocalInvitation(
    userId: string,
    tripId: string,
    invitationId: string,
  ): Promise<InvitationRow> {
    return toInvitation(
      await this.request<RemoteInvitation>(
        'POST',
        `/internal/v1/trips/${encodeURIComponent(tripId)}/local-invite/${encodeURIComponent(invitationId)}/decline`,
        userId,
        { user_id: userId },
      ),
    );
  }

  async joinTrip(userId: string, tripId: string, input: JoinInput): Promise<JoinResult> {    const response = await this.request<{
      joined: boolean;
      trip: RemoteAggregate;
      member_email: { queued: boolean; reason?: string };
    }>(
      'POST',
      `/internal/v1/trips/${encodeURIComponent(tripId)}/join`,
      userId,
      {
        user_id: input.userId,
        email: input.email,
        code: input.code,
        notify: input.notify
          ? {
              owner_email: input.notify.ownerEmail,
              owner_name: input.notify.ownerName,
              member_name: input.notify.memberName,
              language: input.notify.language,
            }
          : undefined,
      },
    );

    return {
      joined: response.joined,
      data: this.mapAggregate(response.trip),
      memberEmailQueued: response.member_email.queued,
      reason: response.member_email.reason === 'ALREADY_MEMBER' ? 'ALREADY_MEMBER' : undefined,
    };
  }

  // --------------------------------------------------------------- helpers

  private mapAggregate(raw: RemoteAggregate): TripData {
    const {
      my_role,
      members,
      items,
      spent,
      spent_by_category,
      place_resolved: _placeResolved,
      ...trip
    } = raw;

    return {
      trip: trip as TripRowFull,
      members,
      items,
      myRole: asRole(my_role) ?? 'viewer',
      spent,
      spentByCategory: spent_by_category,
    };
  }

  private mapItem(raw: RemoteItem): TripItemRow {
    const { place_resolved: _placeResolved, ...item } = raw;
    return item as TripItemRow;
  }

  private async request<T>(
    method: string,
    path: string,
    userId: string | null,
    body?: unknown,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);

    const headers: Record<string, string> = {
      'x-internal-token': this.options.internalToken,
    };
    if (userId) headers['x-actor-id'] = userId;
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
        throw tripError(
          'TRIPS_UNAVAILABLE',
          timedOut ? 'El servicio de viajes no respondió a tiempo.' : 'El servicio de viajes no está disponible.',
        );
      }

      if (!response.ok) {
        let code = 'TRIPS_UNAVAILABLE';
        let message = `HTTP ${response.status}`;
        try {
          const payload = (await response.json()) as { error?: unknown; message?: unknown };
          if (typeof payload.error === 'string') code = payload.error;
          if (typeof payload.message === 'string') message = payload.message;
        } catch {
          // keep the HTTP status
        }
        if (code === 'UNAVAILABLE') code = 'TRIPS_UNAVAILABLE';
        throw tripError(code, message);
      }

      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }
}
