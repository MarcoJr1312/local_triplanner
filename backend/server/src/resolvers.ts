// GraphQL resolvers on Postgres + MongoDB catalogue + local storage.

import { randomUUID } from 'node:crypto';
import { GraphQLError } from 'graphql';
import type { LocationCatalogue } from './catalogue/types.ts';
import type { Storage } from './storage.ts';
import type { AsyncDb } from './pg/db.ts';
import { listPresence, touchPresence } from './presence.ts';
import { buildJoinUrl } from './invite-links.ts';
import { updateMyProfile, isValidLanguage } from './pg/profile.ts';
import {
  addAttachment,
  removeAttachment,
  listAttachmentsByItem,
  findAttachment,
  replaceAttachmentViewers,
  getAttachmentForUser,
  removeAttachmentsByTrip,
  removeAttachmentsByItem,
} from './pg/attachments.ts';
import { setFavorite, favoriteIdsForUser, isFavorite } from './pg/favorites.ts';
import { listUserInterests, replaceUserInterests } from './pg/interests.ts';
import { syncInterestsToAgent, type InterestsSync } from './interests.ts';
import { listSuggestionChats, upsertSuggestionChat } from './pg/chats.ts';
import { isValidMessages } from './chats.ts';
import { isValidCoverPreset, writeCoverPhoto, removeTripCoverFiles, removeCoverPhoto } from './pg/covers.ts';
import { locationRowToGraphQL } from './catalogue/presenter.ts';
import { searchLocationsWithCatalogue } from './catalogue/search.ts';
import { buildSuggestions } from './pg/recommend.ts';
import { isEmailMatch, isInviteCodeValid } from './invitations.ts';
import { decodeAvatarDataUrl } from './pg/profile.ts';
import { AGENT_BASE_URL, APP_URL, INTERNAL_TOKEN } from './env.ts';
import {
  emailSettingsClient,
  EmailSettingsError,
  type EmailSettingsGql,
  type UpdateEmailSettingsInput,
} from './email-settings.ts';
import {
  locationsSettingsClient,
  LocationsSettingsError,
  type LocationsSettingsGql,
  type UpdateLocationsSettingsInput,
} from './locations-settings.ts';
import type { TripItemRow, TripMemberRow, TripRowFull } from './trips/types.ts';
import type { TripData, TripRole, TripsStore, UpdateTripInput } from './trips/types.ts';
import type { LocationRow, Profile } from './schema-types.ts';
import type { UserRecord, UsersStore, NotificationRecord } from './users/types.ts';
import {
  DEMO_FRIEND_ID,
  DEMO_FRIEND_UUID,
  DEMO_USER_ID,
  DEMO_USER_UUID,
  toProfile,
} from './pg/auth.ts';

export interface PubSub {
  publish(topic: string, payload: Record<string, unknown>): void;
  subscribe(topic: string): AsyncIterable<unknown>;
}

export interface Ctx {
  db: AsyncDb;
  catalogue: LocationCatalogue;
  storage: Storage;
  currentUserId: string;
  pubsub: PubSub;
  trips: TripsStore;
  users: UsersStore;
  syncInterests?: InterestsSync;
}

export type Resolver = (parent: unknown, args: Record<string, unknown>, ctx: Ctx) => unknown;

type Args<T> = T;

interface TripFullRow extends TripRowFull {}

interface ItemRow extends TripItemRow {}

interface MemberRow {
  user_id: string;
  username: string | null;
  display_name: string | null;
  email: string | null;
  invited_email: string | null;
  role: string;
  joined_at: string | null;
  color: string | null;
  avatar_url: string | null;
}

interface MemberGql {
  userId: string;
  username: string | null;
  displayName: string | null;
  email: string | null;
  invitedEmail: string | null;
  role: string;
  joinedAt: string | null;
  color: string | null;
  avatarUrl: string | null;
}

interface DestinationGql {
  slug: string | null;
  name: string;
  country: string;
  description: string;
  imageUrl: string | null;
  lat: number | null;
  lng: number | null;
}

interface ActivityGql {
  id: string;
  name: string;
  category: string;
  cost: number;
  lat: number | null;
  lng: number | null;
  description: string;
  tags: unknown[];
  durationHours: number | null;
  imageUrl: string | null;
  rating: number | null;
}

interface ItemGql {
  id: string;
  day: string | null;
  order: number | null;
  activityId: string | null;
  title: string;
  category: string;
  cost: number;
  startTime: string | null;
  notes: string | null;
  imageUrl: string | null;
  addedBy: string;
  reminderEnabled: number;
  locationText: string | null;
  lat: number | null;
  lng: number | null;
}

interface TripGql {
  id: string;
  name: string;
  destinationId: string;
  destinationName: string;
  destinationLat: number | null;
  destinationLng: number | null;
  timezone: string;
  startDate: string | null;
  endDate: string | null;
  totalBudget: number;
  coverPreset: string | null;
  coverPhotoUrl: string | null;
  spent: number;
  spentByCategory: { category: string; amount: number }[];
  ownerId: string;
  inviteCode: string | null;
  members: MemberGql[];
  items: ItemGql[];
  myRole: string;
  createdAt: string;
  updatedAt: string;
}

interface RegisterUserInput {
  displayName: string;
}

interface CreateTripInput {
  name: string;
  destinationId: string;
  destinationName: string;
  startDate: string;
  endDate: string;
  totalBudget: number;
}

interface UpdateTripSettingsInput {
  name?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  destinationId?: string | null;
  destinationName?: string | null;
}

interface AddItemInput {
  activityId?: string | null;
  title: string;
  category: string;
  cost?: number | null;
  day?: string | null;
  order?: number | null;
  startTime?: string | null;
  notes?: string | null;
  imageUrl?: string | null;
  locationText?: string | null;
}

interface UpdateItemInput {
  day?: string | null;
  order?: number | null;
  startTime?: string | null;
  notes?: string | null;
  title?: string | null;
  locationText?: string | null;
}

const MAX_LOCATION_TEXT = 200;

const normalizeLocationText = (v: string | null | undefined): string | null => {
  if (v == null) return null;
  const trimmed = v.trim();
  return trimmed === '' ? null : trimmed.slice(0, MAX_LOCATION_TEXT);
};

