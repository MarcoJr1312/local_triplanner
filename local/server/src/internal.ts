// Endpoints internos REST (127.0.0.1) consumidos por agentes internos (ej. el
// agente de sugerencias Python M3). Viven FUERA del GraphQL, montados en el mismo
// server HTTP junto a /graphql. Autenticados con X-Internal-Token (y X-User-Id
// cuando aplica, con check de membresia). Solo responden a loopback.
//
// Rutas:
//   GET  /internal/trip-context/:tripId   (X-Internal-Token + X-User-Id)
//   POST /internal/search-places          (X-Internal-Token) {q, tripId, userId}
//   POST /internal/place-details          (X-Internal-Token) {placeId}
//   GET  /internal/places-cache/:tripId   (X-Internal-Token + X-User-Id)
//   POST /internal/save-chat              (X-Internal-Token) {tripId, userId, day, messages}

import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { searchLocations, extractPlaceDetail, webResultsToSocialLinks, distanceKm } from './hasdata/search.ts';
import { HasDataClient, type HasDataResponse } from './hasdata/client.ts';
import { upsertSuggestionChat, isValidMessages } from './chats.ts';
import { isTripMember } from './attachments.ts';
import { favoriteIdsForUser } from './favorites.ts';
import { listUserInterests } from './interests.ts';
import type { Db, LocationRow } from './schema-types.ts';

const SEARCH_RADIUS_KM = 75;

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export interface InternalDeps {
  db: Db;
  hasdata: HasDataClient | null;
  internalToken: string;
}

interface TripRowInternal {
  id: string;
  name: string;
  destination_id: string | null;
  destination_name: string | null;
  start_date: string | null;
  end_date: string | null;
  total_budget: number | null;
}

interface ItemRowInternal {
  id: string;
  title: string;
  category: string | null;
  cost: number | null;
  day: string | null;
  start_time: string | null;
  location_id: string | null;
  order: number | null;
}

function matchesToken(expected: string, provided: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c: Buffer) => {
      data += c.toString('utf8');
      if (data.length > 5_000_000) {
        reject(new Error('body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!data.trim()) return resolve({});
      try {
        resolve(JSON.parse(data) as Record<string, unknown>);
      } catch {
        reject(new Error('invalid json'));
      }
    });
    req.on('error', reject);
  });
}

