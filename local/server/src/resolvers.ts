// Resolvers GraphQL del servidor local: mismas operaciones que AppSync sobre SQLite.

import { randomUUID } from 'node:crypto';
import { GraphQLError } from 'graphql';
import { toProfile } from './auth.ts';
import { listPresence, touchPresence } from './presence.ts';
import { upsertLocation } from './db.ts';
import { buildSuggestions } from './recommend.ts';
import { normalizeHasDataPlace } from './hasdata/normalize.ts';
import { HasDataClient } from './hasdata/client.ts';
import {
  createInvitation,
  findInvitationByCode,
  acceptInvitation,
  isEmailMatch,
  isInviteCodeValid,
} from './invitations.ts';
import { sendInviteEmail, sendWelcomeEmail, sendVerificationEmail, buildJoinUrl } from './email.ts';
import { updateMyProfile, isValidLanguage, decodeAvatarDataUrl } from './profile.ts';
import { verifyFirebaseIdToken, AuthTokenError, type TokenVerifier } from './auth/verify.ts';
import { upsertUserByEmail, markWelcomeSent } from './auth/users.ts';
import { generateVerificationLink, OobError, type OobLinkResult } from './auth/oob.ts';
import { setEmailVerified, isUserNotFoundError } from './auth/admin.ts';
import { getServiceAccountPrivateKey } from './auth/service-account.ts';
import {
  verifyVerificationToken,
  consumeVerificationJti,
  VerificationTokenError,
  type VerifiedVerificationToken,
} from './auth/verify-token.ts';
import { tryReserveVerification } from './auth/rate-limit.ts';
import {
  addAttachment,
  removeAttachment,
  listAttachmentsByItem,
  findAttachmentItemTrip,
  findAttachment,
  findItemTrip,
  isTripMember,
  invalidAttachmentViewers,
  replaceAttachmentViewers,
  getAttachmentForUser,
  removeAttachmentsByTrip,
} from './attachments.ts';
import { setFavorite, favoriteIdsForUser, isFavorite } from './favorites.ts';
import {
  listUserInterests,
  replaceUserInterests,
  syncInterestsToAgent,
  type InterestsSync,
} from './interests.ts';
import { listSuggestionChats, upsertSuggestionChat, isValidMessages } from './chats.ts';
import { recomputeItemReminder } from './reminders.ts';
import {
  isValidCoverPreset,
  writeCoverPhoto,
  removeTripCoverFiles,
} from './covers.ts';
import {
  locationRowToGraphQL,
  searchLocations,
  extractPlaceDetail,
  webResultsToSocialLinks,
} from './hasdata/search.ts';
import type {
  Db,
  LocationRow,
  Profile,
  Trip,
  TripItem,
  TripMember,
  TripRow,
  UserRow,
} from './schema-types.ts';

// ---- Tipos internos de resolvers ----

export interface PubSub {
  publish(topic: string, payload: Record<string, unknown>): void;
  subscribe(topic: string): AsyncIterable<unknown>;
}

export interface Ctx {
  db: Db;
  currentUserId: string;
  hasdata: HasDataClient | null;
  pubsub: PubSub;
  // Inyecciones de auth (solo tests; en produccion se usan los singletons reales).
  verifyToken?: TokenVerifier;
  sendWelcome?: (email: string, name: string) => Promise<unknown>;
  sendVerification?: (email: string, link: string, name?: string) => Promise<unknown>;
  generateVerification?: (idToken: string) => Promise<OobLinkResult>;
  confirmVerification?: (uid: string) => Promise<void>;
  // Sync best-effort de intereses al agente (inyectable en tests).
  syncInterests?: InterestsSync;
}

export type Resolver = (parent: unknown, args: Record<string, unknown>, ctx: Ctx) => unknown;

type Args<T> = T;

interface TripFullRow {
  id: string;
  name: string;
  description: string | null;
  destination_id: string | null;
  destination_name: string | null;
  start_date: string | null;
  end_date: string | null;
  cover_image_url: string | null;
  cover_preset: string | null;
  cover_photo_url: string | null;
  total_budget: number | null;
  owner_id: string;
  invite_code: string | null;
  status: string | null;
  currency: string | null;
  timezone: string | null;
  created_at: string;
  updated_at: string;
}

interface ItemRow {
  id: string;
  trip_id: string;
  day: string | null;
  order: number | null;
  location_id: string | null;
  location_text: string | null;
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
}

interface MemberGql {
  userId: string;
  displayName: string | null;
  email: string | null;
  role: string;
  joinedAt: string | null;
}

interface RegisterUserInput {
  displayName: string;
}

interface CreateTripInput {
  name: string;
  destinationId?: string | null;
  destinationName?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  totalBudget?: number | null;
  timezone?: string | null;
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

// ---- mappers fila -> GraphQL ----

const MAX_LOCATION_TEXT = 200;

// Ubicacion escrita a mano: trim, vacio -> null y recorte silencioso a 200.
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

interface TripGql {
  id: string;
  name: string;
  destinationId: string;
  destinationName: string;
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

function buildTrip(db: Db, tripRow: TripFullRow, currentUserId: string): TripGql {
  const members = (db.prepare(`
    SELECT m.user_id, m.role, m.joined_at, u.display_name, u.email, u.color, u.avatar_url
    FROM trip_members m
    JOIN users u ON u.id = m.user_id
    WHERE m.trip_id = ?
    ORDER BY m.joined_at ASC
  `).all(tripRow.id) as unknown as MemberRow[]).map(toMember);

  const items = (db.prepare(`
    SELECT * FROM trip_items WHERE trip_id = ? ORDER BY day ASC, "order" ASC
  `).all(tripRow.id) as unknown as ItemRow[]).map(toTripItem);

  const spent = items.reduce((s, i) => s + (i.cost ?? 0), 0);
  const byCat = new Map<string, number>();
  for (const i of items) {
    const c = i.category ?? 'activity';
    byCat.set(c, (byCat.get(c) ?? 0) + (i.cost ?? 0));
  }
  const spentByCategory = [...byCat.entries()].map(([category, amount]) => ({ category, amount }));

  const myRoleRow = db.prepare(
    'SELECT role FROM trip_members WHERE trip_id = ? AND user_id = ?'
  ).get(tripRow.id, currentUserId) as { role: string } | undefined;

  return {
    id: tripRow.id,
    name: tripRow.name,
    destinationId: tripRow.destination_id ?? '',
    destinationName: tripRow.destination_name ?? '',
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
    myRole: myRoleRow?.role ?? 'viewer',
    createdAt: tripRow.created_at,
    updatedAt: tripRow.updated_at,
  };
}

// ---- helpers ----

function slugEmail(displayName: string | null | undefined): string {
  const slug = (displayName ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'user';
  return `${slug}@demo.local`;
}

interface EnsureUserInput {
  userId?: string | null;
  email?: string | null;
  displayName?: string | null;
}

function ensureUser(db: Db, { userId, email, displayName }: EnsureUserInput): UserRow {
  let user = userId
    ? (db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow | undefined)
    : undefined;
  if (!user && email) user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined;
  if (user) return user;
  const id = userId ?? randomUUID();
  const em = email ?? slugEmail(displayName ?? 'member');
  const dn = displayName ?? 'Member';
  db.prepare('INSERT OR IGNORE INTO users (id, email, display_name, color) VALUES (?, ?, ?, ?)')
    .run(id, em, dn, '#64748b');
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown as UserRow;
}

function getTripOrNull(db: Db, tripId: string): TripFullRow | null {
  const row = db.prepare('SELECT * FROM trips WHERE id = ?').get(tripId) as TripFullRow | undefined;
  return row ?? null;
}

function publishTrip(ctx: Ctx, tripId: string, mutationType: string, entity: unknown, actorId: string): void {
  ctx.pubsub.publish(`trip:${tripId}`, {
    onTripChanged: {
      tripId,
      mutationType,
      entity: JSON.stringify(entity),
      actorId,
    },
  });
}

const nowIso = () => new Date().toISOString();

// Zona horaria IANA del viaje; vacia/invalida -> 'UTC' (nunca rompe createTrip).
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

// Regla del proyecto (STD): cada GraphQLError lleva un extensions.code estable y
// unico (SCREAMING_SNAKE). El mensaje en espanol se mantiene como fallback; el
// cliente traduce por codigo.
function gqlError(code: string, message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code } });
}

