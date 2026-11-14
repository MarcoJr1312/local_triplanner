// GraphQL resolvers on Postgres + MongoDB catalogue + local storage.

import { randomUUID } from 'node:crypto';
import { GraphQLError } from 'graphql';
import type { LocationCatalogue } from './catalogue/types.ts';
import type { Storage } from './storage.ts';
import type { AsyncDb } from './pg/db.ts';
import { toProfile } from './pg/auth.ts';
import { listPresence, touchPresence } from './presence.ts';
import { buildJoinUrl } from './invite-links.ts';
import { updateMyProfile, isValidLanguage } from './pg/profile.ts';
import {
  addAttachment,
  removeAttachment,
  listAttachmentsByItem,
  findAttachmentItemTrip,
  findAttachment,
  findItemTrip,
  invalidAttachmentViewers,
  replaceAttachmentViewers,
  getAttachmentForUser,
  removeAttachmentsByTrip,
} from './pg/attachments.ts';
import { setFavorite, favoriteIdsForUser, isFavorite } from './pg/favorites.ts';
import { listUserInterests, replaceUserInterests } from './pg/interests.ts';
import { syncInterestsToAgent, type InterestsSync } from './interests.ts';
import { listSuggestionChats, upsertSuggestionChat } from './pg/chats.ts';
import { isValidMessages } from './chats.ts';
import { recomputeItemReminder } from './pg/reminders.ts';
import { isValidCoverPreset, writeCoverPhoto, removeTripCoverFiles } from './pg/covers.ts';
import { locationRowToGraphQL } from './catalogue/presenter.ts';
import { searchLocationsWithCatalogue } from './catalogue/search.ts';
import { buildSuggestions } from './pg/recommend.ts';
import { createInvitation, findInvitationByCode, acceptInvitation } from './pg/invitations.ts';
import { isEmailMatch, isInviteCodeValid } from './invitations.ts';
import { decodeAvatarDataUrl } from './pg/profile.ts';
import { AGENT_BASE_URL, INTERNAL_TOKEN } from './env.ts';
import {
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
  updateTripSettings as updateTripSettingsRow,
  type TripItemRow,
  type TripRowFull,
} from './pg/trips.ts';
import type { LocationRow, Profile, TripRow, UserRow } from './schema-types.ts';

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
  syncInterests?: InterestsSync;
}

export type Resolver = (parent: unknown, args: Record<string, unknown>, ctx: Ctx) => unknown;

type Args<T> = T;

interface TripFullRow extends TripRowFull {}

interface ItemRow extends TripItemRow {}

interface MemberRow {
  user_id: string;
  display_name: string | null;
  email: string | null;
  role: string;
  joined_at: string | null;
  color: string | null;
  avatar_url: string | null;
}

interface MemberGql {
  userId: string;
  displayName: string | null;
  email: string | null;
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
  displayName: row.display_name,
  email: row.email,
  role: row.role,
  joinedAt: row.joined_at,
  color: row.color,
  avatarUrl: row.avatar_url,
});

function slugEmail(displayName: string | null | undefined): string {
  const slug =
    (displayName ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'user';
  return `${slug}@demo.local`;
}

function gqlError(code: string, message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code } });
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
  db: AsyncDb,
  { userId, email, displayName }: { userId?: string | null; email?: string | null; displayName?: string | null },
): Promise<UserRow> {
  let user = userId ? await db.prepare('SELECT * FROM users WHERE id = ?').get<UserRow>(userId) : undefined;
  if (!user && email) user = (await db.prepare('SELECT * FROM users WHERE email = ?').get<UserRow>(email)) ?? undefined;
  if (user) return user;
  const id = userId ?? randomUUID();
  const em = email ?? slugEmail(displayName ?? 'member');
  const dn = displayName ?? 'Member';
  await db
    .prepare('INSERT INTO users (id, email, display_name, color) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING')
    .run(id, em, dn, '#64748b');
  const created = await db.prepare('SELECT * FROM users WHERE id = ?').get<UserRow>(id);
  if (!created) throw gqlError('USER_CREATE_FAILED', 'No se pudo crear el usuario.');
  return created;
}