function headerUserId(req: IncomingMessage): string | null {
  const v = req.headers['x-user-id'];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function headerUserEmail(req: IncomingMessage): string | null {
  const v = req.headers['x-user-email'];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

// Resuelve la identidad del caller interno: SIEMPRE prefiere el email (la
// identidad real de la app es el email normalizado — el uid de Firebase NO
// coincide con users.id), y cae a X-User-Id (modo demo, donde el frontend
// solo conoce el id local).
function resolveUserId(deps: InternalDeps, req: IncomingMessage): string | null {
  const email = headerUserEmail(req);
  if (email) {
    const row = deps.db
      .prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?)')
      .get(email.trim()) as { id: string } | undefined;
    if (row) return row.id;
  }
  return headerUserId(req);
}

// ---- helpers defensivos para el JSON reducido de place-details ----

function pick(obj: Record<string, unknown> | null | undefined, keys: readonly string[]): unknown {
  for (const k of keys) {
    const v = obj?.[k];
    if (v != null && v !== '') return v;
  }
  return undefined;
}

function firstString(value: unknown): string | null {
  if (Array.isArray(value)) {
    const s = value.find((v) => typeof v === 'string' && v !== '') as string | undefined;
    return s ?? null;
  }
  return typeof value === 'string' && value !== '' ? value : null;
}

function toFloat(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toInt(v: unknown): number | null {
  if (v == null) return null;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

function toStringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out = v.filter((x): x is string => typeof x === 'string' && x !== '');
  return out.length ? out : null;
}

function parseTags(s: string | null | undefined): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function socialLinksFrom(data: HasDataResponse | null | undefined, detail: Record<string, unknown> | null): unknown[] | null {
  const wrJson = webResultsToSocialLinks(data);
  if (wrJson) {
    try {
      const v = JSON.parse(wrJson) as unknown;
      if (Array.isArray(v)) return v;
    } catch {
      // ignorar
    }
  }
  const sl = pick(detail, ['socialLinks', 'social_links', 'socialLinksJson']);
  if (Array.isArray(sl)) return sl as unknown[];
  if (typeof sl === 'string') {
    try {
      const v = JSON.parse(sl) as unknown;
      if (Array.isArray(v)) return v;
    } catch {
      // ignorar
    }
  }
  return null;
}

// ---- handlers ----

function handleTripContext(deps: InternalDeps, req: IncomingMessage, res: ServerResponse, rawTripId: string): void {
  const tripId = decodeURIComponent(rawTripId);
  const userId = resolveUserId(deps, req);
  const trip = deps.db.prepare('SELECT * FROM trips WHERE id = ?').get(tripId) as TripRowInternal | undefined;
  if (!trip) {
    json(res, 404, { error: 'TRIP_NOT_FOUND', message: 'Trip not found' });
    return;
  }
  if (!userId || !isTripMember(deps.db, tripId, userId)) {
    json(res, 403, { error: 'NOT_TRIP_MEMBER', message: 'X-User-Id no es miembro del viaje.' });
    return;
  }

  const dest = trip.destination_id
    ? (deps.db.prepare('SELECT lat, lng FROM locations WHERE id = ?').get(trip.destination_id) as
        | { lat: number | null; lng: number | null }
        | undefined)
    : undefined;

  const items = deps.db
    .prepare('SELECT * FROM trip_items WHERE trip_id = ? ORDER BY day ASC, start_time ASC NULLS LAST, "order" ASC')
    .all(tripId) as unknown as ItemRowInternal[];
  const spent = items.reduce((s, i) => s + (Number(i.cost) || 0), 0);

  const byDay = new Map<string, ItemRowInternal[]>();
  for (const it of items) {
    const day = it.day ?? '';
    const list = byDay.get(day) ?? [];
    list.push(it);
    byDay.set(day, list);
  }
  const days = [...byDay.entries()].map(([date, list]) => ({
    date,
    items: list.map((it) => ({
      id: it.id,
      title: it.title,
      category: it.category ?? 'activity',
      cost: Number(it.cost) || 0,
      day: it.day ?? null,
      startTime: it.start_time ?? null,
      locationId: it.location_id ?? null,
    })),
  }));

  const members = (deps.db
    .prepare(
      'SELECT m.user_id, m.role, u.display_name FROM trip_members m JOIN users u ON u.id = m.user_id WHERE m.trip_id = ? ORDER BY m.joined_at ASC',
    )
    .all(tripId) as unknown as { user_id: string; role: string; display_name: string | null }[]).map((m) => ({
    userId: m.user_id,
    displayName: m.display_name,
    role: m.role,
  }));

  const langRow = deps.db.prepare('SELECT language FROM users WHERE id = ?').get(userId) as
    | { language: string | null }
    | undefined;
  const userLanguage = langRow?.language || 'es';

  json(res, 200, {
    userId,
    trip: {
      id: trip.id,
      name: trip.name,
      destinationId: trip.destination_id ?? null,
      destinationName: trip.destination_name ?? null,
      lat: dest?.lat ?? null,
      lng: dest?.lng ?? null,
      startDate: trip.start_date,
      endDate: trip.end_date,
      totalBudget: Number(trip.total_budget) || 0,
      spent,
    },
    days,
    members,
    userLanguage,
    interests: listUserInterests(deps.db, userId),
  });
}

async function handleSearchPlaces(deps: InternalDeps, res: ServerResponse, body: Record<string, unknown>): Promise<void> {
  const q = String(body.q ?? '').trim();
  if (!q) {
    json(res, 400, { error: 'INVALID_ARGUMENT', message: 'q requerido' });
    return;
  }
  const tripId = typeof body.tripId === 'string' ? body.tripId : null;
  const userId = typeof body.userId === 'string' && body.userId.trim() ? body.userId.trim() : null;

  let lat: number | null = null;
  let lng: number | null = null;
  if (tripId) {
    const trip = deps.db.prepare('SELECT destination_id FROM trips WHERE id = ?').get(tripId) as
      | { destination_id: string | null }
      | undefined;
    if (trip?.destination_id) {
      const dest = deps.db.prepare('SELECT lat, lng FROM locations WHERE id = ?').get(trip.destination_id) as
        | { lat: number | null; lng: number | null }
        | undefined;
      lat = dest?.lat ?? null;
      lng = dest?.lng ?? null;
    }
  }

  const rows = await searchLocations({ db: deps.db, client: deps.hasdata, q, lat, lng, userId });
  const favIds = userId ? favoriteIdsForUser(deps.db, userId) : new Set<string>();
  json(
    res,
    200,
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category ?? 'activity',
      rating: r.rating ?? null,
      cost: r.cost ?? null,
      address: r.address ?? null,
      imageUrl: r.image_url ?? null,
      lat: r.lat,
      lng: r.lng,
      isFavorite: favIds.has(r.id),
    })),
  );
}

