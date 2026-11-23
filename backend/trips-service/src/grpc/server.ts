// Trips service gRPC listener. It wraps the same domain service as the HTTP
// routes; authorization is enforced by the domain service itself.

import * as grpc from '@grpc/grpc-js';
import * as loader from '@grpc/proto-loader';
import { fileURLToPath } from 'node:url';
import { AppError, type ErrorCode } from '../errors.ts';
import type { TripsService } from '../domain/service.ts';
import type {
  DueReminder,
  InvitationPreview,
  InvitationRow,
  ItemReminderConfig,
  TripAggregate,
  TripItemRow,
  TripMemberRow,
  TripRow,
  TripSummaryRow,
} from '../domain/types.ts';

const PROTO_PATH =
  process.env.PROTO_PATH ??
  fileURLToPath(new URL('../../../../proto/triplanner/trips/v1/trips.proto', import.meta.url));
const HEALTH_PROTO_PATH =
  process.env.HEALTH_PROTO_PATH ??
  fileURLToPath(new URL('../../../../proto/grpc/health/v1/health.proto', import.meta.url));

const ERROR_STATUS: Partial<Record<ErrorCode, grpc.status>> = {
  UNAUTHORIZED: grpc.status.UNAUTHENTICATED,
  ACTOR_REQUIRED: grpc.status.UNAUTHENTICATED,
  INVALID_ARGUMENT: grpc.status.INVALID_ARGUMENT,
  NOT_FOUND: grpc.status.NOT_FOUND,
  TRIP_NOT_FOUND: grpc.status.NOT_FOUND,
  ITEM_NOT_FOUND: grpc.status.NOT_FOUND,
  MEMBER_NOT_FOUND: grpc.status.NOT_FOUND,
  INVITE_CODE_NOT_FOUND: grpc.status.NOT_FOUND,
  INVITE_NOT_FOUND: grpc.status.NOT_FOUND,
  NOT_TRIP_MEMBER: grpc.status.PERMISSION_DENIED,
  FORBIDDEN_EDIT: grpc.status.PERMISSION_DENIED,
  NOT_TRIP_OWNER: grpc.status.PERMISSION_DENIED,
  OWNER_ROLE_PROTECTED: grpc.status.PERMISSION_DENIED,
  OWNER_CANNOT_BE_REMOVED: grpc.status.PERMISSION_DENIED,
  INVITE_EMAIL_MISMATCH: grpc.status.PERMISSION_DENIED,
  INVITE_INVITEE_MISMATCH: grpc.status.PERMISSION_DENIED,
  FORBIDDEN: grpc.status.PERMISSION_DENIED,
  ALREADY_MEMBER: grpc.status.ALREADY_EXISTS,
  INVITE_ALREADY_USED: grpc.status.FAILED_PRECONDITION,
  OWNER_MUST_TRANSFER: grpc.status.FAILED_PRECONDITION,
  REMINDER_TIME_PASSED: grpc.status.FAILED_PRECONDITION,
  LOCATIONS_UNAVAILABLE: grpc.status.UNAVAILABLE,
  UNAVAILABLE: grpc.status.UNAVAILABLE,
};

function grpcError(error: unknown): grpc.ServiceError {
  const app = error instanceof AppError ? error : null;
  const status = app ? (ERROR_STATUS[app.code] ?? grpc.status.INTERNAL) : grpc.status.INTERNAL;
  const message = app ? app.message : 'Internal error';
  const metadata = new grpc.Metadata();
  if (app) metadata.set('x-error-code', app.code);
  const serviceError = new Error(message) as grpc.ServiceError;
  serviceError.code = status;
  serviceError.metadata = metadata;
  return serviceError;
}

function requireToken(call: grpc.ServerUnaryCall<unknown, unknown>, expected: string): void {
  const values = call.metadata.get('x-internal-token');
  const provided = Array.isArray(values) ? String(values[0] ?? '') : '';
  if (!expected || provided !== expected) {
    throw new AppError('UNAUTHORIZED', 'Token interno inválido.');
  }
}

function actorOf(call: grpc.ServerUnaryCall<unknown, unknown>): string {
  const values = call.metadata.get('x-actor-id');
  return Array.isArray(values) ? String(values[0] ?? '').trim() : '';
}

function requireActor(call: grpc.ServerUnaryCall<unknown, unknown>): string {
  const value = actorOf(call);
  if (!value) throw new AppError('ACTOR_REQUIRED', 'x-actor-id requerido.');
  return value;
}