const safeJsonArray = (s: string | null | undefined): unknown[] => {
  if (!s) return [];
  try {
    const v = JSON.parse(s) as unknown;
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

const toDestination = (row: LocationRow): DestinationGql => ({
  slug: row.slug,
  name: row.name,
  country: row.country ?? '',
  description: row.description ?? '',
  imageUrl: row.image_url ?? null,
  lat: row.lat,
  lng: row.lng,
});

const toActivity = (row: LocationRow): ActivityGql => ({
  id: row.id,
  name: row.name,
  category: row.category ?? 'activity',
  cost: row.cost ?? 0,
  lat: row.lat,
  lng: row.lng,
  description: row.description ?? '',
  tags: safeJsonArray(row.tags_json),
  durationHours: row.duration_hours ?? null,
  imageUrl: row.image_url ?? null,
  rating: row.rating ?? null,
});

const toTripItem = (row: ItemRow): ItemGql => ({
  id: row.id,
  day: row.day,
  order: row.order,
  activityId: row.location_id ?? null,
  title: row.title,
  category: row.category ?? 'activity',
  cost: row.cost ?? 0,
  startTime: row.start_time ?? null,
  notes: row.notes ?? null,
  imageUrl: row.image_url ?? null,
  addedBy: row.created_by ?? '',
  reminderEnabled: row.reminder_enabled ?? 1,
  locationText: row.location_text ?? null,
  lat: row.lat ?? null,
  lng: row.lng ?? null,
});

const toMember = (row: MemberRow): MemberGql => ({
  userId: row.user_id,
  username: row.username,
  displayName: row.display_name,
  email: row.email,
  invitedEmail: row.invited_email,
  role: row.role,
  joinedAt: row.joined_at,
  color: row.color,
  avatarUrl: row.avatar_url,
});

function slugHandle(displayName: string | null | undefined): string {
  return (
    (displayName ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 28) || 'user'
  );
}

function gqlError(code: string, message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code } });
}

function emailSettingsError(error: unknown, fallback: string): GraphQLError {
  if (error instanceof EmailSettingsError) return gqlError(error.code, error.message);
  return gqlError('EMAIL_SETTINGS_FAILED', fallback);
}

function locationsSettingsError(error: unknown, fallback: string): GraphQLError {
  if (error instanceof LocationsSettingsError) return gqlError(error.code, error.message);
  return gqlError('LOCATIONS_SETTINGS_FAILED', fallback);
}

const nowIso = (): string => new Date().toISOString();

function normalizeTimeZone(value: string | null | undefined): string {
  const tz = value?.trim();
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

async function ensureUser(
  users: UsersStore,
  { userId, email, displayName }: { userId?: string | null; email?: string | null; displayName?: string | null },
): Promise<UserRecord> {
  if (userId) {
    const found = await users.getUser(userId);
    if (found && !found.deleted_at) return found;
  }
  if (email) {
    const found = await users.getByEmail(email);
    if (found) return found;
  }

  const base =
    (email?.split('@')[0] ?? displayName ?? 'member')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 20) || 'member';
  const username = `${base}-${randomUUID().slice(0, 6)}`;
  return users.createUser({
    username,
    password: randomUUID(),
    displayName: displayName ?? 'Member',
    language: 'es',
  });
}

async function requireCurrentUser(users: UsersStore, userId: string): Promise<string> {
  if (!userId) throw gqlError('AUTH_REQUIRED', 'Necesitas iniciar sesión.');
  const row = await users.getUser(userId);
  if (!row || row.deleted_at) throw gqlError('AUTH_REQUIRED', 'Necesitas iniciar sesión.');
  return row.id;
}

interface LlmSettingsGql {
  provider: string;
  model: string;
  baseUrl: string;
  hasKey: boolean;
  demo: boolean;
}

const LLM_DEMO_SETTINGS: LlmSettingsGql = {
  provider: 'none',
  model: '',
  baseUrl: '',
  hasKey: false,
  demo: true,
};

// The email service is optional in the recruiter demo. Keep the profile modal
// usable when it is not deployed; saving will surface a clear error.
const EMAIL_SETTINGS_UNAVAILABLE: EmailSettingsGql = {
  provider: 'sink',
  from: '',
  replyTo: '',
  hasKey: false,
  ready: false,
};

// The locations service is the catalogue owner. If it is down, the settings
// card still renders in preloaded mode; writes surface a stable error.
const LOCATIONS_SETTINGS_UNAVAILABLE: LocationsSettingsGql = {
  provider: 'preloaded',
  hasKey: false,
  ready: false,
  cachedPlaces: 0,
};

// The agent owns the provider runtime. GET is public; writes are protected by
// the shared internal token. The API key never travels back to the browser.
async function agentLlmConfig(
  body?: Record<string, unknown>,
): Promise<LlmSettingsGql> {
  const res = await fetch(`${AGENT_BASE_URL}/api/agent/config`, {
    method: body ? 'POST' : 'GET',
    headers: body
      ? { 'content-type': 'application/json', 'x-internal-token': INTERNAL_TOKEN }
      : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const payload = (await res.json()) as { error?: { message?: string } };
      if (payload?.error?.message) message = payload.error.message;
    } catch {
      // keep the HTTP status as the message
    }
    throw new Error(message);
  }
  const payload = (await res.json()) as Partial<LlmSettingsGql>;
  return {
    provider: typeof payload.provider === 'string' ? payload.provider : 'none',
    model: typeof payload.model === 'string' ? payload.model : '',
    baseUrl: typeof payload.baseUrl === 'string' ? payload.baseUrl : '',
    hasKey: Boolean(payload.hasKey),
    demo: Boolean(payload.demo),
  };
}

function assertEditorRole(role: TripRole | null): void {
  if (!role) throw gqlError('NOT_TRIP_MEMBER', 'No eres miembro de este viaje.');
  if (role === 'viewer') {
    throw gqlError('FORBIDDEN_EDIT', 'Solo el propietario o un editor puede modificar el itinerario.');
  }
}

async function resolveDestination(
  ctx: Ctx,
  destinationId: string | null | undefined,
  destinationName: string | null | undefined,
): Promise<{
  destinationId: string | null;
  destinationName: string | null;
  destinationLat: number | null;
  destinationLng: number | null;
}> {
  if (!destinationId) {
    return {
      destinationId: null,
      destinationName: destinationName ?? null,
      destinationLat: null,
      destinationLng: null,
    };
  }

  let row: LocationRow | null = null;
  try {
    row = await ctx.catalogue.getById(destinationId);
  } catch {
    row = null;
  }

  return {
    destinationId,
    destinationName: destinationName ?? row?.name ?? null,
    destinationLat: row?.lat ?? null,
    destinationLng: row?.lng ?? null,
  };
}

function publishTrip(ctx: Ctx, tripId: string, mutationType: string, entity: unknown, actorId: string): void {
  ctx.pubsub.publish(`trip:${tripId}`, {
    onTripChanged: { tripId, mutationType, entity: JSON.stringify(entity), actorId },
  });
}

function publishNotification(
  ctx: Ctx,
  userId: string,
  record: NotificationRecord,
): void {
  ctx.pubsub.publish(`notify:${userId}`, {
    onNotification: toNotificationGql(record, null),
  });
}

async function enrichMembers(users: UsersStore, members: TripMemberRow[]): Promise<MemberRow[]> {
  if (members.length === 0) return [];

  const rows = await users.batchUsers(members.map((member) => member.user_id));
  const byId = new Map(rows.map((user) => [user.id, user]));
  return members.map((member) => {
    const user = byId.get(member.user_id);
    return {
      user_id: member.user_id,
      username: user?.username ?? null,
      display_name: user?.display_name ?? member.user_id,
      email: user?.email ?? null,
      invited_email: member.invited_email,
      role: member.role,
      joined_at: member.joined_at,
      color: user?.color ?? null,
      avatar_url: user?.avatar_url ?? null,
    };
  });
}

/** Adapter for attachment uploader names; one users-service batch call. */
function uploaderNames(ctx: Ctx) {
  return async (ids: readonly string[]): Promise<Map<string, string>> => {
    const rows = await ctx.users.batchUsers(ids);
    return new Map(rows.map((user) => [user.id, user.display_name]));
  };
}