async function handlePlaceDetails(deps: InternalDeps, res: ServerResponse, body: Record<string, unknown>): Promise<void> {
  const placeId = typeof body.placeId === 'string' ? body.placeId.trim() : '';
  if (!placeId) {
    json(res, 400, { error: 'INVALID_ARGUMENT', message: 'placeId requerido' });
    return;
  }
  if (!deps.hasdata) {
    json(res, 503, { error: 'HASDATA_UNAVAILABLE', message: 'HasData no configurado.' });
    return;
  }
  const data = await deps.hasdata.place(placeId, { fetchWebResults: true });
  const detail = extractPlaceDetail(data) as Record<string, unknown> | null;

  const base: Record<string, unknown> = {
    name: firstString(pick(detail, ['name', 'title', 'placeName', 'place name'])) ?? '',
    description: firstString(pick(detail, ['description', 'summary', 'descriptionSnippet', 'snippet'])) ?? null,
    rating: toFloat(pick(detail, ['rating', 'averageRating'])),
    ratingCount: toInt(pick(detail, ['reviews', 'reviewsCount', 'reviewCount', 'userRatingsTotal', 'ratingCount'])),
    phone: firstString(pick(detail, ['phone', 'phoneNumber', 'phone_number'])) ?? null,
    websiteUrl: firstString(pick(detail, ['website', 'websiteUrl', 'website_url'])) ?? null,
    address: firstString(pick(detail, ['address', 'formattedAddress', 'vicinity', 'fullAddress'])) ?? null,
  };
  const hours = pick(detail, ['workingHours', 'hours', 'openingHours', 'businessHours']);
  const photos = toStringArray(pick(detail, ['photos', 'images', 'photoUrls', 'imagesUrls']));
  const socialLinks = socialLinksFrom(data, detail);
  if (hours != null) base.hours = hours;
  if (photos) base.photos = photos;
  if (socialLinks) base.socialLinks = socialLinks;

  json(res, 200, base);
}

