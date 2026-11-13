// Internal REST endpoints (loopback only) consumed by the agent service.

import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extractPlaceDetail, webResultsToSocialLinks, distanceKm } from './hasdata/search.ts';
import type { HasDataClient, HasDataResponse } from './hasdata/client.ts';
import { upsertSuggestionChat } from './pg/chats.ts';
import { isValidMessages } from './chats.ts';
import { isTripMember } from './pg/trips.ts';
import { favoriteIdsForUser } from './pg/favorites.ts';
import { listUserInterests } from './pg/interests.ts';
import { searchLocationsWithCatalogue } from './catalogue/search.ts';
import type { LocationCatalogue } from './catalogue/types.ts';
import type { AsyncDb } from './pg/db.ts';
import type { LocationRow, TripRow } from './schema-types.ts';

const SEARCH_RADIUS_KM = 75;
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export interface InternalDeps {
  db: AsyncDb;
  catalogue: LocationCatalogue;
  hasdata: HasDataClient | null;
  internalToken: string;
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

// Identity prefers the normalized email (the app's real identity); falls back
// to X-User-Id for demo mode.
async function resolveUserId(deps: InternalDeps, req: IncomingMessage): Promise<string | null> {
  const email = headerUserEmail(req);
  if (email) {
    const row = await deps.db
      .prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?)')
      .get<{ id: string }>(email.trim());
    if (row) return row.id;
  }
  return headerUserId(req);
}

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
      // ignore
    }
  }
  const sl = pick(detail, ['socialLinks', 'social_links', 'socialLinksJson']);
  if (Array.isArray(sl)) return sl as unknown[];
  if (typeof sl === 'string') {
    try {
      const v = JSON.parse(sl) as unknown;
      if (Array.isArray(v)) return v;
    } catch {
      // ignore
    }
  }
  return null;
}

async function destinationCoords(deps: InternalDeps, destinationId: string | null): Promise<{ lat: number | null; lng: number | null }> {
  if (!destinationId) return { lat: null, lng: null };
  const dest = await deps.catalogue.getById(destinationId);
  return { lat: dest?.lat ?? null, lng: dest?.lng ?? null };
}

async function handleTripContext(deps: InternalDeps, req: IncomingMessage, res: ServerResponse, rawTripId: string): Promise<void> {
  const tripId = decodeURIComponent(rawTripId);
  const userId = await resolveUserId(deps, req);
  const trip = await deps.db.prepare('SELECT * FROM trips WHERE id = ?').get<TripRow>(tripId);
  if (!trip) {
    json(res, 404, { error: 'TRIP_NOT_FOUND', message: 'Trip not found' });
    return;
  }
  if (!userId || !(await isTripMember(deps.db, tripId, userId))) {
    json(res, 403, { error: 'NOT_TRIP_MEMBER', message: 'X-User-Id no es miembro del viaje.' });
    return;
  }

  const dest = await destinationCoords(deps, trip.destination_id);
  const items = await deps.db
    .prepare('SELECT * FROM trip_items WHERE trip_id = ? ORDER BY day ASC, start_time ASC NULLS LAST, "order" ASC')
    .all<ItemRowInternal>(tripId);
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

  const members = (
    await deps.db
      .prepare(
        'SELECT m.user_id, m.role, u.display_name FROM trip_members m JOIN users u ON u.id = m.user_id WHERE m.trip_id = ? ORDER BY m.joined_at ASC',
      )
      .all<{ user_id: string; role: string; display_name: string | null }>(tripId)
  ).map((m) => ({ userId: m.user_id, displayName: m.display_name, role: m.role }));

  const langRow = await deps.db.prepare('SELECT language FROM users WHERE id = ?').get<{ language: string | null }>(userId);
  const userLanguage = langRow?.language || 'es';

  json(res, 200, {
    userId,
    trip: {
      id: trip.id,
      name: trip.name,
      destinationId: trip.destination_id ?? null,
      destinationName: trip.destination_name ?? null,
      lat: dest.lat,
      lng: dest.lng,
      startDate: trip.start_date,
      endDate: trip.end_date,
      totalBudget: Number(trip.total_budget) || 0,
      spent,
    },
    days,
    members,
    userLanguage,
    interests: await listUserInterests(deps.db, userId),
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
    const trip = await deps.db.prepare('SELECT destination_id FROM trips WHERE id = ?').get<{ destination_id: string | null }>(tripId);
    const coords = await destinationCoords(deps, trip?.destination_id ?? null);
    lat = coords.lat;
    lng = coords.lng;
  }

  const rows = await searchLocationsWithCatalogue({ catalogue: deps.catalogue, db: deps.db, client: deps.hasdata, q, lat, lng, userId });
  const favIds = userId ? await favoriteIdsForUser(deps.db, userId) : new Set<string>();
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

async function handlePlacesCache(deps: InternalDeps, req: IncomingMessage, res: ServerResponse, rawTripId: string): Promise<void> {
  const tripId = decodeURIComponent(rawTripId);
  const userId = await resolveUserId(deps, req);
  const trip = await deps.db.prepare('SELECT * FROM trips WHERE id = ?').get<TripRow>(tripId);
  if (!trip) {
    json(res, 404, { error: 'TRIP_NOT_FOUND', message: 'Trip not found' });
    return;
  }
  if (!userId || !(await isTripMember(deps.db, tripId, userId))) {
    json(res, 403, { error: 'NOT_TRIP_MEMBER', message: 'X-User-Id no es miembro del viaje.' });
    return;
  }

  const destId = trip.destination_id;
  const { lat: destLat, lng: destLng } = await destinationCoords(deps, destId);
  const rows = await deps.catalogue.listPlaces();

  const places = rows
    .filter((r: LocationRow) => {
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

async function handleSaveChat(deps: InternalDeps, res: ServerResponse, body: Record<string, unknown>): Promise<void> {
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
  const chat = await upsertSuggestionChat(deps.db, { tripId, userId, day, messages });
  json(res, 200, chat);
}

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
      await handleTripContext(deps, req, res, pathname.slice('/internal/trip-context/'.length));
      return;
    }
    if (method === 'GET' && pathname.startsWith('/internal/places-cache/')) {
      await handlePlacesCache(deps, req, res, pathname.slice('/internal/places-cache/'.length));
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
      await handleSaveChat(deps, res, await readBody(req));
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

export function createInternalRouter(deps: InternalDeps): (req: IncomingMessage, res: ServerResponse) => boolean {
  return (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith('/internal/')) return false;
    const method = req.method ?? 'GET';
    void dispatch(deps, req, res, method, url.pathname);
    return true;
  };
}