async function requireCurrentUser(db: AsyncDb, userId: string): Promise<string> {
  if (!userId) throw gqlError('AUTH_REQUIRED', 'Necesitas iniciar sesión.');
  const row = await db.prepare('SELECT 1 AS ok FROM users WHERE id = ?').get(userId);
  if (!row) throw gqlError('AUTH_REQUIRED', 'Necesitas iniciar sesión.');
  return userId;
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

async function assertTripMember(db: AsyncDb, tripId: string, userId: string): Promise<void> {
  if (!(await isTripMember(db, tripId, userId))) {
    throw gqlError('NOT_TRIP_MEMBER', 'No eres miembro de este viaje.');
  }
}

async function assertCanEditTrip(db: AsyncDb, tripId: string, userId: string): Promise<void> {
  await assertTripMember(db, tripId, userId);
  const role = await getMemberRole(db, tripId, userId);
  if (role !== 'owner' && role !== 'editor') {
    throw gqlError('FORBIDDEN_EDIT', 'Solo el propietario o un editor puede modificar el itinerario.');
  }
}

function publishTrip(ctx: Ctx, tripId: string, mutationType: string, entity: unknown, actorId: string): void {
  ctx.pubsub.publish(`trip:${tripId}`, {
    onTripChanged: { tripId, mutationType, entity: JSON.stringify(entity), actorId },
  });
}

async function buildTrip(db: AsyncDb, tripRow: TripFullRow, currentUserId: string): Promise<TripGql> {
  const members = (await listMembersWithUser(db, tripRow.id)).map(toMember);
  const items = (await listItems(db, tripRow.id)).map(toTripItem);
  const { spent, spentByCategory } = computeTripStats(items);
  const myRole = await getMemberRole(db, tripRow.id, currentUserId);

  return {
    id: tripRow.id,
    name: tripRow.name,
    destinationId: tripRow.destination_id ?? '',
    destinationName: tripRow.destination_name ?? '',
    destinationLat: tripRow.destination_lat ?? null,
    destinationLng: tripRow.destination_lng ?? null,
    timezone: tripRow.timezone ?? 'UTC',
    startDate: tripRow.start_date,
    endDate: tripRow.end_date,
    totalBudget: tripRow.total_budget ?? 0,
    coverPreset: tripRow.cover_preset ?? null,
    coverPhotoUrl: tripRow.cover_photo_url ?? null,
    spent,
    spentByCategory,
    ownerId: tripRow.owner_id,
    inviteCode: tripRow.invite_code,
    members,
    items,
    myRole: myRole ?? 'viewer',
    createdAt: tripRow.created_at,
    updatedAt: tripRow.updated_at,
  };
}

async function listMembersWithUser(db: AsyncDb, tripId: string): Promise<MemberRow[]> {
  return db
    .prepare(
      `SELECT m.user_id, m.role, m.joined_at, u.display_name, u.email, u.color, u.avatar_url
       FROM trip_members m
       JOIN users u ON u.id = m.user_id
       WHERE m.trip_id = ?
       ORDER BY m.joined_at ASC`,
    )
    .all<MemberRow>(tripId);
}

async function tripOrThrow(db: AsyncDb, tripId: string): Promise<TripFullRow> {
  const trip = await getTrip(db, tripId);
  if (!trip) throw gqlError('TRIP_NOT_FOUND', 'Trip not found');
  return trip;
}

export const resolvers: {
  Query: Record<string, Resolver>;
  Mutation: Record<string, Resolver>;
  Subscription: Record<string, { subscribe: Resolver }>;
  Trip: Record<string, Resolver>;
  TripItem: Record<string, Resolver>;
} = {
  Query: {
    listMyTrips: async (_, __, ctx) => {
      const rows = await listTripsForUser(ctx.db, ctx.currentUserId);
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
      await assertTripMember(ctx.db, id, ctx.currentUserId);
      const row = await getTrip(ctx.db, id);
      return row ? buildTrip(ctx.db, row, ctx.currentUserId) : null;
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
      const row = await ctx.db.prepare('SELECT * FROM users WHERE email = ?').get<UserRow>(email);
      return row ? toProfile(row) : null;
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
      const row = await ctx.db
        .prepare(
          `SELECT t.id, t.name, t.destination_name, u.display_name AS owner_name, i.email AS invited_email
           FROM invitations i
           JOIN trips t ON t.id = i.trip_id
           JOIN users u ON u.id = t.owner_id
           WHERE i.code = ?`,
        )
        .get<{ id: string; name: string; destination_name: string | null; owner_name: string | null; invited_email: string }>(
          code,
        );
      if (!row) return null;
      return {
        id: row.id,
        name: row.name,
        destinationName: row.destination_name ?? '',
        ownerName: row.owner_name ?? '',
        invitedEmail: row.invited_email,
      };
    },

    getMyProfile: async (_, __, ctx) => {
      const row = await ctx.db.prepare('SELECT * FROM users WHERE id = ?').get<UserRow>(ctx.currentUserId);
      return row ? toProfile(row) : null;
    },

    suggestionChats: (_, args, ctx) => {
      const { tripId, day } = args as Args<{ tripId: string; day?: string | null }>;
      return listSuggestionChats(ctx.db, tripId, ctx.currentUserId, day ?? null);
    },

    getMyInterests: async (_, __, ctx) => {
      const userId = await requireCurrentUser(ctx.db, ctx.currentUserId);
      return listUserInterests(ctx.db, userId);
    },

    getLlmSettings: async () => {
      try {
        return await agentLlmConfig();
      } catch {
        return LLM_DEMO_SETTINGS;
      }
    },
  },

  Mutation: {
    registerUser: async (_, args, ctx) => {
      const { input } = args as Args<{ input: RegisterUserInput }>;
      const displayName = input.displayName.trim();
      const email = slugEmail(displayName);
      const existing = await ctx.db.prepare('SELECT * FROM users WHERE email = ?').get<UserRow>(email);
      if (existing) return toProfile(existing);
      const id = randomUUID();
      await ctx.db
        .prepare('INSERT INTO users (id, email, display_name, color) VALUES (?, ?, ?, ?)')
        .run(id, email, displayName, '#64748b');
      return { userId: id, email, displayName };
    },

    createTrip: async (_, args, ctx) => {
      const { input } = args as Args<{ input: CreateTripInput }>;
      const trip = await createTripRow(ctx.db, ctx.currentUserId, {
        name: input.name,
        destinationId: input.destinationId,
        destinationName: input.destinationName,
        startDate: input.startDate,
        endDate: input.endDate,
        totalBudget: input.totalBudget,
        timezone: normalizeTimeZone(null),
      });
      publishTrip(ctx, trip.id, 'createTrip', { id: trip.id, name: input.name }, ctx.currentUserId);
      return buildTrip(ctx.db, trip, ctx.currentUserId);
    },

    updateTripSettings: async (_, args, ctx) => {
      const { id, input } = args as Args<{ id: string; input: UpdateTripSettingsInput }>;
      const trip = await tripOrThrow(ctx.db, id);
      const name = input.name ?? trip.name;
      await updateTripSettingsRow(ctx.db, id, {
        name,
        startDate: input.startDate ?? trip.start_date,
        endDate: input.endDate ?? trip.end_date,
        destinationId: input.destinationId ?? trip.destination_id,
        destinationName: input.destinationName ?? trip.destination_name,
      });
      publishTrip(ctx, id, 'updateTripSettings', { id, name }, ctx.currentUserId);
      return buildTrip(ctx.db, await tripOrThrow(ctx.db, id), ctx.currentUserId);
    },

    setBudget: async (_, args, ctx) => {
      const { tripId, totalBudget } = args as Args<{ tripId: string; totalBudget: number }>;
      await setBudgetRow(ctx.db, tripId, totalBudget);
      publishTrip(ctx, tripId, 'setBudget', { tripId, totalBudget }, ctx.currentUserId);
      return buildTrip(ctx.db, await tripOrThrow(ctx.db, tripId), ctx.currentUserId);
    },

    inviteMember: async (_, args, ctx) => {
      const { tripId, userId, email, displayName, role } = args as Args<{
        tripId: string;
        userId?: string | null;
        email?: string | null;
        displayName?: string | null;
        role: string;
      }>;
      const user = await ensureUser(ctx.db, { userId, email, displayName });
      await inviteMemberRow(ctx.db, tripId, user.id, role);
      publishTrip(ctx, tripId, 'inviteMember', { tripId, userId: user.id, role }, ctx.currentUserId);
      return buildTrip(ctx.db, await tripOrThrow(ctx.db, tripId), ctx.currentUserId);
    },

    updateMemberRole: async (_, args, ctx) => {
      const { tripId, userId, role } = args as Args<{ tripId: string; userId: string; role: string }>;
      await assertTripMember(ctx.db, tripId, ctx.currentUserId);
      const trip = await tripOrThrow(ctx.db, tripId);
      if (trip.owner_id !== ctx.currentUserId) {
        throw gqlError('NOT_TRIP_OWNER', 'Solo el propietario puede cambiar los roles.');
      }
      if (role !== 'editor' && role !== 'viewer') {
        throw gqlError('INVALID_MEMBER_ROLE', 'Rol de miembro no vÃ¡lido.');
      }
      if (userId === trip.owner_id) {
        throw gqlError('OWNER_ROLE_PROTECTED', 'El rol del propietario no se puede cambiar.');
      }
      if (!(await isTripMember(ctx.db, tripId, userId))) {
        throw gqlError('MEMBER_NOT_FOUND', 'Miembro no encontrado.');
      }
      await updateMemberRoleRow(ctx.db, tripId, userId, role);
      publishTrip(ctx, tripId, 'updateMemberRole', { tripId, userId, role }, ctx.currentUserId);
      return buildTrip(ctx.db, await tripOrThrow(ctx.db, tripId), ctx.currentUserId);
    },

    removeMember: async (_, args, ctx) => {
      const { tripId, userId } = args as Args<{ tripId: string; userId: string }>;
      await assertTripMember(ctx.db, tripId, ctx.currentUserId);
      const trip = await tripOrThrow(ctx.db, tripId);
      if (trip.owner_id !== ctx.currentUserId) {
        throw gqlError('NOT_TRIP_OWNER', 'Solo el propietario puede eliminar miembros.');
      }
      if (userId === trip.owner_id) {
        throw gqlError('OWNER_CANNOT_BE_REMOVED', 'El propietario no se puede eliminar: transfiere la propiedad primero.');
      }
      if (!(await isTripMember(ctx.db, tripId, userId))) {
        throw gqlError('MEMBER_NOT_FOUND', 'Miembro no encontrado.');
      }
      await removeMemberRow(ctx.db, tripId, userId);
      publishTrip(ctx, tripId, 'removeMember', { tripId, userId }, ctx.currentUserId);
      return buildTrip(ctx.db, await tripOrThrow(ctx.db, tripId), ctx.currentUserId);
    },

    leaveTrip: async (_, args, ctx) => {
      const { tripId, newOwnerId } = args as Args<{ tripId: string; newOwnerId?: string | null }>;
      const trip = await tripOrThrow(ctx.db, tripId);
      const role = await getMemberRole(ctx.db, tripId, ctx.currentUserId);
      if (!role) throw gqlError('NOT_TRIP_MEMBER', 'Solo los miembros pueden salir del viaje.');

      if (trip.owner_id !== ctx.currentUserId) {
        await removeMemberRow(ctx.db, tripId, ctx.currentUserId);
        publishTrip(ctx, tripId, 'leaveTrip', { tripId, userId: ctx.currentUserId }, ctx.currentUserId);
        return buildTrip(ctx.db, await tripOrThrow(ctx.db, tripId), ctx.currentUserId);
      }

      if (!newOwnerId) throw gqlError('OWNER_MUST_TRANSFER', 'Debes transferir la propiedad antes de salir.');
      if (newOwnerId === ctx.currentUserId) {
        throw gqlError('INVALID_TRANSFER_TARGET', 'El nuevo propietario debe ser otro miembro del viaje.');
      }
      try {
        await transferOwnershipAndLeave(ctx.db, tripId, ctx.currentUserId, newOwnerId);
      } catch (e) {
        throw gqlError('INVALID_TRANSFER_TARGET', e instanceof Error ? e.message : 'Transferencia no vÃ¡lida.');
      }
      publishTrip(ctx, tripId, 'leaveTrip', { tripId, userId: ctx.currentUserId, newOwnerId }, ctx.currentUserId);
      return buildTrip(ctx.db, await tripOrThrow(ctx.db, tripId), ctx.currentUserId);
    },

    deleteTrip: async (_, args, ctx) => {
      const { tripId } = args as Args<{ tripId: string }>;
      const trip = await tripOrThrow(ctx.db, tripId);
      if (!(await isTripMember(ctx.db, tripId, ctx.currentUserId))) {
        throw gqlError('NOT_TRIP_MEMBER', 'Solo los miembros del viaje pueden eliminarlo.');
      }
      if (trip.owner_id !== ctx.currentUserId) {
        throw gqlError('NOT_TRIP_OWNER', 'Solo el propietario puede eliminar el viaje.');
      }
      await removeAttachmentsByTrip(ctx.db, ctx.storage, tripId);
      await removeTripCoverFiles(ctx.storage, tripId);
      await deleteTripCascade(ctx.db, tripId);
      publishTrip(ctx, tripId, 'deleteTrip', { id: tripId }, ctx.currentUserId);
      return tripId;
    },

    updateTripCover: async (_, args, ctx) => {
      const { tripId, input } = args as Args<{
        tripId: string;
        input: { coverPreset?: string | null; coverPhotoDataUrl?: string | null; removePhoto?: boolean | null };
      }>;
      const trip = await tripOrThrow(ctx.db, tripId);
      if (trip.owner_id !== ctx.currentUserId) {
        throw gqlError('NOT_TRIP_OWNER', 'Solo el propietario puede cambiar la portada.');
      }

      if (input.coverPreset != null && input.coverPreset !== '') {
        if (!isValidCoverPreset(input.coverPreset)) {
          throw gqlError('INVALID_COVER_PRESET', 'Preset de portada no vÃ¡lido.');
        }
        await removeTripCoverFiles(ctx.storage, tripId);
        await ctx.db
          .prepare('UPDATE trips SET cover_preset = ?, cover_photo_url = NULL, updated_at = now() WHERE id = ?')
          .run(input.coverPreset, tripId);
      } else if (input.coverPhotoDataUrl) {
        let decoded: { ext: string; buffer: Buffer };
        try {
          decoded = decodeAvatarDataUrl(input.coverPhotoDataUrl);
        } catch {
          throw gqlError('INVALID_IMAGE', 'Formato de imagen no vÃ¡lido: usa PNG, JPG o WebP (mÃ¡x 2MB).');
        }
        await removeTripCoverFiles(ctx.storage, tripId);
        let relPath: string;
        try {
          relPath = await writeCoverPhoto(ctx.storage, tripId, decoded.ext, decoded.buffer);
        } catch (e) {
          throw gqlError('COVER_UPLOAD_FAILED', e instanceof Error ? e.message : 'No se pudo guardar la portada.');
        }
        await ctx.db
          .prepare('UPDATE trips SET cover_photo_url = ?, updated_at = now() WHERE id = ?')
          .run(relPath, tripId);
      } else if (input.removePhoto) {
        await removeTripCoverFiles(ctx.storage, tripId);
        await ctx.db.prepare('UPDATE trips SET cover_photo_url = NULL, updated_at = now() WHERE id = ?').run(tripId);
      }

      publishTrip(ctx, tripId, 'updateTripCover', { tripId }, ctx.currentUserId);
      return buildTrip(ctx.db, await tripOrThrow(ctx.db, tripId), ctx.currentUserId);
    },

    addItem: async (_, args, ctx) => {
      const { tripId, input } = args as Args<{ tripId: string; input: AddItemInput }>;
      await assertCanEditTrip(ctx.db, tripId, ctx.currentUserId);
      const row = await addItemRow(ctx.db, tripId, ctx.currentUserId, {
        locationId: input.activityId ?? null,
        locationText: normalizeLocationText(input.locationText),
        title: input.title,
        category: input.category,
        cost: input.cost ?? 0,
        day: input.day ?? '',
        order: input.order ?? 0,
        startTime: input.startTime ?? null,
        notes: input.notes ?? null,
        imageUrl: input.imageUrl ?? null,
      });
      await recomputeItemReminder(ctx.db, row.id);
      publishTrip(ctx, tripId, 'addItem', { id: row.id, tripId, title: input.title }, ctx.currentUserId);
      return toTripItem(row);
    },

    updateItem: async (_, args, ctx) => {
      const { tripId, itemId, input } = args as Args<{ tripId: string; itemId: string; input: UpdateItemInput }>;
      await assertCanEditTrip(ctx.db, tripId, ctx.currentUserId);
      const item = await getItem(ctx.db, tripId, itemId);
      if (!item) throw gqlError('ITEM_NOT_FOUND', 'Item not found');
      const nextStartTime = input.startTime === undefined ? item.start_time : input.startTime?.trim() || null;
      const nextLocationText =
        input.locationText === undefined ? item.location_text : normalizeLocationText(input.locationText);
      await updateItemFields(ctx.db, itemId, {
        day: input.day ?? item.day,
        order: input.order ?? item.order,
        startTime: nextStartTime,
        notes: input.notes ?? item.notes,
        title: input.title ?? item.title,
        locationText: nextLocationText,
      });
      await recomputeItemReminder(ctx.db, itemId);
      publishTrip(ctx, tripId, 'updateItem', { itemId, tripId }, ctx.currentUserId);
      const updated = await getItem(ctx.db, tripId, itemId);
      return toTripItem(updated as ItemRow);
    },

    setItemReminder: async (_, args, ctx) => {
      const { itemId, enabled } = args as Args<{ itemId: string; enabled: boolean }>;
      const item = await ctx.db.prepare('SELECT * FROM trip_items WHERE id = ?').get<ItemRow>(itemId);
      if (!item) throw gqlError('ITEM_NOT_FOUND', 'Item not found');
      await assertCanEditTrip(ctx.db, item.trip_id, ctx.currentUserId);
      if (!enabled) {
        await ctx.db
          .prepare('UPDATE trip_items SET reminder_enabled = 0, reminder_sent = 1, reminder_due_at = NULL WHERE id = ?')
          .run(itemId);
      } else {
        await ctx.db.prepare('UPDATE trip_items SET reminder_enabled = 1 WHERE id = ?').run(itemId);
        await recomputeItemReminder(ctx.db, itemId);
      }
      publishTrip(ctx, item.trip_id, 'setItemReminder', { itemId, tripId: item.trip_id, enabled }, ctx.currentUserId);
      const updated = await ctx.db.prepare('SELECT * FROM trip_items WHERE id = ?').get<ItemRow>(itemId);
      return toTripItem(updated as ItemRow);
    },

    setItemCost: async (_, args, ctx) => {
      const { tripId, itemId, cost } = args as Args<{ tripId: string; itemId: string; cost: number }>;
      await assertCanEditTrip(ctx.db, tripId, ctx.currentUserId);
      const item = await getItem(ctx.db, tripId, itemId);
      if (!item) throw gqlError('ITEM_NOT_FOUND', 'Item not found');
      await setItemCostRow(ctx.db, itemId, cost);
      publishTrip(ctx, tripId, 'setItemCost', { itemId, tripId, cost }, ctx.currentUserId);
      const updated = await getItem(ctx.db, tripId, itemId);
      return toTripItem(updated as ItemRow);
    },

    moveItem: async (_, args, ctx) => {
      const { tripId, itemId, day, order } = args as Args<{ tripId: string; itemId: string; day: string; order: number }>;
      await assertCanEditTrip(ctx.db, tripId, ctx.currentUserId);
      const item = await getItem(ctx.db, tripId, itemId);
      if (!item) throw gqlError('ITEM_NOT_FOUND', 'Item not found');
      await moveItemRow(ctx.db, itemId, day, order);
      publishTrip(ctx, tripId, 'moveItem', { itemId, tripId, day, order }, ctx.currentUserId);
      const updated = await getItem(ctx.db, tripId, itemId);
      return toTripItem(updated as ItemRow);
    },

    removeItem: async (_, args, ctx) => {
      const { tripId, itemId } = args as Args<{ tripId: string; itemId: string }>;
      await assertCanEditTrip(ctx.db, tripId, ctx.currentUserId);
      const item = await getItem(ctx.db, tripId, itemId);
      if (!item) throw gqlError('ITEM_NOT_FOUND', 'Item not found');
      await removeItemRow(ctx.db, itemId);
      publishTrip(ctx, tripId, 'removeItem', { itemId, tripId }, ctx.currentUserId);
      return toTripItem(item);
    },

    touchPresence: async (_, args, ctx) => {
      const { input } = args as Args<{
        input: { tripId: string; displayName: string; color: string | null; editingItemId?: string | null };
      }>;
      await assertTripMember(ctx.db, input.tripId, ctx.currentUserId);
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
      await assertTripMember(ctx.db, tripId, ctx.currentUserId);
      const trip = await getTrip(ctx.db, tripId);
      const items = await ctx.db
        .prepare('SELECT location_id, title, cost FROM trip_items WHERE trip_id = ?')
        .all<{ location_id: string | null; title: string | null; cost: number | null }>(tripId);
      const suggestions = await buildSuggestions(
        ctx.catalogue,
        trip as TripRow | null,
        items.map((i) => ({ activity_id: i.location_id, title: i.title, cost: i.cost })),
      );
      return { day, items: suggestions };
    },

    sendTripInvite: async (_, args, ctx) => {
      const { tripId, email, role } = args as Args<{ tripId: string; email: string; role?: string | null }>;
      const normalized = email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
        throw gqlError('INVALID_EMAIL', 'Email no vÃ¡lido');
      }
      const requestedRole = (typeof role === 'string' ? role.trim().toLowerCase() : '') || 'viewer';
      if (requestedRole !== 'editor' && requestedRole !== 'viewer') {
        throw gqlError('INVALID_INVITE_ROLE', 'Rol de invitaciÃ³n no vÃ¡lido');
      }
      const inviteRole = requestedRole as 'editor' | 'viewer';
      await tripOrThrow(ctx.db, tripId);
      const myRole = await getMemberRole(ctx.db, tripId, ctx.currentUserId);
      if (myRole !== 'owner' && myRole !== 'editor') {
        throw gqlError('FORBIDDEN_INVITE', 'Solo el propietario o un editor puede invitar');
      }

      const invitation = await createInvitation(ctx.db, {
        tripId,
        email: normalized,
        role: inviteRole,
        createdBy: ctx.currentUserId,
      });
      const joinUrl = buildJoinUrl(tripId, invitation.code);
      publishTrip(ctx, tripId, 'inviteSent', { tripId, email: invitation.email }, ctx.currentUserId);
      return {
        invitationId: invitation.id,
        status: invitation.status,
        email: invitation.email,
        code: invitation.code,
        joinUrl,
      };
    },

    joinTripWithCode: async (_, args, ctx) => {
      const { code, email } = args as Args<{ code: string; email: string }>;
      if (!isInviteCodeValid(code)) throw gqlError('INVALID_INVITE_CODE', 'CÃ³digo de invitaciÃ³n no vÃ¡lido');
      const invitation = await findInvitationByCode(ctx.db, code);
      if (!invitation) throw gqlError('INVITE_CODE_NOT_FOUND', 'CÃ³digo de invitaciÃ³n no encontrado');
      if (invitation.status !== 'pending') throw gqlError('INVITE_ALREADY_USED', 'Esta invitaciÃ³n ya fue usada');
      if (!isEmailMatch(invitation, email)) throw gqlError('INVITE_EMAIL_MISMATCH', 'El email no coincide con la invitaciÃ³n');

      await ctx.db
        .prepare('INSERT INTO trip_members (trip_id, user_id, role) VALUES (?, ?, ?) ON CONFLICT DO NOTHING')
        .run(invitation.trip_id, ctx.currentUserId, invitation.role);
      await ctx.db.prepare('UPDATE users SET email = ? WHERE id = ?').run(invitation.email, ctx.currentUserId);
      await acceptInvitation(ctx.db, invitation.id);
      publishTrip(
        ctx,
        invitation.trip_id,
        'joinTrip',
        { tripId: invitation.trip_id, userId: ctx.currentUserId },
        ctx.currentUserId,
      );
      return buildTrip(ctx.db, await tripOrThrow(ctx.db, invitation.trip_id), ctx.currentUserId);
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
        const row = await updateMyProfile(ctx.db, ctx.storage, ctx.currentUserId, {
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
      const tripId = await findItemTrip(ctx.db, itemId);
      if (!tripId || (requestedTripId && requestedTripId !== tripId)) {
        throw gqlError('ITEM_NOT_FOUND', 'Actividad no encontrada.');
      }
      if (!(await isTripMember(ctx.db, tripId, ctx.currentUserId))) {
        throw gqlError('NOT_TRIP_MEMBER', 'Solo los miembros del viaje pueden subir boletos.');
      }
      const viewerIds = [...new Set(rawViewerIds ?? [])];
      if ((await invalidAttachmentViewers(ctx.db, tripId, viewerIds)).length > 0) {
        throw gqlError('INVALID_VIEWER', 'Todos los viewers deben ser miembros del viaje.');
      }
      try {
        const created = await addAttachment(
          ctx.db,
          ctx.storage,
          itemId,
          ctx.currentUserId,
          { fileName: input.fileName, mimeType: input.mimeType, dataUrl: input.dataUrl },
          viewerIds,
        );
        const attachment = (await getAttachmentForUser(ctx.db, ctx.storage, created.id, ctx.currentUserId)) ?? created;
        publishTrip(ctx, tripId, 'addAttachment', { itemId, attachmentId: attachment.id }, ctx.currentUserId);
        return attachment;
      } catch (e) {
        throw gqlError('ATTACHMENT_UPLOAD_FAILED', e instanceof Error ? e.message : 'No se pudo subir el archivo.');
      }
    },

    updateAttachmentViewers: async (_, args, ctx) => {
      const { attachmentId, viewerIds: rawViewerIds } = args as Args<{
        attachmentId: string;
        viewerIds?: string[] | null;
      }>;
      const row = await findAttachment(ctx.db, attachmentId);
      const info = await findAttachmentItemTrip(ctx.db, attachmentId);
      if (!row || !info) throw gqlError('ATTACHMENT_NOT_FOUND', 'Archivo no encontrado.');
      if (row.created_by !== ctx.currentUserId) {
        throw gqlError('FORBIDDEN_ATTACHMENT', 'Solo quien subiÃ³ el archivo puede editar sus permisos.');
      }
      const viewerIds = [...new Set(rawViewerIds ?? [])].filter((viewerId) => viewerId !== ctx.currentUserId);
      if ((await invalidAttachmentViewers(ctx.db, info.tripId, viewerIds)).length > 0) {
        throw gqlError('INVALID_VIEWER', 'Todos los viewers deben ser miembros del viaje.');
      }
      await replaceAttachmentViewers(ctx.db, attachmentId, viewerIds);
      const attachment = await getAttachmentForUser(ctx.db, ctx.storage, attachmentId, ctx.currentUserId);
      publishTrip(ctx, info.tripId, 'updateAttachmentViewers', { attachmentId }, ctx.currentUserId);
      return attachment;
    },

    removeItemAttachment: async (_, args, ctx) => {
      const { attachmentId } = args as Args<{ attachmentId: string }>;
      const row = await findAttachment(ctx.db, attachmentId);
      const info = await findAttachmentItemTrip(ctx.db, attachmentId);
      if (!row || !info) throw gqlError('ATTACHMENT_NOT_FOUND', 'Archivo no encontrado.');
      if (!(await isTripMember(ctx.db, info.tripId, ctx.currentUserId))) {
        throw gqlError('NOT_TRIP_MEMBER', 'Solo los miembros del viaje pueden quitar boletos.');
      }
      if (row.created_by !== ctx.currentUserId) {
        throw gqlError('FORBIDDEN_ATTACHMENT', 'Solo quien subiÃ³ el archivo puede eliminarlo.');
      }
      const attachment = await getAttachmentForUser(ctx.db, ctx.storage, attachmentId, ctx.currentUserId);
      await removeAttachment(ctx.db, ctx.storage, attachmentId);
      publishTrip(ctx, info.tripId, 'removeAttachment', { attachmentId }, ctx.currentUserId);
      return attachment;
    },

    setMyInterests: async (_, args, ctx) => {
      const { terms } = args as Args<{ terms: string[] }>;
      const userId = await requireCurrentUser(ctx.db, ctx.currentUserId);
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
      await requireCurrentUser(ctx.db, ctx.currentUserId);
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

    favoriteLocation: async (_, args, ctx) => {
      const { locationId, favorite } = args as Args<{ locationId: string; favorite: boolean }>;
      try {
        const state = await setFavorite(ctx.db, ctx.currentUserId, locationId, favorite, async (id) =>
          Boolean(await ctx.catalogue.getById(id)),
        );
        return { locationId, favorite: state };
      } catch (e) {
        throw gqlError('FAVORITE_SAVE_FAILED', e instanceof Error ? e.message : 'No se pudo actualizar el favorito.');
      }
    },

    saveSuggestionChat: async (_, args, ctx) => {
      const { tripId, day, messages } = args as Args<{
        tripId: string;
        day: string;
        messages: { role: string; content: string }[];
      }>;
      await tripOrThrow(ctx.db, tripId);
      if (!(await isTripMember(ctx.db, tripId, ctx.currentUserId))) {
        throw gqlError('NOT_TRIP_MEMBER', 'Solo los miembros del viaje pueden guardar el chat.');
      }
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
        await assertTripMember(ctx.db, tripId, ctx.currentUserId);
        return ctx.pubsub.subscribe(`trip:${tripId}`);
      },
    },
    onPresenceChanged: {
      subscribe: async (_, args, ctx) => {
        const { tripId } = args as Args<{ tripId: string }>;
        await assertTripMember(ctx.db, tripId, ctx.currentUserId);
        return ctx.pubsub.subscribe(`presence:${tripId}`);
      },
    },
  },

  Trip: {
    destinationLat: async (parent, __, ctx) => {
      const { destinationLat, destinationId } = parent as { destinationLat?: number | null; destinationId?: string | null };
      if (destinationLat != null) return destinationLat;
      if (!destinationId) return null;
      return (await ctx.catalogue.getById(destinationId))?.lat ?? null;
    },
    destinationLng: async (parent, __, ctx) => {
      const { destinationLng, destinationId } = parent as { destinationLng?: number | null; destinationId?: string | null };
      if (destinationLng != null) return destinationLng;
      if (!destinationId) return null;
      return (await ctx.catalogue.getById(destinationId))?.lng ?? null;
    },
    items: (parent) => (parent as TripGql).items,
    members: (parent) => (parent as TripGql).members,
  },

  TripItem: {
    attachments: (parent, __, ctx) => {
      const { id } = parent as { id: string };
      return listAttachmentsByItem(ctx.db, ctx.storage, id, ctx.currentUserId);
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