function optional<T>(value: T | null | undefined): T | undefined {
  return value === null || value === undefined ? undefined : value;
}

function toTripSummary(row: TripSummaryRow) {
  return {
    id: row.id,
    name: row.name,
    destination_name: optional(row.destination_name),
    start_date: row.start_date,
    end_date: row.end_date,
    role: row.role,
    joined_at: row.joined_at,
  };
}

function toTrip(row: TripRow) {
  return {
    id: row.id,
    name: row.name,
    destination_id: optional(row.destination_id),
    destination_name: optional(row.destination_name),
    destination_lat: optional(row.destination_lat),
    destination_lng: optional(row.destination_lng),
    start_date: row.start_date,
    end_date: row.end_date,
    total_budget: row.total_budget,
    cover_preset: optional(row.cover_preset),
    cover_photo_url: optional(row.cover_photo_url),
    timezone: row.timezone,
    owner_id: row.owner_id,
    invite_code: row.invite_code,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toMember(row: TripMemberRow) {
  return {
    user_id: row.user_id,
    role: row.role,
    joined_at: row.joined_at,
    invited_email: optional(row.invited_email),
  };
}

function toReminder(row: ItemReminderConfig) {
  return {
    enabled: row.enabled,
    lead_minutes: row.lead_minutes,
    recipient_ids: row.recipient_ids,
    can_edit: row.can_edit,
  };
}

function toItem(row: TripItemRow) {
  return {
    id: row.id,
    trip_id: row.trip_id,
    location_id: optional(row.location_id),
    location_text: optional(row.location_text),
    location_name: optional(row.location_name),
    location_address: optional(row.location_address),
    lat: optional(row.lat),
    lng: optional(row.lng),
    title: row.title,
    category: optional(row.category),
    cost: row.cost,
    day: row.day,
    order: row.order,
    start_time: optional(row.start_time),
    notes: optional(row.notes),
    image_url: optional(row.image_url),
    created_by: optional(row.created_by),
    created_at: row.created_at,
    reminder: row.reminder ? toReminder(row.reminder) : undefined,
  };
}

function toAggregate(row: TripAggregate) {
  return {
    trip: toTrip(row),
    members: row.members.map(toMember),
    items: row.items.map(toItem),
    my_role: row.my_role,
    spent: row.spent,
    spent_by_category: row.spent_by_category,
  };
}

function toInvitation(row: InvitationRow) {
  return {
    id: row.id,
    trip_id: row.trip_id,
    email: optional(row.email),
    code: optional(row.code),
    role: row.role,
    status: row.status,
    created_by: row.created_by,
    created_at: row.created_at,
    accepted_at: optional(row.accepted_at),
    channel: row.channel,
    invitee_user_id: optional(row.invitee_user_id),
  };
}

function toPreview(row: InvitationPreview) {
  return {
    invitation: toInvitation(row.invitation),
    trip_id: row.trip.id,
    trip_name: row.trip.name,
    destination_name: optional(row.trip.destination_name),
    owner_id: row.trip.owner_id,
  };
}

function toDueReminder(row: DueReminder) {
  return {
    item_id: row.item_id,
    trip_id: row.trip_id,
    trip_name: row.trip_name,
    item_title: row.item_title,
    day: row.day,
    start_at: row.start_at,
    due_at: row.due_at,
    lead_minutes: row.lead_minutes,
    recipient_ids: row.recipient_ids,
  };
}

/** Copies only the request fields that were actually present. */
function patchOf(request: any, keys: readonly string[]): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const key of keys) {
    if (request[key] !== undefined) body[key] = request[key];
  }
  return body;
}

export interface TripsGrpcOptions {
  service: TripsService;
  port: number;
  internalToken: string;
}

export interface TripsGrpcHandle {
  server: grpc.Server;
  stop: () => Promise<void>;
}