// Regla de seguridad (REQ a96d80be): toda lectura/escritura de datos de un
// viaje exige membresía; las escrituras del itinerario exigen owner/editor.
function assertTripMember(db: Db, tripId: string, userId: string): void {
  if (!isTripMember(db, tripId, userId)) {
    throw gqlError('NOT_TRIP_MEMBER', 'No eres miembro de este viaje.');
  }
}

function assertCanEditTrip(db: Db, tripId: string, userId: string): void {
  assertTripMember(db, tripId, userId);
  const row = db
    .prepare('SELECT role FROM trip_members WHERE trip_id = ? AND user_id = ?')
    .get(tripId, userId) as { role: string } | undefined;
  if (row?.role !== 'owner' && row?.role !== 'editor') {
    throw gqlError('FORBIDDEN_EDIT', 'Solo el propietario o un editor puede modificar el itinerario.');
  }
}

// Identidad obligatoria para datos personales (intereses): sin usuario resuelto
// o con un id que ya no existe en users, no hay a quien atribuir la lista.
function requireCurrentUser(db: Db, userId: string): string {
  if (!userId) throw gqlError('AUTH_REQUIRED', 'Necesitas iniciar sesión.');
  const row = db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId);
  if (!row) throw gqlError('AUTH_REQUIRED', 'Necesitas iniciar sesión.');
  return userId;
}

// ---- resolvers ----