interface NotificationGql {
  id: string;
  type: string;
  tripId: string;
  tripName: string;
  invitationId: string;
  inviterUserId: string | null;
  inviter: Profile | null;
  role: string;
  status: string;
  createdAt: string;
  readAt: string | null;
}

function toNotificationGql(record: NotificationRecord, inviter: Profile | null): NotificationGql {
  return {
    id: record.id,
    type: record.type,
    tripId: record.trip_id,
    tripName: record.trip_name,
    invitationId: record.invitation_id,
    inviterUserId: record.inviter_user_id,
    inviter,
    role: record.role,
    status: record.status,
    createdAt: record.created_at,
    readAt: record.read_at,
  };
}

async function buildNotifications(
  ctx: Ctx,
  records: NotificationRecord[],
): Promise<NotificationGql[]> {
  const ids = [
    ...new Set(
      records
        .map((record) => record.inviter_user_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const inviters = ids.length > 0 ? await ctx.users.batchUsers(ids) : [];
  const byId = new Map(inviters.map((user) => [user.id, user]));

  return records.map((record) => {
    const inviter = record.inviter_user_id
      ? byId.get(record.inviter_user_id)
      : undefined;
    return toNotificationGql(record, inviter ? toProfile(inviter) : null);
  });
}

async function buildNotification(ctx: Ctx, record: NotificationRecord): Promise<NotificationGql> {
  const inviter = record.inviter_user_id
    ? await ctx.users.getUser(record.inviter_user_id)
    : null;
  return toNotificationGql(record, inviter ? toProfile(inviter) : null);
}

const PROTECTED_USER_IDS = new Set([
  DEMO_USER_ID,
  DEMO_FRIEND_ID,
  DEMO_USER_UUID,
  DEMO_FRIEND_UUID,
]);

async function buildTrip(ctx: Ctx, data: TripData): Promise<TripGql> {
  const members = (await enrichMembers(ctx.users, data.members)).map(toMember);

  return {
    id: data.trip.id,
    name: data.trip.name,
    destinationId: data.trip.destination_id ?? '',
    destinationName: data.trip.destination_name ?? '',
    destinationLat: data.trip.destination_lat ?? null,
    destinationLng: data.trip.destination_lng ?? null,
    timezone: data.trip.timezone ?? 'UTC',
    startDate: data.trip.start_date ?? '',
    endDate: data.trip.end_date ?? '',
    totalBudget: data.trip.total_budget ?? 0,
    coverPreset: data.trip.cover_preset ?? null,
    coverPhotoUrl: data.trip.cover_photo_url ?? null,
    spent: data.spent,
    spentByCategory: data.spentByCategory,
    ownerId: data.trip.owner_id,
    inviteCode: data.trip.invite_code ?? '',
    members,
    items: data.items.map(toTripItem),
    myRole: data.myRole,
    createdAt: data.trip.created_at,
    updatedAt: data.trip.updated_at,
  };
}

export const resolvers: {
  Query: Record<string, Resolver>;
  Mutation: Record<string, Resolver>;
  Subscription: Record<string, { subscribe: Resolver }>;
  Notification: Record<string, Resolver>;
  Trip: Record<string, Resolver>;
  TripItem: Record<string, Resolver>;
} = {
  Query: {
    listMyTrips: async (_, __, ctx) => {
      const rows = await ctx.trips.listMyTrips(ctx.currentUserId);
      return rows.map((r) => ({
        tripId: r.id,
        tripName: r.name,
        destinationName: r.destination_name ?? '',
        startDate: r.start_date,
        endDate: r.end_date,
        role: r.role,
        joinedAt: r.joined_at,
      }));
    },

    getTrip: async (_, args, ctx) => {
      const { id } = args as Args<{ id: string }>;
      return buildTrip(ctx, await ctx.trips.getTrip(ctx.currentUserId, id));
    },

    listDestinations: async (_, __, ctx) => {
      const rows = await ctx.catalogue.listDestinations();
      return rows.map(toDestination);
    },

    listActivities: async (_, args, ctx) => {
      const { destSlug, category } = args as Args<{ destSlug: string; category?: string | null }>;
      const rows = (await ctx.catalogue.listByParent(destSlug))
        .filter((r) => r.category != null && (!category || r.category === category))
        .sort(
          (a, b) =>
            (b.rating ?? 0) - (a.rating ?? 0) ||
            (b.rating_count ?? 0) - (a.rating_count ?? 0) ||
            a.name.localeCompare(b.name),
        )
        .slice(0, 10);
      const favIds = await favoriteIdsForUser(ctx.db, ctx.currentUserId);
      return rows.map((r) => ({ ...toActivity(r), isFavorite: favIds.has(r.id) }));
    },

    listPresence: (_, args) => {
      const { tripId } = args as Args<{ tripId: string }>;
      return listPresence(tripId);
    },

    findUserByEmail: async (_, args, ctx) => {
      const { email } = args as Args<{ email: string }>;
      const user = await ctx.users.getByEmail(email);
      return user ? toProfile(user) : null;
    },

    searchLocations: async (_, args, ctx) => {
      const { q, lat, lng } = args as Args<{ q: string; lat?: number | null; lng?: number | null }>;
      const rows = await searchLocationsWithCatalogue({
        catalogue: ctx.catalogue,
        db: ctx.db,
        q,
        lat,
        lng,
        userId: ctx.currentUserId,
      });
      const favIds = await favoriteIdsForUser(ctx.db, ctx.currentUserId);
      return rows.map((r) => locationRowToGraphQL(r, favIds));
    },

    locationById: async (_, args, ctx) => {
      const { id } = args as Args<{ id: string }>;
      const row = await ctx.catalogue.getById(id);
      const favIds = await favoriteIdsForUser(ctx.db, ctx.currentUserId);
      return locationRowToGraphQL(row, favIds);
    },

    locationDetails: async (_, args, ctx) => {
      const { placeId } = args as Args<{ placeId: string }>;
      const existing = await ctx.catalogue.getByPlaceId(placeId);
      if (!existing) return null;
      const favIds = await favoriteIdsForUser(ctx.db, ctx.currentUserId);
      return locationRowToGraphQL(existing, favIds);
    },

    getTripByCode: async (_, args, ctx) => {
      const { code } = args as Args<{ code: string }>;
      if (!isInviteCodeValid(code)) return null;

      let preview;
      try {
        preview = await ctx.trips.previewInvitation(code);
      } catch (error) {
        if (error instanceof GraphQLError && error.extensions.code === 'INVITE_CODE_NOT_FOUND') {
          return null;
        }
        throw error;
      }

      const owner = await ctx.users.getUser(preview.trip.owner_id);

      return {
        id: preview.trip.id,
        name: preview.trip.name,
        destinationName: preview.trip.destination_name ?? '',
        ownerName: owner?.display_name ?? '',
        invitedEmail: preview.invitation.email,
      };
    },

    getMyProfile: async (_, __, ctx) => {
      const user = await ctx.users.getUser(ctx.currentUserId);
      return user && !user.deleted_at ? toProfile(user) : null;
    },

    listUsers: async (_, args, ctx) => {
      const { query } = args as Args<{ query?: string | null }>;
      return (await ctx.users.listUsers(query ?? '')).map(toProfile);
    },

    getUserByUsername: async (_, args, ctx) => {
      const { username } = args as Args<{ username: string }>;
      const user = await ctx.users.getByUsername(username);
      return user && !user.deleted_at ? toProfile(user) : null;
    },

    myNotifications: async (_, __, ctx) => {
      return buildNotifications(ctx, await ctx.users.listNotifications(ctx.currentUserId));
    },

    suggestionChats: (_, args, ctx) => {
      const { tripId, day } = args as Args<{ tripId: string; day?: string | null }>;
      return listSuggestionChats(ctx.db, tripId, ctx.currentUserId, day ?? null);
    },

    getMyInterests: async (_, __, ctx) => {
      const userId = await requireCurrentUser(ctx.users, ctx.currentUserId);
      return listUserInterests(ctx.db, userId);
    },

    getLlmSettings: async () => {
      try {
        return await agentLlmConfig();
      } catch {
        return LLM_DEMO_SETTINGS;
      }
    },

    getEmailSettings: async (_, __, ctx) => {
      await requireCurrentUser(ctx.users, ctx.currentUserId);
      try {
        return await emailSettingsClient.get();
      } catch (error) {
        if (error instanceof EmailSettingsError && error.code === 'EMAIL_SETTINGS_FAILED') {
          return EMAIL_SETTINGS_UNAVAILABLE;
        }
        throw emailSettingsError(error, 'No se pudo leer la configuración de email.');
      }
    },

    getLocationsSettings: async (_, __, ctx) => {
      await requireCurrentUser(ctx.users, ctx.currentUserId);
      try {
        return await locationsSettingsClient.get();
      } catch (error) {
        if (
          error instanceof LocationsSettingsError &&
          error.code === 'LOCATIONS_SETTINGS_FAILED'
        ) {
          return LOCATIONS_SETTINGS_UNAVAILABLE;
        }
        throw locationsSettingsError(error, 'No se pudo leer la configuración de lugares.');
      }
    },
  },

  Mutation: {
    login: async (_, args, ctx) => {
      const { username, password } = args as Args<{ username: string; password: string }>;
      return toProfile(await ctx.users.login(username, password));
    },

    createUser: async (_, args, ctx) => {
      const { input } = args as Args<{
        input: {
          username: string;
          password: string;
          displayName: string;
          language?: string | null;
        };
      }>;
      return toProfile(
        await ctx.users.createUser({
          username: input.username,
          password: input.password,
          displayName: input.displayName,
          language: input.language ?? 'es',
        }),
      );
    },

    deleteUser: async (_, args, ctx) => {
      const { userId } = args as Args<{ userId: string }>;
      if (PROTECTED_USER_IDS.has(userId)) {
        throw gqlError('PROTECTED_USER', 'Las cuentas demo no se pueden eliminar.');
      }
      const owned = await ctx.trips.listMyTrips(userId);
      if (owned.some((trip) => trip.role === 'owner')) {
        throw gqlError(
          'USER_OWNS_TRIPS',
          'Transfiere o elimina sus viajes antes de borrar la cuenta.',
        );
      }
      await ctx.users.deleteUser(userId);
      return true;
    },

    tripLocalInvite: async (_, args, ctx) => {
      const { tripId, username, role } = args as Args<{
        tripId: string;
        username: string;
        role: string;
      }>;
      if (role !== 'editor' && role !== 'viewer') {
        throw gqlError('INVALID_MEMBER_ROLE', 'Rol de miembro no válido.');
      }

      const target = await ctx.users.getByUsername(username);
      if (!target || target.deleted_at) {
        throw gqlError('USER_NOT_FOUND', 'Usuario no encontrado.');
      }
      if (target.id === ctx.currentUserId) {
        throw gqlError('INVALID_ARGUMENT', 'No puedes invitarte a ti mismo.');
      }

      const trip = await ctx.trips.getTrip(ctx.currentUserId, tripId);
      if (trip.members.some((member) => member.user_id === target.id)) {
        throw gqlError('ALREADY_MEMBER', 'El usuario ya es miembro de este viaje.');
      }

      const invitation = await ctx.trips.createLocalInvitation(
        ctx.currentUserId,
        tripId,
        target.id,
        role,
      );

      try {
        const result = await ctx.users.createNotification({
          userId: target.id,
          type: 'trip_invite',
          tripId,
          tripName: trip.trip.name,
          invitationId: invitation.id,
          inviterUserId: ctx.currentUserId,
          role,
        });
        if (result.created) publishNotification(ctx, target.id, result.notification);
        return {
          invitationId: invitation.id,
          notificationId: result.notification.id,
          user: toProfile(target),
          status: invitation.status,
        };
      } catch (error) {
        // Compensate: never leave a local invitation the invitee cannot see.
        await ctx.trips
          .revokeLocalInvitation(ctx.currentUserId, tripId, invitation.id)
          .catch(() => undefined);
        if (error instanceof GraphQLError) {
          const code = error.extensions.code;
          if (code === 'USER_NOT_FOUND' || code === 'INVALID_ARGUMENT') throw error;
        }
        throw gqlError(
          'NOTIFICATION_FAILED',
          'No se pudo crear la notificación de la invitación.',
        );
      }
    },

    acceptTripLocalInvite: async (_, args, ctx) => {
      const { notificationId } = args as Args<{ notificationId: string }>;
      const notification = await ctx.users.getNotification(
        ctx.currentUserId,
        notificationId,
      );
      if (notification.status === 'declined') {
        throw gqlError('INVITE_ALREADY_USED', 'La invitación ya fue utilizada.');
      }
      if (notification.status === 'accepted') {
        // Idempotent retry: membership already exists, return the trip.
        const current = await ctx.trips.getTrip(ctx.currentUserId, notification.trip_id);
        return buildTrip(ctx, current);
      }

      const result = await ctx.trips.joinLocal(
        ctx.currentUserId,
        notification.trip_id,
        notification.invitation_id,
      );

      // Membership is authoritative; a notification write failure must not undo it.
      await ctx.users
        .updateNotification(ctx.currentUserId, notification.id, 'accepted')
        .catch((error: unknown) => {
          console.error(
            '[users] could not mark notification accepted:',
            error instanceof Error ? error.message : error,
          );
        });

      if (result.joined) {
        publishTrip(
          ctx,
          notification.trip_id,
          'acceptLocalInvite',
          { invitationId: notification.invitation_id, userId: ctx.currentUserId },
          ctx.currentUserId,
        );
      }
      return buildTrip(ctx, result.data);
    },

    declineTripLocalInvite: async (_, args, ctx) => {
      const { notificationId } = args as Args<{ notificationId: string }>;
      const notification = await ctx.users.getNotification(
        ctx.currentUserId,
        notificationId,
      );
      if (notification.status === 'accepted') {
        throw gqlError('INVITE_ALREADY_USED', 'La invitación ya fue utilizada.');
      }
      if (notification.status === 'declined') {
        return buildNotification(ctx, notification);
      }

      await ctx.trips.declineLocalInvitation(
        ctx.currentUserId,
        notification.trip_id,
        notification.invitation_id,
      );
      const updated = await ctx.users.updateNotification(
        ctx.currentUserId,
        notification.id,
        'declined',
      );
      return buildNotification(ctx, updated);
    },

    markNotificationRead: async (_, args, ctx) => {
      const { notificationId } = args as Args<{ notificationId: string }>;
      const updated = await ctx.users.updateNotification(
        ctx.currentUserId,
        notificationId,
        'read',
      );
      return buildNotification(ctx, updated);
    },

    registerUser: async (_, args, ctx) => {
      const { input } = args as Args<{ input: RegisterUserInput }>;
      const displayName = input.displayName.trim();
      if (!displayName) {
        throw gqlError('INVALID_ARGUMENT', 'El nombre no puede estar vacío.');
      }
      // Deprecated field: kept for old clients until M10.8 replaces it with
      // createUser. Username is derived and the generated password is unused.
      const username = slugHandle(displayName);
      const existing = await ctx.users.getByUsername(username);
      if (existing) return toProfile(existing);
      const created = await ctx.users.createUser({
        username,
        password: randomUUID(),
        displayName,
        language: 'es',
      });
      return toProfile(created);
    },

    createTrip: async (_, args, ctx) => {
      const { input } = args as Args<{ input: CreateTripInput & { timezone?: string | null } }>;
      const destination = await resolveDestination(ctx, input.destinationId, input.destinationName);
      const data = await ctx.trips.createTrip(ctx.currentUserId, {
        name: input.name,
        destinationId: destination.destinationId,
        destinationName: destination.destinationName,
        destinationLat: destination.destinationLat,
        destinationLng: destination.destinationLng,
        startDate: input.startDate,
        endDate: input.endDate,
        totalBudget: input.totalBudget,
        timezone: normalizeTimeZone(input.timezone),
      });
      publishTrip(ctx, data.trip.id, 'createTrip', { id: data.trip.id, name: input.name }, ctx.currentUserId);
      return buildTrip(ctx, data);
    },

    updateTripSettings: async (_, args, ctx) => {
      const { id, input } = args as Args<{ id: string; input: UpdateTripSettingsInput }>;
      const patch: UpdateTripInput = {};
      if (input.name != null) patch.name = input.name;
      if (input.startDate != null) patch.startDate = input.startDate;
      if (input.endDate != null) patch.endDate = input.endDate;

      if (input.destinationId != null && input.destinationId !== '') {
        const destination = await resolveDestination(ctx, input.destinationId, input.destinationName);
        patch.destinationId = destination.destinationId;
        patch.destinationName = destination.destinationName;
        patch.destinationLat = destination.destinationLat;
        patch.destinationLng = destination.destinationLng;
      } else if (input.destinationName != null) {
        patch.destinationName = input.destinationName;
      }

      const data = await ctx.trips.updateTrip(ctx.currentUserId, id, patch);
      publishTrip(ctx, id, 'updateTripSettings', { id, name: data.trip.name }, ctx.currentUserId);
      return buildTrip(ctx, data);
    },

    setBudget: async (_, args, ctx) => {
      const { tripId, totalBudget } = args as Args<{ tripId: string; totalBudget: number }>;
      const data = await ctx.trips.updateTrip(ctx.currentUserId, tripId, { totalBudget });
      publishTrip(ctx, tripId, 'setBudget', { tripId, totalBudget }, ctx.currentUserId);
      return buildTrip(ctx, data);
    },

    inviteMember: async (_, args, ctx) => {
      const { tripId, userId, email, displayName, role } = args as Args<{
        tripId: string;
        userId?: string | null;
        email?: string | null;
        displayName?: string | null;
        role: string;
      }>;
      if (role !== 'editor' && role !== 'viewer') {
        throw gqlError('INVALID_MEMBER_ROLE', 'Rol de miembro no válido.');
      }
      const user = await ensureUser(ctx.users, { userId, email, displayName });
      const data = await ctx.trips.inviteMember(ctx.currentUserId, tripId, user.id, role);
      publishTrip(ctx, tripId, 'inviteMember', { tripId, userId: user.id, role }, ctx.currentUserId);
      return buildTrip(ctx, data);
    },

    updateMemberRole: async (_, args, ctx) => {
      const { tripId, userId, role } = args as Args<{ tripId: string; userId: string; role: string }>;
      if (role !== 'editor' && role !== 'viewer') {
        throw gqlError('INVALID_MEMBER_ROLE', 'Rol de miembro no válido.');
      }
      const data = await ctx.trips.updateMemberRole(ctx.currentUserId, tripId, userId, role);
      publishTrip(ctx, tripId, 'updateMemberRole', { tripId, userId, role }, ctx.currentUserId);
      return buildTrip(ctx, data);
    },

    removeMember: async (_, args, ctx) => {
      const { tripId, userId } = args as Args<{ tripId: string; userId: string }>;
      const data = await ctx.trips.removeMember(ctx.currentUserId, tripId, userId);
      publishTrip(ctx, tripId, 'removeMember', { tripId, userId }, ctx.currentUserId);
      return buildTrip(ctx, data);
    },

    leaveTrip: async (_, args, ctx) => {
      const { tripId, newOwnerId } = args as Args<{ tripId: string; newOwnerId?: string | null }>;
      const data = await ctx.trips.leaveTrip(ctx.currentUserId, tripId, newOwnerId);
      publishTrip(ctx, tripId, 'leaveTrip', { tripId, userId: ctx.currentUserId, newOwnerId }, ctx.currentUserId);
      return buildTrip(ctx, data);
    },

    deleteTrip: async (_, args, ctx) => {
      const { tripId } = args as Args<{ tripId: string }>;
      const data = await ctx.trips.getTrip(ctx.currentUserId, tripId);
      if (data.trip.owner_id !== ctx.currentUserId) {
        throw gqlError('NOT_TRIP_OWNER', 'Solo el propietario puede eliminar el viaje.');
      }
      await removeAttachmentsByTrip(ctx.db, ctx.storage, tripId);
      await removeTripCoverFiles(ctx.storage, tripId);
      await ctx.trips.deleteTrip(ctx.currentUserId, tripId);
      publishTrip(ctx, tripId, 'deleteTrip', { id: tripId }, ctx.currentUserId);
      return tripId;
    },

    updateTripCover: async (_, args, ctx) => {
      const { tripId, input } = args as Args<{
        tripId: string;
        input: { coverPreset?: string | null; coverPhotoDataUrl?: string | null; removePhoto?: boolean | null };
      }>;
      const current = await ctx.trips.getTrip(ctx.currentUserId, tripId);
      if (current.trip.owner_id !== ctx.currentUserId) {
        throw gqlError('NOT_TRIP_OWNER', 'Solo el propietario puede cambiar la portada.');
      }

      if (input.coverPreset != null && input.coverPreset !== '') {
        if (!isValidCoverPreset(input.coverPreset)) {
          throw gqlError('INVALID_COVER_PRESET', 'Preset de portada no válido.');
        }
        const data = await ctx.trips.updateTrip(ctx.currentUserId, tripId, {
          coverPreset: input.coverPreset,
        });
        await removeTripCoverFiles(ctx.storage, tripId);
        publishTrip(ctx, tripId, 'updateTripCover', { tripId }, ctx.currentUserId);
        return buildTrip(ctx, data);
      }

      if (input.coverPhotoDataUrl) {
        let decoded: { ext: string; buffer: Buffer };
        try {
          decoded = decodeAvatarDataUrl(input.coverPhotoDataUrl);
        } catch {
          throw gqlError('INVALID_IMAGE', 'Formato de imagen no válido: usa PNG, JPG o WebP (máx 2MB).');
        }

        let relPath: string;
        try {
          relPath = await writeCoverPhoto(ctx.storage, tripId, decoded.ext, decoded.buffer);
        } catch (e) {
          throw gqlError('COVER_UPLOAD_FAILED', e instanceof Error ? e.message : 'No se pudo guardar la portada.');
        }

        let data;
        try {
          data = await ctx.trips.updateTrip(ctx.currentUserId, tripId, { coverPhotoUrl: relPath });
        } catch (error) {
          await removeCoverPhoto(ctx.storage, relPath);
          throw error;
        }

        await removeCoverPhoto(ctx.storage, current.trip.cover_photo_url);
        publishTrip(ctx, tripId, 'updateTripCover', { tripId }, ctx.currentUserId);
        return buildTrip(ctx, data);
      }

      if (input.removePhoto) {
        const data = await ctx.trips.updateTrip(ctx.currentUserId, tripId, { removePhoto: true });
        await removeTripCoverFiles(ctx.storage, tripId);
        publishTrip(ctx, tripId, 'updateTripCover', { tripId }, ctx.currentUserId);
        return buildTrip(ctx, data);
      }

      return buildTrip(ctx, current);
    },

    addItem: async (_, args, ctx) => {
      const { tripId, input } = args as Args<{ tripId: string; input: AddItemInput }>;
      const locationId = input.activityId ?? null;
      let locationName: string | null = null;
      let locationAddress: string | null = null;
      let lat: number | null = null;
      let lng: number | null = null;

      if (locationId) {
        try {
          const row = await ctx.catalogue.getById(locationId);
          if (row) {
            locationName = row.name;
            locationAddress = row.address;
            lat = row.lat;
            lng = row.lng;
          }
        } catch {
          // Best effort: the item keeps the supplied text.
        }
      }

      const item = await ctx.trips.addItem(ctx.currentUserId, tripId, {
        locationId,
        locationText: normalizeLocationText(input.locationText),
        locationName,
        locationAddress,
        lat,
        lng,
        title: input.title,
        category: input.category,
        cost: input.cost ?? 0,
        day: input.day ?? '',
        order: input.order ?? 0,
        startTime: input.startTime ?? null,
        notes: input.notes ?? null,
        imageUrl: input.imageUrl ?? null,
      });
      publishTrip(ctx, tripId, 'addItem', { id: item.id, tripId, title: input.title }, ctx.currentUserId);
      return toTripItem(item);
    },

    updateItem: async (_, args, ctx) => {
      const { tripId, itemId, input } = args as Args<{ tripId: string; itemId: string; input: UpdateItemInput }>;
      const item = await ctx.trips.updateItem(ctx.currentUserId, tripId, itemId, {
        day: input.day ?? undefined,
        order: input.order ?? undefined,
        startTime: input.startTime === undefined ? undefined : input.startTime?.trim() || null,
        notes: input.notes ?? undefined,
        title: input.title ?? undefined,
        locationText:
          input.locationText === undefined ? undefined : normalizeLocationText(input.locationText),
      });
      publishTrip(ctx, tripId, 'updateItem', { itemId, tripId }, ctx.currentUserId);
      return toTripItem(item);
    },

    setItemReminder: async (_, args, ctx) => {
      const { itemId, enabled } = args as Args<{ itemId: string; enabled: boolean }>;
      const { tripId } = await ctx.trips.getItemForActor(ctx.currentUserId, itemId);
      const item = await ctx.trips.setItemReminder(ctx.currentUserId, tripId, itemId, enabled);
      publishTrip(ctx, tripId, 'setItemReminder', { itemId, tripId, enabled }, ctx.currentUserId);
      return toTripItem(item);
    },

    setItemCost: async (_, args, ctx) => {
      const { tripId, itemId, cost } = args as Args<{ tripId: string; itemId: string; cost: number }>;
      const item = await ctx.trips.setItemCost(ctx.currentUserId, tripId, itemId, cost);
      publishTrip(ctx, tripId, 'setItemCost', { itemId, tripId, cost }, ctx.currentUserId);
      return toTripItem(item);
    },

    moveItem: async (_, args, ctx) => {
      const { tripId, itemId, day, order } = args as Args<{ tripId: string; itemId: string; day: string; order: number }>;
      const item = await ctx.trips.moveItem(ctx.currentUserId, tripId, itemId, day, order);
      publishTrip(ctx, tripId, 'moveItem', { itemId, tripId, day, order }, ctx.currentUserId);
      return toTripItem(item);
    },

    removeItem: async (_, args, ctx) => {
      const { tripId, itemId } = args as Args<{ tripId: string; itemId: string }>;
      const role = await ctx.trips.getMemberRole(ctx.currentUserId, tripId);
      assertEditorRole(role);
      await removeAttachmentsByItem(ctx.db, ctx.storage, tripId, itemId);
      const item = await ctx.trips.removeItem(ctx.currentUserId, tripId, itemId);
      publishTrip(ctx, tripId, 'removeItem', { itemId, tripId }, ctx.currentUserId);
      return toTripItem(item);
    },

    touchPresence: async (_, args, ctx) => {
      const { input } = args as Args<{
        input: { tripId: string; displayName: string; color: string | null; editingItemId?: string | null };
      }>;
      await ctx.trips.assertMember(ctx.currentUserId, input.tripId);
      const entry = touchPresence({
        userId: ctx.currentUserId,
        tripId: input.tripId,
        displayName: input.displayName,
        color: input.color,
        editingItemId: input.editingItemId ?? null,
      });
      ctx.pubsub.publish(`presence:${input.tripId}`, { onPresenceChanged: entry });
      return entry;
    },

    requestSuggestions: async (_, args, ctx) => {
      const { tripId, day } = args as Args<{ tripId: string; day?: number | null }>;
      const data = await ctx.trips.getTrip(ctx.currentUserId, tripId);
      const suggestions = await buildSuggestions(
        ctx.catalogue,
        data.trip,
        data.items.map((item) => ({
          activity_id: item.location_id,
          title: item.title,
          cost: item.cost,
        })),
      );
      return { day, items: suggestions };
    },

    sendTripInvite: async (_, args, ctx) => {
      const { tripId, email, role } = args as Args<{ tripId: string; email: string; role?: string | null }>;
      const normalized = email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
        throw gqlError('INVALID_EMAIL', 'Email no válido');
      }
      const requestedRole = (typeof role === 'string' ? role.trim().toLowerCase() : '') || 'viewer';
      if (requestedRole !== 'editor' && requestedRole !== 'viewer') {
        throw gqlError('INVALID_INVITE_ROLE', 'Rol de invitación no válido');
      }
      const inviteRole = requestedRole as 'editor' | 'viewer';

      const myRole = await ctx.trips.getMemberRole(ctx.currentUserId, tripId);
      if (myRole !== 'owner' && myRole !== 'editor') {
        throw gqlError('FORBIDDEN_INVITE', 'Solo el propietario o un editor puede invitar');
      }

      const inviter = await ctx.users.getUser(ctx.currentUserId);

      const result = await ctx.trips.createInvitation(ctx.currentUserId, tripId, {
        email: normalized,
        role: inviteRole,
        notify: {
          inviterName: inviter?.display_name.trim() || 'DemoUser',
          language: inviter?.language === 'en' ? 'en' : 'es',
          appUrl: APP_URL,
          demo: true,
        },
      });

      const code = result.invitation.code;
      if (!code) {
        throw gqlError('INVITE_CODE_NOT_FOUND', 'La invitación no tiene código.');
      }
      const joinUrl = buildJoinUrl(tripId, code);
      publishTrip(ctx, tripId, 'inviteSent', { tripId, email: result.invitation.email }, ctx.currentUserId);
      return {
        invitationId: result.invitation.id,
        status: result.invitation.status,
        email: result.invitation.email,
        code,
        joinUrl,
      };
    },

    joinTripWithCode: async (_, args, ctx) => {
      const { code, email, memberId } = args as Args<{
        code: string;
        email: string;
        memberId?: string | null;
      }>;
      if (!isInviteCodeValid(code)) {
        throw gqlError('INVALID_INVITE_CODE', 'Código de invitación no válido');
      }

      const preview = await ctx.trips.previewInvitation(code);

      // Email invitations target the seeded Demo Friend, so clicking the email
      // link does not attach the invited address to the root Demo owner. The
      // session stays on the current user either way.
      const targetUserId = (memberId ?? '').trim() || ctx.currentUserId;
      const isDemoFriend =
        targetUserId === DEMO_FRIEND_ID || targetUserId === DEMO_FRIEND_UUID;
      if (targetUserId !== ctx.currentUserId && !isDemoFriend) {
        throw gqlError('FORBIDDEN_MEMBER', 'No puedes aceptar la invitacion para ese usuario.');
      }

      const [owner, member] = await Promise.all([
        ctx.users.getUser(preview.trip.owner_id),
        ctx.users.getUser(targetUserId),
      ]);
      if (!member || member.deleted_at) {
        throw gqlError('MEMBER_NOT_FOUND', 'El miembro demo no existe.');
      }

      const notify = owner?.email
        ? {
            ownerEmail: owner.email,
            ownerName: owner.display_name,
            memberName: member.display_name,
            language: owner.language === 'en' ? ('en' as const) : ('es' as const),
          }
        : undefined;

      const result = await ctx.trips.joinTrip(ctx.currentUserId, preview.trip.id, {
        userId: targetUserId,
        email,
        code,
        notify,
      });

      if (result.joined) {
        publishTrip(
          ctx,
          preview.trip.id,
          'joinTrip',
          { tripId: preview.trip.id, userId: ctx.currentUserId },
          ctx.currentUserId,
        );
      }
      return buildTrip(ctx, result.data);
    },

    updateMyProfile: async (_, args, ctx) => {
      const { input } = args as Args<{
        input: {
          displayName: string;
          avatarDataUrl?: string | null;
          avatarRemove?: boolean | null;
          language?: string | null;
        };
      }>;
      const language = input.language ?? null;
      if (language !== null && !isValidLanguage(language)) {
        throw gqlError('INVALID_LANGUAGE', 'Idioma no vÃ¡lido: usa "es" o "en".');
      }
      try {
        const row = await updateMyProfile(ctx.users, ctx.storage, ctx.currentUserId, {
          displayName: input.displayName,
          avatarDataUrl: input.avatarDataUrl ?? null,
          avatarRemove: input.avatarRemove ?? false,
          language,
        });
        return toProfile(row);
      } catch (e) {
        throw gqlError('PROFILE_SAVE_FAILED', e instanceof Error ? e.message : 'No se pudo actualizar el perfil.');
      }
    },

    addItemAttachment: async (_, args, ctx) => {
      const { tripId: requestedTripId, itemId, input, viewerIds: rawViewerIds } = args as Args<{
        tripId?: string | null;
        itemId: string;
        input: { fileName: string; mimeType: string; dataUrl: string };
        viewerIds?: string[] | null;
      }>;

      const { tripId } = await ctx.trips.getItemForActor(ctx.currentUserId, itemId);
      if (requestedTripId && requestedTripId !== tripId) {
        throw gqlError('ITEM_NOT_FOUND', 'Actividad no encontrada.');
      }

      const memberIds = new Set(await ctx.trips.listMemberIds(ctx.currentUserId, tripId));
      const viewerIds = [...new Set(rawViewerIds ?? [])];
      if (viewerIds.some((viewerId) => !memberIds.has(viewerId))) {
        throw gqlError('INVALID_VIEWER', 'Todos los viewers deben ser miembros del viaje.');
      }

      try {
        const created = await addAttachment(
          ctx.db,
          ctx.storage,
          tripId,
          itemId,
          ctx.currentUserId,
          { fileName: input.fileName, mimeType: input.mimeType, dataUrl: input.dataUrl },
          viewerIds,
        );
        const attachment =
          (await getAttachmentForUser(
            ctx.db,
            ctx.storage,
            created.id,
            ctx.currentUserId,
            (trip) => ctx.trips.isMember(ctx.currentUserId, trip),
            uploaderNames(ctx),
          )) ?? created;
        publishTrip(ctx, tripId, 'addAttachment', { itemId, attachmentId: attachment.id }, ctx.currentUserId);
        return attachment;
      } catch (e) {
        if (e instanceof GraphQLError) throw e;
        throw gqlError('ATTACHMENT_UPLOAD_FAILED', e instanceof Error ? e.message : 'No se pudo subir el archivo.');
      }
    },

    updateAttachmentViewers: async (_, args, ctx) => {
      const { attachmentId, viewerIds: rawViewerIds } = args as Args<{
        attachmentId: string;
        viewerIds?: string[] | null;
      }>;
      const row = await findAttachment(ctx.db, attachmentId);
      if (!row?.trip_id) throw gqlError('ATTACHMENT_NOT_FOUND', 'Archivo no encontrado.');
      if (row.created_by !== ctx.currentUserId) {
        throw gqlError('FORBIDDEN_ATTACHMENT', 'Solo quien subió el archivo puede editar sus permisos.');
      }
      await ctx.trips.assertMember(ctx.currentUserId, row.trip_id);

      const memberIds = new Set(await ctx.trips.listMemberIds(ctx.currentUserId, row.trip_id));
      const viewerIds = [...new Set(rawViewerIds ?? [])].filter(
        (viewerId) => viewerId !== ctx.currentUserId,
      );
      if (viewerIds.some((viewerId) => !memberIds.has(viewerId))) {
        throw gqlError('INVALID_VIEWER', 'Todos los viewers deben ser miembros del viaje.');
      }

      await replaceAttachmentViewers(ctx.db, attachmentId, viewerIds);
      const attachment = await getAttachmentForUser(
        ctx.db,
        ctx.storage,
        attachmentId,
        ctx.currentUserId,
        (trip) => ctx.trips.isMember(ctx.currentUserId, trip),
        uploaderNames(ctx),
      );
      publishTrip(ctx, row.trip_id, 'updateAttachmentViewers', { attachmentId }, ctx.currentUserId);
      return attachment;
    },

    removeItemAttachment: async (_, args, ctx) => {
      const { attachmentId } = args as Args<{ attachmentId: string }>;
      const row = await findAttachment(ctx.db, attachmentId);
      if (!row?.trip_id) throw gqlError('ATTACHMENT_NOT_FOUND', 'Archivo no encontrado.');
      await ctx.trips.assertMember(ctx.currentUserId, row.trip_id);
      if (row.created_by !== ctx.currentUserId) {
        throw gqlError('FORBIDDEN_ATTACHMENT', 'Solo quien subió el archivo puede eliminarlo.');
      }
      const attachment = await getAttachmentForUser(
        ctx.db,
        ctx.storage,
        attachmentId,
        ctx.currentUserId,
        (trip) => ctx.trips.isMember(ctx.currentUserId, trip),
        uploaderNames(ctx),
      );
      await removeAttachment(ctx.db, ctx.storage, attachmentId);
      publishTrip(ctx, row.trip_id, 'removeAttachment', { attachmentId }, ctx.currentUserId);
      return attachment;
    },

    setMyInterests: async (_, args, ctx) => {
      const { terms } = args as Args<{ terms: string[] }>;
      const userId = await requireCurrentUser(ctx.users, ctx.currentUserId);
      return replaceUserInterests(ctx.db, userId, terms, ctx.syncInterests ?? syncInterestsToAgent);
    },

    updateLlmSettings: async (_, args, ctx) => {
      const { input } = args as Args<{
        input: {
          provider: string;
          apiKey?: string | null;
          model?: string | null;
          baseUrl?: string | null;
          clearKey?: boolean | null;
        };
      }>;
      await requireCurrentUser(ctx.users, ctx.currentUserId);
      try {
        return await agentLlmConfig({
          provider: input.provider,
          apiKey: input.apiKey ?? '',
          model: input.model ?? '',
          baseUrl: input.baseUrl ?? '',
          clearKey: Boolean(input.clearKey),
        });
      } catch (e) {
        throw gqlError(
          'LLM_SETTINGS_FAILED',
          e instanceof Error ? e.message : 'No se pudo guardar la configuración del proveedor.',
        );
      }
    },

    updateEmailSettings: async (_, args, ctx) => {
      const { input } = args as Args<{ input: UpdateEmailSettingsInput }>;
      await requireCurrentUser(ctx.users, ctx.currentUserId);
      try {
        return await emailSettingsClient.update(input);
      } catch (error) {
        throw emailSettingsError(error, 'No se pudo guardar la configuración de email.');
      }
    },

    updateLocationsSettings: async (_, args, ctx) => {
      const { input } = args as Args<{ input: UpdateLocationsSettingsInput }>;
      await requireCurrentUser(ctx.users, ctx.currentUserId);
      try {
        return await locationsSettingsClient.update(input);
      } catch (error) {
        throw locationsSettingsError(error, 'No se pudo guardar la configuración de lugares.');
      }
    },

    favoriteLocation: async (_, args, ctx) => {
      const { locationId, favorite } = args as Args<{ locationId: string; favorite: boolean }>;
      try {
        const state = await setFavorite(ctx.db, ctx.currentUserId, locationId, favorite, async (id) =>
          Boolean(await ctx.catalogue.getById(id)),
        );
        return { locationId, favorite: state };
      } catch (e) {
        if (e instanceof GraphQLError) throw e;
        throw gqlError('FAVORITE_SAVE_FAILED', e instanceof Error ? e.message : 'No se pudo actualizar el favorito.');
      }
    },

    saveSuggestionChat: async (_, args, ctx) => {
      const { tripId, day, messages } = args as Args<{
        tripId: string;
        day: string;
        messages: { role: string; content: string }[];
      }>;
      await ctx.trips.assertMember(ctx.currentUserId, tripId);
      if (!isValidMessages(messages)) {
        throw gqlError('INVALID_MESSAGES', 'messages debe ser un array no vacÃ­o de {role, content}.');
      }
      return upsertSuggestionChat(ctx.db, { tripId, userId: ctx.currentUserId, day, messages });
    },

  },

  Subscription: {
    onTripChanged: {
      subscribe: async (_, args, ctx) => {
        const { tripId } = args as Args<{ tripId: string }>;
        await ctx.trips.assertMember(ctx.currentUserId, tripId);
        return ctx.pubsub.subscribe(`trip:${tripId}`);
      },
    },
    onPresenceChanged: {
      subscribe: async (_, args, ctx) => {
        const { tripId } = args as Args<{ tripId: string }>;
        await ctx.trips.assertMember(ctx.currentUserId, tripId);
        return ctx.pubsub.subscribe(`presence:${tripId}`);
      },
    },
    onNotification: {
      subscribe: async (_, __, ctx) => ctx.pubsub.subscribe(`notify:${ctx.currentUserId}`),
    },
  },

  Notification: {
    inviter: async (parent, __, ctx) => {
      const notification = parent as NotificationGql;
      if (notification.inviter) return notification.inviter;
      if (!notification.inviterUserId) return null;
      const user = await ctx.users.getUser(notification.inviterUserId);
      return user ? toProfile(user) : null;
    },
  },

  Trip: {
    destinationLat: async (parent, __, ctx) => {
      const { destinationLat, destinationId } = parent as { destinationLat?: number | null; destinationId?: string | null };
      if (destinationLat != null) return destinationLat;
      if (!destinationId) return null;
      try {
        return (await ctx.catalogue.getById(destinationId))?.lat ?? null;
      } catch {
        return null;
      }
    },
    destinationLng: async (parent, __, ctx) => {
      const { destinationLng, destinationId } = parent as { destinationLng?: number | null; destinationId?: string | null };
      if (destinationLng != null) return destinationLng;
      if (!destinationId) return null;
      try {
        return (await ctx.catalogue.getById(destinationId))?.lng ?? null;
      } catch {
        return null;
      }
    },
    items: (parent) => (parent as TripGql).items,
    members: (parent) => (parent as TripGql).members,
  },

  TripItem: {
    attachments: (parent, __, ctx) => {
      const { id } = parent as { id: string };
      return listAttachmentsByItem(
        ctx.db,
        ctx.storage,
        id,
        ctx.currentUserId,
        (tripId) => ctx.trips.isMember(ctx.currentUserId, tripId),
        uploaderNames(ctx),
      );
    },
    isFavorite: (parent, __, ctx) => {
      const { activityId } = parent as { activityId?: string | null };
      if (!activityId) return false;
      return isFavorite(ctx.db, ctx.currentUserId, activityId);
    },
    lat: (parent) => (parent as ItemGql).lat ?? null,
    lng: (parent) => (parent as ItemGql).lng ?? null,
  },
};