export async function startTripsGrpcServer(
  options: TripsGrpcOptions,
): Promise<TripsGrpcHandle> {
  const definition = loader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: false,
    oneofs: true,
  });
  const proto = grpc.loadPackageDefinition(definition) as any;
  const descriptor = proto.triplanner.trips.v1.TripsService;
  const service = options.service;

  const guard = (call: grpc.ServerUnaryCall<any, any>): string => {
    requireToken(call, options.internalToken);
    return requireActor(call);
  };

  const server = new grpc.Server();
  const healthDefinition = loader.loadSync(HEALTH_PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: false,
    oneofs: true,
  });
  const healthProto = grpc.loadPackageDefinition(healthDefinition) as any;
  server.addService(healthProto.grpc.health.v1.Health.service, {
    Check: (_call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
      callback(null, { status: 'SERVING' });
    },
  });
  server.addService(descriptor.service, {
    ListTrips: async (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
      try {
        const items = await service.listTrips(guard(call));
        callback(null, { items: items.map(toTripSummary) });
      } catch (error) {
        callback(grpcError(error));
      }
    },
    GetTrip: async (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
      try {
        callback(null, { trip: toAggregate(await service.getTrip(guard(call), call.request.trip_id)) });
      } catch (error) {
        callback(grpcError(error));
      }
    },
    CreateTrip: async (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
      try {
        const actor = guard(call);
        const body = {
          name: call.request.name,
          destination_id: call.request.destination_id ?? null,
          destination_name: call.request.destination_name ?? null,
          start_date: call.request.start_date,
          end_date: call.request.end_date,
          total_budget: call.request.total_budget ?? 0,
          timezone: call.request.timezone || 'UTC',
        };
        callback(null, { trip: toAggregate(await service.createTrip(actor, body)) });
      } catch (error) {
        callback(grpcError(error));
      }
    },
    UpdateTrip: async (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
      try {
        const actor = guard(call);
        const request = call.request;
        const body: Record<string, unknown> = {};
        if (request.name !== undefined) body.name = request.name;
        if (request.start_date !== undefined) body.start_date = request.start_date;
        if (request.end_date !== undefined) body.end_date = request.end_date;
        if (request.clear_destination_id) body.destination_id = null;
        else if (request.destination_id !== undefined) body.destination_id = request.destination_id;
        if (request.clear_destination_name) body.destination_name = null;
        else if (request.destination_name !== undefined) {
          body.destination_name = request.destination_name;
        }
        if (request.total_budget !== undefined) body.total_budget = request.total_budget;
        if (request.clear_cover_preset) body.cover_preset = null;
        else if (request.cover_preset !== undefined) body.cover_preset = request.cover_preset;
        if (request.cover_photo_url !== undefined) body.cover_photo_url = request.cover_photo_url;
        if (request.remove_cover_photo) body.remove_cover_photo = true;

        const aggregate =
          Object.keys(body).length === 0
            ? await service.getTrip(actor, request.trip_id)
            : await service.updateTrip(actor, request.trip_id, body);
        callback(null, { trip: toAggregate(aggregate) });
      } catch (error) {
        callback(grpcError(error));
      }
    },
    DeleteTrip: async (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
      try {
        await service.deleteTrip(guard(call), call.request.trip_id);
        callback(null, {});
      } catch (error) {
        callback(grpcError(error));
      }
    },
    ListMembers: async (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
      try {
        const items = await service.listMembers(guard(call), call.request.trip_id);
        callback(null, { items: items.map(toMember) });
      } catch (error) {
        callback(grpcError(error));
      }
    },
    AddMember: async (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
      try {
        const actor = guard(call);
        const member = await service.addMember(actor, call.request.trip_id, {
          user_id: call.request.user_id,
          role: call.request.role,
          ...(call.request.invited_email !== undefined
            ? { invited_email: call.request.invited_email }
            : {}),
        });
        callback(null, { member: toMember(member) });
      } catch (error) {
        callback(grpcError(error));
      }
    },
    UpdateMemberRole: async (
      call: grpc.ServerUnaryCall<any, any>,
      callback: grpc.sendUnaryData<any>,
    ) => {
      try {
        const member = await service.updateMemberRole(
          guard(call),
          call.request.trip_id,
          call.request.user_id,
          { role: call.request.role },
        );
        callback(null, { member: toMember(member) });
      } catch (error) {
        callback(grpcError(error));
      }
    },
    RemoveMember: async (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
      try {
        await service.removeMember(guard(call), call.request.trip_id, call.request.user_id);
        callback(null, {});
      } catch (error) {
        callback(grpcError(error));
      }
    },
    LeaveTrip: async (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
      try {
        const result = await service.leaveTrip(guard(call), call.request.trip_id, {
          ...(call.request.new_owner_id !== undefined
            ? { new_owner_id: call.request.new_owner_id }
            : {}),
        });
        callback(null, { left: result.left, trip: toAggregate(result.trip) });
      } catch (error) {
        callback(grpcError(error));
      }
    },
    ListItems: async (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
      try {
        const items = await service.listItems(guard(call), call.request.trip_id);
        callback(null, { items: items.map(toItem) });
      } catch (error) {
        callback(grpcError(error));
      }
    },
    AddItem: async (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
      try {
        const actor = guard(call);
        const request = call.request;
        const item = await service.addItem(actor, request.trip_id, {
          location_id: request.location_id ?? null,
          location_text: request.location_text ?? null,
          title: request.title,
          category: request.category,
          cost: request.cost ?? 0,
          day: request.day,
          order: request.order ?? 0,
          start_time: request.start_time ?? null,
          notes: request.notes ?? null,
          image_url: request.image_url ?? null,
        });
        callback(null, { item: toItem(item) });
      } catch (error) {
        callback(grpcError(error));
      }
    },
    UpdateItem: async (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
      try {
        const actor = guard(call);
        const request = call.request;
        const body = patchOf(request, ['day', 'order', 'title', 'cost']);
        if (request.clear_start_time) body.start_time = null;
        else if (request.start_time !== undefined) body.start_time = request.start_time;
        if (request.clear_notes) body.notes = null;
        else if (request.notes !== undefined) body.notes = request.notes;
        if (request.clear_location_text) body.location_text = null;
        else if (request.location_text !== undefined) body.location_text = request.location_text;

        if (Object.keys(body).length === 0) {
          const existing = await service.getItemForActor(actor, request.item_id);
          callback(null, { item: toItem(existing.item) });
          return;
        }
        const item = await service.updateItem(actor, request.trip_id, request.item_id, body);
        callback(null, { item: toItem(item) });
      } catch (error) {
        callback(grpcError(error));
      }
    },
    SetItemCost: async (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
      try {
        const item = await service.updateItem(guard(call), call.request.trip_id, call.request.item_id, {
          cost: call.request.cost,
        });
        callback(null, { item: toItem(item) });
      } catch (error) {
        callback(grpcError(error));
      }
    },
    MoveItem: async (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
      try {
        const item = await service.moveItem(
          guard(call),
          call.request.trip_id,
          call.request.item_id,
          { day: call.request.day, order: call.request.order },
        );
        callback(null, { item: toItem(item) });
      } catch (error) {
        callback(grpcError(error));
      }
    },
    DeleteItem: async (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
      try {
        const item = await service.deleteItem(
          guard(call),
          call.request.trip_id,
          call.request.item_id,
        );
        callback(null, { item: toItem(item) });
      } catch (error) {
        callback(grpcError(error));
      }
    },
    SetReminder: async (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
      try {
        const request = call.request;
        const body: Record<string, unknown> = { enabled: request.enabled };
        if (request.lead_minutes !== undefined) body.lead_minutes = request.lead_minutes;
        if (Array.isArray(request.recipient_ids) && request.recipient_ids.length > 0) {
          body.recipient_ids = request.recipient_ids;
        }
        if (request.clear_start_time) body.start_time = null;
        else if (request.start_time !== undefined) body.start_time = request.start_time;

        const item = await service.setReminder(
          guard(call),
          request.trip_id,
          request.item_id,
          body,
        );
        callback(null, { item: toItem(item) });
      } catch (error) {
        callback(grpcError(error));
      }
    },
    GetReminder: async (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
      try {
        const reminder = await service.getReminder(
          guard(call),
          call.request.trip_id,
          call.request.item_id,
        );
        callback(null, { reminder: toReminder(reminder) });
      } catch (error) {
        callback(grpcError(error));
      }
    },
    DueReminders: async (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
      try {
        requireToken(call, options.internalToken);
        const now = call.request.now ? new Date(call.request.now) : new Date();
        const items = await service.dueReminders(
          Number.isFinite(now.getTime()) ? now : new Date(),
        );
        callback(null, { items: items.map(toDueReminder) });
      } catch (error) {
        callback(grpcError(error));
      }
    },
    MarkReminderSent: async (
      call: grpc.ServerUnaryCall<any, any>,
      callback: grpc.sendUnaryData<any>,
    ) => {
      try {
        requireToken(call, options.internalToken);
        await service.markReminderSent(
          call.request.item_id,
          Array.isArray(call.request.user_ids) ? call.request.user_ids : [],
        );
        callback(null, {});
      } catch (error) {
        callback(grpcError(error));
      }
    },
    GetItemForActor: async (
      call: grpc.ServerUnaryCall<any, any>,
      callback: grpc.sendUnaryData<any>,
    ) => {
      try {
        const result = await service.getItemForActor(guard(call), call.request.item_id);
        callback(null, { trip_id: result.trip_id, item: toItem(result.item) });
      } catch (error) {
        callback(grpcError(error));
      }
    },
    PreviewInvitation: async (
      call: grpc.ServerUnaryCall<any, any>,
      callback: grpc.sendUnaryData<any>,
    ) => {
      try {
        requireToken(call, options.internalToken);
        const preview = await service.previewInvitation(call.request.code);
        callback(null, { preview: toPreview(preview) });
      } catch (error) {
        callback(grpcError(error));
      }
    },
    CreateInvitation: async (
      call: grpc.ServerUnaryCall<any, any>,
      callback: grpc.sendUnaryData<any>,
    ) => {
      try {
        const request = call.request;
        const result = await service.createInvitation(guard(call), request.trip_id, {
          email: request.email,
          role: request.role,
          ...(request.notify
            ? {
                notify: {
                  inviter_name: request.notify.inviter_name,
                  language: request.notify.language,
                  app_url: request.notify.app_url,
                  demo: Boolean(request.notify.demo),
                },
              }
            : {}),
        });
        callback(null, {
          invitation: toInvitation(result.invitation),
          email_queued: result.email.queued,
        });
      } catch (error) {
        callback(grpcError(error));
      }
    },
    CreateLocalInvitation: async (
      call: grpc.ServerUnaryCall<any, any>,
      callback: grpc.sendUnaryData<any>,
    ) => {
      try {
        const result = await service.createLocalInvitation(
          guard(call),
          call.request.trip_id,
          {
            invitee_user_id: call.request.invitee_user_id,
            role: call.request.role,
          },
        );
        callback(null, {
          invitation: toInvitation(result.invitation),
          created: result.created,
        });
      } catch (error) {
        callback(grpcError(error));
      }
    },
    JoinLocal: async (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
      try {
        const result = await service.joinLocal(guard(call), call.request.trip_id, {
          user_id: call.request.user_id,
          invitation_id: call.request.invitation_id,
        });
        callback(null, { joined: result.joined, trip: toAggregate(result.trip) });
      } catch (error) {
        callback(grpcError(error));
      }
    },
    DeclineLocalInvitation: async (
      call: grpc.ServerUnaryCall<any, any>,
      callback: grpc.sendUnaryData<any>,
    ) => {
      try {
        const invitation = await service.declineLocalInvitation(
          guard(call),
          call.request.trip_id,
          {
            user_id: call.request.user_id,
            invitation_id: call.request.invitation_id,
          },
        );
        callback(null, { invitation: toInvitation(invitation) });
      } catch (error) {
        callback(grpcError(error));
      }
    },
    RevokeLocalInvitation: async (
      call: grpc.ServerUnaryCall<any, any>,
      callback: grpc.sendUnaryData<any>,
    ) => {
      try {
        const invitation = await service.revokeLocalInvitation(
          guard(call),
          call.request.trip_id,
          call.request.invitation_id,
        );
        callback(null, { invitation: toInvitation(invitation) });
      } catch (error) {
        callback(grpcError(error));
      }
    },
    JoinTrip: async (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
      try {
        const request = call.request;
        const result = await service.joinTrip(guard(call), request.trip_id, {
          user_id: request.user_id,
          email: request.email,
          code: request.code,
          ...(request.notify
            ? {
                notify: {
                  owner_email: request.notify.owner_email,
                  owner_name: request.notify.owner_name,
                  member_name: request.notify.member_name,
                  language: request.notify.language,
                },
              }
            : {}),
        });
        callback(null, {
          joined: result.joined,
          trip: toAggregate(result.trip),
          member_email_queued: result.member_email.queued,
          member_email_reason: optional(result.member_email.reason),
        });
      } catch (error) {
        callback(grpcError(error));
      }
    },
  });

  await new Promise<void>((resolve, reject) => {
    server.bindAsync(
      `0.0.0.0:${options.port}`,
      grpc.ServerCredentials.createInsecure(),
      (error) => (error ? reject(error) : resolve()),
    );
  });

  return {
    server,
    stop: async () => {
      await new Promise<void>((resolve) => {
        server.tryShutdown(() => resolve());
      });
    },
  };
}