export const resolvers: {
  Query: Record<string, Resolver>;
  Mutation: Record<string, Resolver>;
  Subscription: Record<string, { subscribe: Resolver }>;
  Trip: Record<string, Resolver>;
  TripItem: Record<string, Resolver>;
} = {
  Query: {
    listMyTrips: (_, __, ctx) =>
      (ctx.db.prepare(`
        SELECT t.id, t.name, t.destination_name, t.start_date, t.end_date, m.role, m.joined_at
        FROM trip_members m
        JOIN trips t ON t.id = m.trip_id
        WHERE m.user_id = ?
        ORDER BY m.joined_at DESC
      `).all(ctx.currentUserId) as unknown as {
        id: string;
        name: string;
        destination_name: string | null;
        start_date: string | null;
        end_date: string | null;
        role: string;
        joined_at: string | null;
      }[]).map((r) => ({
        tripId: r.id,
        tripName: r.name,
        destinationName: r.destination_name ?? '',
        startDate: r.start_date,
        endDate: r.end_date,
        role: r.role,
        joinedAt: r.joined_at,
      })),

    getTrip: (_, args, ctx) => {
      const { id } = args as Args<{ id: string }>;
      assertTripMember(ctx.db, id, ctx.currentUserId);
      const row = ctx.db.prepare('SELECT * FROM trips WHERE id = ?').get(id) as TripFullRow | undefined;
      return row ? buildTrip(ctx.db, row, ctx.currentUserId) : null;
    },

    listDestinations: (_, __, ctx) =>
      (ctx.db.prepare('SELECT * FROM locations WHERE slug IS NOT NULL ORDER BY name ASC')
        .all() as unknown as LocationRow[]).map(toDestination),

    listActivities: (_, args, ctx) => {
      const { destSlug, category } = args as Args<{ destSlug: string; category?: string | null }>;
      const params: (string | null)[] = [ctx.currentUserId, destSlug];
      let sql = `SELECT l.* FROM locations l
        LEFT JOIN user_favorites fav ON fav.location_id = l.id AND fav.user_id = ?
        WHERE l.parent_id = ? AND l.category IS NOT NULL`;
      if (category) {
        sql += ' AND l.category = ?';
        params.push(category);
      }
      sql +=
        ' ORDER BY CASE WHEN fav.user_id IS NULL THEN 1 ELSE 0 END, l.rating DESC NULLS LAST, l.rating_count DESC NULLS LAST, l.name ASC LIMIT 10';
      const favIds = favoriteIdsForUser(ctx.db, ctx.currentUserId);
      const rows = ctx.db.prepare(sql).all(...params) as unknown as LocationRow[];
      return rows.map((r) => ({ ...toActivity(r), isFavorite: favIds.has(r.id) }));
    },

    listPresence: (_, args) => {
      const { tripId } = args as Args<{ tripId: string }>;
      return listPresence(tripId);
    },

    findUserByEmail: (_, args, ctx) => {
      const { email } = args as Args<{ email: string }>;
      const row = ctx.db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined;
      return row ? toProfile(row) : null;
    },

    searchLocations: async (_, args, ctx) => {
      const { q, lat, lng } = args as Args<{ q: string; lat?: number | null; lng?: number | null }>;
      const rows = await searchLocations({
        db: ctx.db,
        client: ctx.hasdata,
        q,
        lat,
        lng,
        userId: ctx.currentUserId,
      });
      const favIds = favoriteIdsForUser(ctx.db, ctx.currentUserId);
      return rows.map((r) => locationRowToGraphQL(r, favIds));
    },

    locationById: (_, args, ctx) => {
      const { id } = args as Args<{ id: string }>;
      const row = ctx.db.prepare('SELECT * FROM locations WHERE id = ?').get(id) as LocationRow | undefined;
      const favIds = favoriteIdsForUser(ctx.db, ctx.currentUserId);
      return locationRowToGraphQL(row ?? null, favIds);
    },

    locationDetails: async (_, args, ctx) => {
      const { placeId } = args as Args<{ placeId: string }>;
      // Cache-first: si ya tenemos detalle (horarios/web/redes) devolvemos de DB
      const favIds = favoriteIdsForUser(ctx.db, ctx.currentUserId);
      const existing = ctx.db.prepare('SELECT * FROM locations WHERE place_id = ?').get(placeId) as
        | LocationRow
        | undefined;
      const hasDetails = existing && (existing.hours_json || existing.website_url || existing.social_links_json);
      if (hasDetails) return locationRowToGraphQL(existing, favIds);
      if (!ctx.hasdata) return existing ? locationRowToGraphQL(existing, favIds) : null;
      const data = await ctx.hasdata.place(placeId, { fetchWebResults: true });
      const raw = extractPlaceDetail(data) as Record<string, unknown> & {
        gpsCoordinates?: { latitude?: unknown; longitude?: unknown };
      };
      const loc = normalizeHasDataPlace(raw);
      loc.place_id = placeId;
      loc.social_links_json = webResultsToSocialLinks(data) ?? loc.social_links_json;
      // Mantener el id existente (el upsert por place_id ya lo resuelve, pero
      // evitamos crear un id nuevo que rompa items que lo referencian)
      if (existing) loc.id = existing.id;
      // Lugar sin coordenadas (HasData no devolvio gps): no se puede guardar en
      // locations (lat NOT NULL). Devolvemos lo que haya sin romper.
      if (loc.lat == null || loc.lng == null) {
        return existing ? locationRowToGraphQL(existing, favIds) : null;
      }
      const row = upsertLocation(ctx.db, loc);
      return locationRowToGraphQL(row ?? null, favIds);
    },

    getTripByCode: (_, args, ctx) => {
      const { code } = args as Args<{ code: string }>;
      if (!isInviteCodeValid(code)) return null;
      const row = ctx.db.prepare(`
        SELECT t.id, t.name, t.destination_name, u.display_name AS owner_name, i.email AS invited_email
        FROM invitations i
        JOIN trips t ON t.id = i.trip_id
        JOIN users u ON u.id = t.owner_id
        WHERE i.code = ?
      `).get(code) as
        | { id: string; name: string; destination_name: string | null; owner_name: string | null; invited_email: string }
        | undefined;
      if (!row) return null;
      // Preview publico: sin items, miembros ni presupuesto. El email invitado
      // ya viene normalizado (lowercase) desde createInvitation.
      return {
        id: row.id,
        name: row.name,
        destinationName: row.destination_name ?? '',
        ownerName: row.owner_name ?? '',
        invitedEmail: row.invited_email,
      };
    },

    getMyProfile: (_, __, ctx) => {
      const row = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.currentUserId) as
        | UserRow
        | undefined;
      return row ? toProfile(row) : null;
    },

    suggestionChats: (_, args, ctx) => {
      const { tripId, day } = args as Args<{ tripId: string; day?: string | null }>;
      return listSuggestionChats(ctx.db, tripId, ctx.currentUserId, day ?? null);
    },

    getMyInterests: (_, __, ctx) => {
      const userId = requireCurrentUser(ctx.db, ctx.currentUserId);
      return listUserInterests(ctx.db, userId);
    },
  },

  Mutation: {
    registerUser: (_, args, ctx) => {
      const { input } = args as Args<{ input: RegisterUserInput }>;
      const displayName = input.displayName.trim();
      const email = slugEmail(displayName);
      const existing = ctx.db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined;
      if (existing) return toProfile(existing);
      const id = randomUUID();
      ctx.db.prepare('INSERT INTO users (id, email, display_name, color) VALUES (?, ?, ?, ?)')
        .run(id, email, displayName, '#64748b');
      return { userId: id, email, displayName };
    },

    createTrip: (_, args, ctx) => {
      const { input } = args as Args<{ input: CreateTripInput }>;
      const id = randomUUID();
      const inviteCode = randomUUID().slice(0, 8).toUpperCase();
      const now = nowIso();
      const timezone = normalizeTimeZone(input.timezone);
      ctx.db.prepare(`
        INSERT INTO trips
          (id, name, destination_id, destination_name, start_date, end_date, total_budget, timezone, owner_id, invite_code, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, input.name, input.destinationId ?? null, input.destinationName ?? null,
        input.startDate ?? null, input.endDate ?? null, input.totalBudget ?? null,
        timezone, ctx.currentUserId, inviteCode, now, now
      );
      ctx.db.prepare('INSERT INTO trip_members (trip_id, user_id, role) VALUES (?, ?, ?)')
        .run(id, ctx.currentUserId, 'owner');
      publishTrip(ctx, id, 'createTrip', { id, name: input.name }, ctx.currentUserId);
      return buildTrip(ctx.db, getTripOrNull(ctx.db, id)!, ctx.currentUserId);
    },

    updateTripSettings: (_, args, ctx) => {
      const { id, input } = args as Args<{ id: string; input: UpdateTripSettingsInput }>;
      const trip = getTripOrNull(ctx.db, id);
      if (!trip) throw gqlError('TRIP_NOT_FOUND', 'Trip not found');
      const name = input.name ?? trip.name;
      const startDate = input.startDate ?? trip.start_date;
      const endDate = input.endDate ?? trip.end_date;
      const destinationId = input.destinationId ?? trip.destination_id;
      const destinationName = input.destinationName ?? trip.destination_name;
      ctx.db.prepare(`
        UPDATE trips SET name = ?, start_date = ?, end_date = ?, destination_id = ?, destination_name = ?, updated_at = ?
        WHERE id = ?
      `).run(name, startDate, endDate, destinationId, destinationName, nowIso(), id);
      publishTrip(ctx, id, 'updateTripSettings', { id, name }, ctx.currentUserId);
      return buildTrip(ctx.db, getTripOrNull(ctx.db, id)!, ctx.currentUserId);
    },

    setBudget: (_, args, ctx) => {
      const { tripId, totalBudget } = args as Args<{ tripId: string; totalBudget: number }>;
      ctx.db.prepare('UPDATE trips SET total_budget = ?, updated_at = ? WHERE id = ?')
        .run(totalBudget, nowIso(), tripId);
      publishTrip(ctx, tripId, 'setBudget', { tripId, totalBudget }, ctx.currentUserId);
      return buildTrip(ctx.db, getTripOrNull(ctx.db, tripId)!, ctx.currentUserId);
    },

    inviteMember: (_, args, ctx) => {
      const { tripId, userId, email, displayName, role } = args as Args<{
        tripId: string;
        userId?: string | null;
        email?: string | null;
        displayName?: string | null;
        role: string;
      }>;
      const user = ensureUser(ctx.db, { userId, email, displayName });
      ctx.db.prepare('INSERT OR IGNORE INTO trip_members (trip_id, user_id, role) VALUES (?, ?, ?)')
        .run(tripId, user.id, role);
      publishTrip(ctx, tripId, 'inviteMember', { tripId, userId: user.id, role }, ctx.currentUserId);
      return buildTrip(ctx.db, getTripOrNull(ctx.db, tripId)!, ctx.currentUserId);
    },

    updateMemberRole: (_, args, ctx) => {
      const { tripId, userId, role } = args as Args<{ tripId: string; userId: string; role: string }>;
      assertTripMember(ctx.db, tripId, ctx.currentUserId);
      const trip = getTripOrNull(ctx.db, tripId);
      if (!trip) throw gqlError('TRIP_NOT_FOUND', 'Trip not found');
      if (trip.owner_id !== ctx.currentUserId) {
        throw gqlError('NOT_TRIP_OWNER', 'Solo el propietario puede cambiar los roles.');
      }
      if (role !== 'editor' && role !== 'viewer') {
        throw gqlError('INVALID_MEMBER_ROLE', 'Rol de miembro no válido.');
      }
      if (userId === trip.owner_id) {
        throw gqlError('OWNER_ROLE_PROTECTED', 'El rol del propietario no se puede cambiar.');
      }
      const member = ctx.db
        .prepare('SELECT 1 FROM trip_members WHERE trip_id = ? AND user_id = ?')
        .get(tripId, userId);
      if (!member) throw gqlError('MEMBER_NOT_FOUND', 'Miembro no encontrado.');
      ctx.db.prepare('UPDATE trip_members SET role = ? WHERE trip_id = ? AND user_id = ?')
        .run(role, tripId, userId);
      publishTrip(ctx, tripId, 'updateMemberRole', { tripId, userId, role }, ctx.currentUserId);
      return buildTrip(ctx.db, getTripOrNull(ctx.db, tripId)!, ctx.currentUserId);
    },

    removeMember: (_, args, ctx) => {
      const { tripId, userId } = args as Args<{ tripId: string; userId: string }>;
      assertTripMember(ctx.db, tripId, ctx.currentUserId);
      const trip = getTripOrNull(ctx.db, tripId);
      if (!trip) throw gqlError('TRIP_NOT_FOUND', 'Trip not found');
      if (trip.owner_id !== ctx.currentUserId) {
        throw gqlError('NOT_TRIP_OWNER', 'Solo el propietario puede eliminar miembros.');
      }
      if (userId === trip.owner_id) {
        throw gqlError('OWNER_CANNOT_BE_REMOVED', 'El propietario no se puede eliminar: transfiere la propiedad primero.');
      }
      const member = ctx.db
        .prepare('SELECT 1 FROM trip_members WHERE trip_id = ? AND user_id = ?')
        .get(tripId, userId);
      if (!member) throw gqlError('MEMBER_NOT_FOUND', 'Miembro no encontrado.');
      ctx.db.prepare('DELETE FROM trip_members WHERE trip_id = ? AND user_id = ?').run(tripId, userId);
      publishTrip(ctx, tripId, 'removeMember', { tripId, userId }, ctx.currentUserId);
      return buildTrip(ctx.db, getTripOrNull(ctx.db, tripId)!, ctx.currentUserId);
    },

    leaveTrip: (_, args, ctx) => {
      const { tripId, newOwnerId } = args as Args<{ tripId: string; newOwnerId?: string | null }>;
      const trip = getTripOrNull(ctx.db, tripId);
      if (!trip) throw gqlError('TRIP_NOT_FOUND', 'Trip not found');
      const memberRow = ctx.db
        .prepare('SELECT role FROM trip_members WHERE trip_id = ? AND user_id = ?')
        .get(tripId, ctx.currentUserId) as { role: string } | undefined;
      if (!memberRow) throw gqlError('NOT_TRIP_MEMBER', 'Solo los miembros pueden salir del viaje.');

      const isOwner = trip.owner_id === ctx.currentUserId;
      if (!isOwner) {
        // Miembro no-owner: sale y listo.
        ctx.db.prepare('DELETE FROM trip_members WHERE trip_id = ? AND user_id = ?').run(tripId, ctx.currentUserId);
        publishTrip(ctx, tripId, 'leaveTrip', { tripId, userId: ctx.currentUserId }, ctx.currentUserId);
        return buildTrip(ctx.db, getTripOrNull(ctx.db, tripId)!, ctx.currentUserId);
      }

      // Owner: la transferencia es obligatoria.
      if (!newOwnerId) throw gqlError('OWNER_MUST_TRANSFER', 'Debes transferir la propiedad antes de salir.');
      const otherMembers = ctx.db
        .prepare('SELECT user_id FROM trip_members WHERE trip_id = ? AND user_id != ?')
        .all(tripId, ctx.currentUserId) as { user_id: string }[];
      if (otherMembers.length === 0) {
        throw gqlError('NO_MEMBERS_TO_TRANSFER', 'No hay otros miembros a quienes transferir el viaje.');
      }
      if (newOwnerId === ctx.currentUserId || !otherMembers.some((m) => m.user_id === newOwnerId)) {
        throw gqlError('INVALID_TRANSFER_TARGET', 'El nuevo propietario debe ser otro miembro del viaje.');
      }

      // Transaccion atomica: cambio de owner + salida del actual.
      ctx.db.exec('BEGIN');
      try {
        ctx.db.prepare('UPDATE trips SET owner_id = ?, updated_at = ? WHERE id = ?').run(
          newOwnerId, nowIso(), tripId
        );
        // El nuevo propietario pasa a rol owner (consistencia con el resto del modelo).
        ctx.db.prepare("UPDATE trip_members SET role = 'owner' WHERE trip_id = ? AND user_id = ?").run(tripId, newOwnerId);
        ctx.db.prepare('DELETE FROM trip_members WHERE trip_id = ? AND user_id = ?').run(tripId, ctx.currentUserId);
        ctx.db.exec('COMMIT');
      } catch (e) {
        ctx.db.exec('ROLLBACK');
        throw e;
      }
      publishTrip(ctx, tripId, 'leaveTrip', { tripId, userId: ctx.currentUserId, newOwnerId }, ctx.currentUserId);
      return buildTrip(ctx.db, getTripOrNull(ctx.db, tripId)!, ctx.currentUserId);
    },

    deleteTrip: (_, args, ctx) => {
      const { tripId } = args as Args<{ tripId: string }>;
      const trip = getTripOrNull(ctx.db, tripId);
      if (!trip) throw gqlError('TRIP_NOT_FOUND', 'Trip not found');
      if (!isTripMember(ctx.db, tripId, ctx.currentUserId)) {
        throw gqlError('NOT_TRIP_MEMBER', 'Solo los miembros del viaje pueden eliminarlo.');
      }
      if (trip.owner_id !== ctx.currentUserId) {
        throw gqlError('NOT_TRIP_OWNER', 'Solo el propietario puede eliminar el viaje.');
      }
      // Cascada: adjuntos (filas + archivos), items, members, invitations, trip y portadas.
      removeAttachmentsByTrip(ctx.db, tripId);
      ctx.db.prepare('DELETE FROM trip_items WHERE trip_id = ?').run(tripId);
      ctx.db.prepare('DELETE FROM trip_members WHERE trip_id = ?').run(tripId);
      ctx.db.prepare('DELETE FROM invitations WHERE trip_id = ?').run(tripId);
      removeTripCoverFiles(tripId);
      ctx.db.prepare('DELETE FROM trips WHERE id = ?').run(tripId);
      publishTrip(ctx, tripId, 'deleteTrip', { id: tripId }, ctx.currentUserId);
      return tripId;
    },

    updateTripCover: (_, args, ctx) => {
      const { tripId, input } = args as Args<{
        tripId: string;
        input: { coverPreset?: string | null; coverPhotoDataUrl?: string | null; removePhoto?: boolean | null };
      }>;
      const trip = getTripOrNull(ctx.db, tripId);
      if (!trip) throw gqlError('TRIP_NOT_FOUND', 'Trip not found');
      if (trip.owner_id !== ctx.currentUserId) {
        throw gqlError('NOT_TRIP_OWNER', 'Solo el propietario puede cambiar la portada.');
      }

      if (input.coverPreset != null && input.coverPreset !== '') {
        if (!isValidCoverPreset(input.coverPreset)) {
          throw gqlError('INVALID_COVER_PRESET', 'Preset de portada no válido.');
        }
        removeTripCoverFiles(tripId);
        ctx.db.prepare('UPDATE trips SET cover_preset = ?, cover_photo_url = NULL, updated_at = ? WHERE id = ?')
          .run(input.coverPreset, nowIso(), tripId);
      } else if (input.coverPhotoDataUrl) {
        let decoded: { ext: string; buffer: Buffer };
        try {
          decoded = decodeAvatarDataUrl(input.coverPhotoDataUrl);
        } catch {
          throw gqlError('INVALID_IMAGE', 'Formato de imagen no válido: usa PNG, JPG o WebP (máx 2MB).');
        }
        removeTripCoverFiles(tripId);
        let relPath: string;
        try {
          relPath = writeCoverPhoto(tripId, decoded.ext, decoded.buffer);
        } catch (e) {
          throw gqlError('COVER_UPLOAD_FAILED', e instanceof Error ? e.message : 'No se pudo guardar la portada.');
        }
        // La foto tiene prioridad visual; el preset se conserva como fallback
        // para cuando el usuario quite la foto (STD: "quitar foto vuelve al preset").
        ctx.db.prepare('UPDATE trips SET cover_photo_url = ?, updated_at = ? WHERE id = ?')
          .run(relPath, nowIso(), tripId);
      } else if (input.removePhoto) {
        removeTripCoverFiles(tripId);
        ctx.db.prepare('UPDATE trips SET cover_photo_url = NULL, updated_at = ? WHERE id = ?').run(nowIso(), tripId);
      }

      publishTrip(ctx, tripId, 'updateTripCover', { tripId }, ctx.currentUserId);
      return buildTrip(ctx.db, getTripOrNull(ctx.db, tripId)!, ctx.currentUserId);
    },

    addItem: (_, args, ctx) => {
      const { tripId, input } = args as Args<{ tripId: string; input: AddItemInput }>;
      assertCanEditTrip(ctx.db, tripId, ctx.currentUserId);
      const id = randomUUID();
      ctx.db.prepare(`
        INSERT INTO trip_items
          (id, trip_id, location_id, title, category, cost, day, "order", start_time, notes, image_url, created_by, location_text)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, tripId, input.activityId ?? null, input.title, input.category, input.cost ?? 0,
        input.day ?? null, input.order ?? null, input.startTime ?? null, input.notes ?? null,
        input.imageUrl ?? null, ctx.currentUserId, normalizeLocationText(input.locationText)
      );
      recomputeItemReminder(ctx.db, id);
      publishTrip(ctx, tripId, 'addItem', { id, tripId, title: input.title }, ctx.currentUserId);
      return toTripItem(ctx.db.prepare('SELECT * FROM trip_items WHERE id = ?').get(id) as unknown as ItemRow);
    },

    updateItem: (_, args, ctx) => {
      const { tripId, itemId, input } = args as Args<{ tripId: string; itemId: string; input: UpdateItemInput }>;
      assertCanEditTrip(ctx.db, tripId, ctx.currentUserId);
      const item = ctx.db.prepare('SELECT * FROM trip_items WHERE id = ? AND trip_id = ?').get(itemId, tripId) as
        | ItemRow
        | undefined;
      if (!item) throw gqlError('ITEM_NOT_FOUND', 'Item not found');
      // startTime null/'' limpia la hora (y con ella el recordatorio).
      const nextStartTime =
        input.startTime === undefined ? item.start_time : (input.startTime?.trim() || null);
      // locationText: ausente no toca; null/'' explicito limpia.
      const nextLocationText =
        input.locationText === undefined ? item.location_text : normalizeLocationText(input.locationText);
      ctx.db.prepare(`
        UPDATE trip_items SET day = ?, "order" = ?, start_time = ?, notes = ?, title = ?, location_text = ?
        WHERE id = ?
      `).run(
        input.day ?? item.day, input.order ?? item.order,
        nextStartTime, input.notes ?? item.notes,
        input.title ?? item.title, nextLocationText, itemId
      );
      recomputeItemReminder(ctx.db, itemId);
      publishTrip(ctx, tripId, 'updateItem', { itemId, tripId }, ctx.currentUserId);
      return toTripItem(ctx.db.prepare('SELECT * FROM trip_items WHERE id = ?').get(itemId) as unknown as ItemRow);
    },

    setItemReminder: (_, args, ctx) => {
      const { itemId, enabled } = args as Args<{ itemId: string; enabled: boolean }>;
      const item = ctx.db.prepare('SELECT * FROM trip_items WHERE id = ?').get(itemId) as
        | ItemRow
        | undefined;
      if (!item) throw gqlError('ITEM_NOT_FOUND', 'Item not found');
      assertCanEditTrip(ctx.db, item.trip_id, ctx.currentUserId);
      if (!enabled) {
        ctx.db.prepare('UPDATE trip_items SET reminder_enabled = 0, reminder_sent = 1, reminder_due_at = NULL WHERE id = ?')
          .run(itemId);
      } else {
        ctx.db.prepare('UPDATE trip_items SET reminder_enabled = 1 WHERE id = ?').run(itemId);
        recomputeItemReminder(ctx.db, itemId);
      }
      publishTrip(ctx, item.trip_id, 'setItemReminder', { itemId, tripId: item.trip_id, enabled }, ctx.currentUserId);
      return toTripItem(ctx.db.prepare('SELECT * FROM trip_items WHERE id = ?').get(itemId) as unknown as ItemRow);
    },

    setItemCost: (_, args, ctx) => {
      const { tripId, itemId, cost } = args as Args<{ tripId: string; itemId: string; cost: number }>;
      assertCanEditTrip(ctx.db, tripId, ctx.currentUserId);
      const item = ctx.db.prepare('SELECT id FROM trip_items WHERE id = ? AND trip_id = ?').get(itemId, tripId);
      if (!item) throw gqlError('ITEM_NOT_FOUND', 'Item not found');
      ctx.db.prepare('UPDATE trip_items SET cost = ? WHERE id = ?').run(cost, itemId);
      publishTrip(ctx, tripId, 'setItemCost', { itemId, tripId, cost }, ctx.currentUserId);
      return toTripItem(ctx.db.prepare('SELECT * FROM trip_items WHERE id = ?').get(itemId) as unknown as ItemRow);
    },

    moveItem: (_, args, ctx) => {
      const { tripId, itemId, day, order } = args as Args<{ tripId: string; itemId: string; day: string; order: number }>;
      assertCanEditTrip(ctx.db, tripId, ctx.currentUserId);
      const item = ctx.db.prepare('SELECT id FROM trip_items WHERE id = ? AND trip_id = ?').get(itemId, tripId);
      if (!item) throw gqlError('ITEM_NOT_FOUND', 'Item not found');
      ctx.db.prepare('UPDATE trip_items SET day = ?, "order" = ? WHERE id = ?').run(day, order, itemId);
      publishTrip(ctx, tripId, 'moveItem', { itemId, tripId, day, order }, ctx.currentUserId);
      return toTripItem(ctx.db.prepare('SELECT * FROM trip_items WHERE id = ?').get(itemId) as unknown as ItemRow);
    },

    removeItem: (_, args, ctx) => {
      const { tripId, itemId } = args as Args<{ tripId: string; itemId: string }>;
      assertCanEditTrip(ctx.db, tripId, ctx.currentUserId);
      const item = ctx.db.prepare('SELECT * FROM trip_items WHERE id = ? AND trip_id = ?').get(itemId, tripId) as
        | ItemRow
        | undefined;
      if (!item) throw gqlError('ITEM_NOT_FOUND', 'Item not found');
      ctx.db.prepare('DELETE FROM trip_items WHERE id = ?').run(itemId);
      publishTrip(ctx, tripId, 'removeItem', { itemId, tripId }, ctx.currentUserId);
      return toTripItem(item);
    },

    touchPresence: (_, args, ctx) => {
      const { input } = args as Args<{
        input: {
          tripId: string;
          displayName: string;
          color: string | null;
          editingItemId?: string | null;
        };
      }>;
      assertTripMember(ctx.db, input.tripId, ctx.currentUserId);
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

    requestSuggestions: (_, args, ctx) => {
      const { tripId, day } = args as Args<{ tripId: string; day?: number | null }>;
      assertTripMember(ctx.db, tripId, ctx.currentUserId);
      const trip = ctx.db.prepare('SELECT * FROM trips WHERE id = ?').get(tripId) as unknown as
        | TripRow
        | undefined;
      const items = ctx.db.prepare('SELECT * FROM trip_items WHERE trip_id = ?').all(tripId) as unknown as {
        activity_id?: string | null;
        title?: string | null;
        cost?: number | null;
      }[];
      const suggestions = buildSuggestions(ctx.db, trip ?? null, items);
      return { day, items: suggestions };
    },

    sendTripInvite: async (_, args, ctx) => {
      const { tripId, email, role } = args as Args<{ tripId: string; email: string; role?: string | null }>;
      const normalized = email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
        throw gqlError('INVALID_EMAIL', 'Email no válido');
      }
      // Rol elegible: vacío/null -> 'viewer'; solo se admiten 'editor' y 'viewer'.
      const requestedRole = (typeof role === 'string' ? role.trim().toLowerCase() : '') || 'viewer';
      if (requestedRole !== 'editor' && requestedRole !== 'viewer') {
        throw gqlError('INVALID_INVITE_ROLE', 'Rol de invitación no válido');
      }
      const inviteRole = requestedRole as 'editor' | 'viewer';
      const trip = getTripOrNull(ctx.db, tripId);
      if (!trip) throw gqlError('TRIP_NOT_FOUND', 'Trip not found');
      const myRoleRow = ctx.db
        .prepare('SELECT role FROM trip_members WHERE trip_id = ? AND user_id = ?')
        .get(tripId, ctx.currentUserId) as { role: string } | undefined;
      const myRole = myRoleRow?.role;
      if (myRole !== 'owner' && myRole !== 'editor') {
        throw gqlError('FORBIDDEN_INVITE', 'Solo el propietario o un editor puede invitar');
      }

      const invitation = createInvitation(ctx.db, {
        tripId,
        email: normalized,
        role: inviteRole,
        createdBy: ctx.currentUserId,
      });
      const joinUrl = buildJoinUrl(tripId, invitation.code);
      const me = ctx.db.prepare('SELECT display_name FROM users WHERE id = ?').get(ctx.currentUserId) as
        | { display_name: string }
        | undefined;
      const ownerName = me?.display_name ?? 'Un viajero';

      // Si el envio falla, la invitacion queda pendiente y el error se reporta
      // en logs: el codigo se puede compartir manualmente y la aceptacion
      // funciona igual (diseno original; Resend en modo prueba solo envia al
      // email del dueno, y eso no debe romper la invitacion).
      try {
        await sendInviteEmail({
          to: invitation.email,
          tripName: trip.name,
          ownerName,
          code: invitation.code,
          joinUrl,
          role: inviteRole,
        });
      } catch (e) {
        console.error('[invite] email no enviado:', e instanceof Error ? e.message : e);
      }
      publishTrip(ctx, tripId, 'inviteSent', { tripId, email: invitation.email }, ctx.currentUserId);
      return {
        invitationId: invitation.id,
        status: invitation.status,
        email: invitation.email,
      };
    },

    joinTripWithCode: (_, args, ctx) => {
      const { code, email } = args as Args<{ code: string; email: string }>;
      if (!isInviteCodeValid(code)) throw gqlError('INVALID_INVITE_CODE', 'Código de invitación no válido');
      const invitation = findInvitationByCode(ctx.db, code);
      if (!invitation) throw gqlError('INVITE_CODE_NOT_FOUND', 'Código de invitación no encontrado');
      if (invitation.status !== 'pending') throw gqlError('INVITE_ALREADY_USED', 'Esta invitación ya fue usada');
      if (!isEmailMatch(invitation, email)) throw gqlError('INVITE_EMAIL_MISMATCH', 'El email no coincide con la invitación');

      ctx.db
        .prepare('INSERT OR IGNORE INTO trip_members (trip_id, user_id, role) VALUES (?, ?, ?)')
        .run(invitation.trip_id, ctx.currentUserId, invitation.role);
      // El usuario demo adopta el email de la invitacion (no hay registro real aun).
      ctx.db.prepare('UPDATE users SET email = ? WHERE id = ?').run(invitation.email, ctx.currentUserId);
      acceptInvitation(ctx.db, invitation.id);
      publishTrip(
        ctx,
        invitation.trip_id,
        'joinTrip',
        { tripId: invitation.trip_id, userId: ctx.currentUserId },
        ctx.currentUserId
      );
      return buildTrip(ctx.db, getTripOrNull(ctx.db, invitation.trip_id)!, ctx.currentUserId);
    },

    updateMyProfile: (_, args, ctx) => {
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
        throw gqlError('INVALID_LANGUAGE', 'Idioma no válido: usa "es" o "en".');
      }
      try {
        const row = updateMyProfile(ctx.db, ctx.currentUserId, {
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

    addItemAttachment: (_, args, ctx) => {
      const {
        tripId: requestedTripId,
        itemId,
        input,
        viewerIds: rawViewerIds,
      } = args as Args<{
        tripId?: string | null;
        itemId: string;
        input: { fileName: string; mimeType: string; dataUrl: string };
        viewerIds?: string[] | null;
      }>;
      const tripId = findItemTrip(ctx.db, itemId);
      if (!tripId || (requestedTripId && requestedTripId !== tripId)) {
        throw gqlError('ITEM_NOT_FOUND', 'Actividad no encontrada.');
      }
      if (!isTripMember(ctx.db, tripId, ctx.currentUserId)) {
        throw gqlError('NOT_TRIP_MEMBER', 'Solo los miembros del viaje pueden subir boletos.');
      }
      const viewerIds = [...new Set(rawViewerIds ?? [])];
      if (invalidAttachmentViewers(ctx.db, tripId, viewerIds).length > 0) {
        throw gqlError('INVALID_VIEWER', 'Todos los viewers deben ser miembros del viaje.');
      }
      try {
        const created = addAttachment(ctx.db, itemId, ctx.currentUserId, {
          fileName: input.fileName,
          mimeType: input.mimeType,
          dataUrl: input.dataUrl,
        }, viewerIds);
        // El uploader siempre ve lo suyo: la respuesta lleva URL firmada.
        const attachment = getAttachmentForUser(ctx.db, created.id, ctx.currentUserId) ?? created;
        publishTrip(ctx, tripId, 'addAttachment', { itemId, attachmentId: attachment.id }, ctx.currentUserId);
        return attachment;
      } catch (e) {
        throw gqlError('ATTACHMENT_UPLOAD_FAILED', e instanceof Error ? e.message : 'No se pudo subir el archivo.');
      }
    },

    updateAttachmentViewers: (_, args, ctx) => {
      const { attachmentId, viewerIds: rawViewerIds } = args as Args<{
        attachmentId: string;
        viewerIds?: string[] | null;
      }>;
      const row = findAttachment(ctx.db, attachmentId);
      const info = findAttachmentItemTrip(ctx.db, attachmentId);
      if (!row || !info) throw gqlError('ATTACHMENT_NOT_FOUND', 'Archivo no encontrado.');
      // Solo el uploader edita los permisos de su archivo.
      if (row.created_by !== ctx.currentUserId) {
        throw gqlError('FORBIDDEN_ATTACHMENT', 'Solo quien subió el archivo puede editar sus permisos.');
      }
      // El uploader es viewer implicito: se descarta de la lista explicita.
      const viewerIds = [...new Set(rawViewerIds ?? [])].filter(
        (viewerId) => viewerId !== ctx.currentUserId
      );
      if (invalidAttachmentViewers(ctx.db, info.tripId, viewerIds).length > 0) {
        throw gqlError('INVALID_VIEWER', 'Todos los viewers deben ser miembros del viaje.');
      }
      replaceAttachmentViewers(ctx.db, attachmentId, viewerIds);
      const attachment = getAttachmentForUser(ctx.db, attachmentId, ctx.currentUserId);
      publishTrip(ctx, info.tripId, 'updateAttachmentViewers', { attachmentId }, ctx.currentUserId);
      return attachment;
    },

    removeItemAttachment: (_, args, ctx) => {
      const { attachmentId } = args as Args<{ attachmentId: string }>;
      const row = findAttachment(ctx.db, attachmentId);
      const info = findAttachmentItemTrip(ctx.db, attachmentId);
      if (!row || !info) throw gqlError('ATTACHMENT_NOT_FOUND', 'Archivo no encontrado.');
      if (!isTripMember(ctx.db, info.tripId, ctx.currentUserId)) {
        throw gqlError('NOT_TRIP_MEMBER', 'Solo los miembros del viaje pueden quitar boletos.');
      }
      // Solo el uploader elimina lo suyo (ni siquiera el owner del viaje).
      if (row.created_by !== ctx.currentUserId) {
        throw gqlError('FORBIDDEN_ATTACHMENT', 'Solo quien subió el archivo puede eliminarlo.');
      }
      const attachment = getAttachmentForUser(ctx.db, attachmentId, ctx.currentUserId);
      removeAttachment(ctx.db, attachmentId);
      publishTrip(ctx, info.tripId, 'removeAttachment', { attachmentId }, ctx.currentUserId);
      return attachment;
    },

    setMyInterests: (_, args, ctx) => {
      const { terms } = args as Args<{ terms: string[] }>;
      const userId = requireCurrentUser(ctx.db, ctx.currentUserId);
      return replaceUserInterests(
        ctx.db,
        userId,
        terms,
        ctx.syncInterests ?? syncInterestsToAgent,
      );
    },

    favoriteLocation: (_, args, ctx) => {
      const { locationId, favorite } = args as Args<{ locationId: string; favorite: boolean }>;
      try {
        const state = setFavorite(ctx.db, ctx.currentUserId, locationId, favorite);
        return { locationId, favorite: state };
      } catch (e) {
        throw gqlError('FAVORITE_SAVE_FAILED', e instanceof Error ? e.message : 'No se pudo actualizar el favorito.');
      }
    },

    saveSuggestionChat: (_, args, ctx) => {
      const { tripId, day, messages } = args as Args<{
        tripId: string;
        day: string;
        messages: { role: string; content: string }[];
      }>;
      const trip = getTripOrNull(ctx.db, tripId);
      if (!trip) throw gqlError('TRIP_NOT_FOUND', 'Trip not found');
      if (!isTripMember(ctx.db, tripId, ctx.currentUserId)) {
        throw gqlError('NOT_TRIP_MEMBER', 'Solo los miembros del viaje pueden guardar el chat.');
      }
      if (!isValidMessages(messages)) {
        throw gqlError('INVALID_MESSAGES', 'messages debe ser un array no vacío de {role, content}.');
      }
      return upsertSuggestionChat(ctx.db, { tripId, userId: ctx.currentUserId, day, messages });
    },

    authLogin: async (_, args, ctx) => {
      const { idToken } = args as Args<{ idToken: string }>;
      const verify = ctx.verifyToken ?? verifyFirebaseIdToken;
      let claims;
      try {
        claims = await verify(idToken);
      } catch (e) {
        if (e instanceof AuthTokenError) throw gqlError('AUTH_TOKEN_INVALID', e.message);
        throw e;
      }
      // Bloqueo duro: proveedores no-Google exigen email verificado (spec M2).
      const provider = claims.firebase?.sign_in_provider;
      if (provider !== 'google.com' && !claims.email_verified) {
        throw gqlError('AUTH_EMAIL_NOT_VERIFIED', 'Verifica tu email para iniciar sesión.');
      }
      const { user } = upsertUserByEmail(ctx.db, claims);

      let welcomeSent = false;
      if (claims.email_verified && !user.welcome_sent_at) {
        const send = ctx.sendWelcome ?? sendWelcomeEmail;
        try {
          await send(user.email, user.display_name);
          markWelcomeSent(ctx.db, user.id);
          welcomeSent = true;
        } catch (e) {
          // Un fallo de Resend NO debe romper el login: solo se omite la bienvenida.
          console.error('[auth] email de bienvenida no enviado:', e instanceof Error ? e.message : e);
        }
      }
      const fresh = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as unknown as UserRow;
      return { user: toProfile(fresh), welcomeSent };
    },

    authSendVerification: async (_, args, ctx) => {
      const { idToken } = args as Args<{ idToken: string }>;
      const verify = ctx.verifyToken ?? verifyFirebaseIdToken;
      let claims;
      try {
        claims = await verify(idToken);
      } catch (e) {
        if (e instanceof AuthTokenError) throw gqlError('AUTH_TOKEN_INVALID', e.message);
        throw e;
      }
      if (!tryReserveVerification(claims.uid)) {
        throw gqlError('VERIFICATION_RATE_LIMITED', 'Espera un minuto antes de pedir otro email de verificación.');
      }
      const generate = ctx.generateVerification ?? generateVerificationLink;
      const send = ctx.sendVerification ?? sendVerificationEmail;
      try {
        const oob = await generate(idToken);
        await send(oob.email || claims.email, oob.link, claims.name?.trim() || undefined);
      } catch (e) {
        if (e instanceof OobError) throw gqlError(e.code, e.message);
        throw gqlError('VERIFICATION_SEND_FAILED', e instanceof Error ? e.message : 'No se pudo enviar el email.');
      }
      return true;
    },

    authConfirmEmail: async (_, args, ctx) => {
      const { token } = args as Args<{ token: string }>;
      if (!token) {
        throw gqlError('AUTH_TOKEN_INVALID', 'Token de verificación no válido.');
      }

      let payload: VerifiedVerificationToken;
      try {
        payload = await verifyVerificationToken(token, getServiceAccountPrivateKey());
      } catch (e) {
        throw gqlError(
          'AUTH_TOKEN_INVALID',
          e instanceof Error ? e.message : 'Token de verificación inválido.',
        );
      }

      // jti de un solo uso: marcar como usado ANTES de cualquier efecto.
      // Replay del MISMO uid = idempotente (StrictMode en dev dobla la llamada;
      // la primera ya verificó): se salta el updateUser y se re-sincroniza.
      let jtiStatus: 'fresh' | 'replay' = 'fresh';
      try {
        jtiStatus = consumeVerificationJti(payload.jti, payload.uid);
      } catch (e) {
        if (e instanceof VerificationTokenError && e.code === 'VERIFICATION_TOKEN_USED') {
          throw gqlError('VERIFICATION_TOKEN_USED', e.message);
        }
        throw gqlError('VERIFICATION_TOKEN_USED', 'El enlace de verificación ya fue usado.');
      }

      // Marca emailVerified en Firebase (Admin SDK) solo en el primer uso.
      if (jtiStatus === 'fresh') {
        const confirm = ctx.confirmVerification ?? setEmailVerified;
        try {
          await confirm(payload.uid);
        } catch (e) {
          if (isUserNotFoundError(e)) {
            throw gqlError('AUTH_TOKEN_INVALID', 'La cuenta no existe o el enlace no es válido.');
          }
          throw gqlError(
            'VERIFICATION_CONFIRM_FAILED',
            e instanceof Error ? e.message : 'No se pudo confirmar el email.',
          );
        }
      }

      // Sincroniza la fila local con email_verified = true.
      const { user } = upsertUserByEmail(ctx.db, {
        uid: payload.uid,
        email: payload.email,
        email_verified: true,
      });

      let welcomeSent = false;
      if (!user.welcome_sent_at) {
        const send = ctx.sendWelcome ?? sendWelcomeEmail;
        try {
          await send(user.email, user.display_name);
          markWelcomeSent(ctx.db, user.id);
          welcomeSent = true;
        } catch (e) {
          // Un fallo de Resend NO debe romper la confirmacion: solo se omite la bienvenida.
          console.error('[auth] email de bienvenida no enviado:', e instanceof Error ? e.message : e);
        }
      }
      const fresh = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as unknown as UserRow;
      return { user: toProfile(fresh), welcomeSent };
    },
  },

  Subscription: {
    onTripChanged: {
      subscribe: (_, args, ctx) => {
        const { tripId } = args as Args<{ tripId: string }>;
        assertTripMember(ctx.db, tripId, ctx.currentUserId);
        return ctx.pubsub.subscribe(`trip:${tripId}`);
      },
    },
    onPresenceChanged: {
      subscribe: (_, args, ctx) => {
        const { tripId } = args as Args<{ tripId: string }>;
        assertTripMember(ctx.db, tripId, ctx.currentUserId);
        return ctx.pubsub.subscribe(`presence:${tripId}`);
      },
    },
  },

  Trip: {
    destinationLat: (parent, __, ctx) => {
      const { destinationId } = parent as { destinationId?: string | null };
      if (!destinationId) return null;
      const row = ctx.db.prepare('SELECT lat FROM locations WHERE id = ?').get(destinationId) as
        | { lat: number | null }
        | undefined;
      return row?.lat ?? null;
    },
    destinationLng: (parent, __, ctx) => {
      const { destinationId } = parent as { destinationId?: string | null };
      if (!destinationId) return null;
      const row = ctx.db.prepare('SELECT lng FROM locations WHERE id = ?').get(destinationId) as
        | { lng: number | null }
        | undefined;
      return row?.lng ?? null;
    },
  },

  TripItem: {
    attachments: (parent, __, ctx) => {
      const { id } = parent as { id: string };
      return listAttachmentsByItem(ctx.db, id, ctx.currentUserId);
    },
    isFavorite: (parent, __, ctx) => {
      const { activityId } = parent as { activityId?: string | null };
      if (!activityId) return false;
      return isFavorite(ctx.db, ctx.currentUserId, activityId);
    },
    lat: (parent, __, ctx) => {
      const { activityId } = parent as { activityId?: string | null };
      if (!activityId) return null;
      const row = ctx.db.prepare('SELECT lat FROM locations WHERE id = ?').get(activityId) as
        | { lat: number | null }
        | undefined;
      return row?.lat ?? null;
    },
    lng: (parent, __, ctx) => {
      const { activityId } = parent as { activityId?: string | null };
      if (!activityId) return null;
      const row = ctx.db.prepare('SELECT lng FROM locations WHERE id = ?').get(activityId) as
        | { lng: number | null }
        | undefined;
      return row?.lng ?? null;
    },
  },
};