function handlePlacesCache(deps: InternalDeps, req: IncomingMessage, res: ServerResponse, rawTripId: string): void {
  const tripId = decodeURIComponent(rawTripId);
  const userId = resolveUserId(deps, req);
  const trip = deps.db.prepare('SELECT * FROM trips WHERE id = ?').get(tripId) as TripRowInternal | undefined;
  if (!trip) {
    json(res, 404, { error: 'TRIP_NOT_FOUND', message: 'Trip not found' });
    return;
  }
  if (!userId || !isTripMember(deps.db, tripId, userId)) {
    json(res, 403, { error: 'NOT_TRIP_MEMBER', message: 'X-User-Id no es miembro del viaje.' });
    return;
  }

  const destId = trip.destination_id;
  let destLat: number | null = null;
  let destLng: number | null = null;
  if (destId) {
    const dest = deps.db.prepare('SELECT lat, lng FROM locations WHERE id = ?').get(destId) as
      | { lat: number | null; lng: number | null }
      | undefined;
    destLat = dest?.lat ?? null;
    destLng = dest?.lng ?? null;
  }

  const rows = deps.db.prepare('SELECT * FROM locations WHERE category IS NOT NULL').all() as unknown as LocationRow[];
  const places = rows
    .filter((r) => {
      if (destId && r.parent_id === destId) return true;
      if (destLat != null && destLng != null && r.lat != null && r.lng != null) {
        return distanceKm(destLat, destLng, r.lat, r.lng) <= SEARCH_RADIUS_KM;
      }
      return false;
    })
    .map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category ?? 'activity',
      description: r.description ?? null,
      tags: parseTags(r.tags_json),
      rating: r.rating ?? null,
      cost: r.cost ?? null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const contentHash = createHash('md5').update(JSON.stringify(places)).digest('hex');
  json(res, 200, { places, contentHash });
}

function handleSaveChat(deps: InternalDeps, res: ServerResponse, body: Record<string, unknown>): void {
  const tripId = typeof body.tripId === 'string' ? body.tripId.trim() : '';
  const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
  const day = typeof body.day === 'string' ? body.day.trim() : '';
  const messages = body.messages;
  if (!tripId || !userId || !day) {
    json(res, 400, { error: 'INVALID_ARGUMENT', message: 'tripId, userId y day requeridos' });
    return;
  }
  if (!isValidMessages(messages)) {
    json(res, 400, { error: 'INVALID_MESSAGES', message: 'messages debe ser un array de {role, content}' });
    return;
  }
  const chat = upsertSuggestionChat(deps.db, { tripId, userId, day, messages });
  json(res, 200, chat);
}

// Despacha una request /internal/* (ya validada la ruta). Async porque los POST
// leen el body; se invoca con `void` desde el router sincrono.
async function dispatch(deps: InternalDeps, req: IncomingMessage, res: ServerResponse, method: string, pathname: string): Promise<void> {
  const remote = req.socket?.remoteAddress ?? '';
  if (!LOOPBACK.has(remote)) {
    json(res, 403, { error: 'FORBIDDEN', message: 'Acceso solo desde localhost.' });
    return;
  }

  const token = req.headers['x-internal-token'];
  if (!(typeof token === 'string' && matchesToken(deps.internalToken, token))) {
    json(res, 401, { error: 'UNAUTHORIZED', message: 'Token interno inválido.' });
    return;
  }

  try {
    if (method === 'GET' && pathname.startsWith('/internal/trip-context/')) {
      handleTripContext(deps, req, res, pathname.slice('/internal/trip-context/'.length));
      return;
    }
    if (method === 'GET' && pathname.startsWith('/internal/places-cache/')) {
      handlePlacesCache(deps, req, res, pathname.slice('/internal/places-cache/'.length));
      return;
    }
    if (method === 'POST' && pathname === '/internal/search-places') {
      await handleSearchPlaces(deps, res, await readBody(req));
      return;
    }
    if (method === 'POST' && pathname === '/internal/place-details') {
      await handlePlaceDetails(deps, res, await readBody(req));
      return;
    }
    if (method === 'POST' && pathname === '/internal/save-chat') {
      handleSaveChat(deps, res, await readBody(req));
      return;
    }
    json(res, 404, { error: 'NOT_FOUND', message: 'Ruta interna no encontrada.' });
  } catch (e) {
    json(res, 500, {
      error: 'INTERNAL_ERROR',
      message: e instanceof Error ? e.message : 'Error interno.',
    });
  }
}

// Router interno: devuelve true (sincrono) si la request pertenece a /internal/*.
export function createInternalRouter(deps: InternalDeps): (req: IncomingMessage, res: ServerResponse) => boolean {
  return (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith('/internal/')) return false;
    const method = req.method ?? 'GET';
    void dispatch(deps, req, res, method, url.pathname);
    return true;
  };
}
