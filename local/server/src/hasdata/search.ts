// Flujo de busqueda cache-first:
//   1) FTS5 en locations
//   2) si miss -> HasData search (max 2 paginas)
//   3) normalizar -> upsert en locations
//   4) devolver

import { normalizeHasDataPlace } from './normalize.ts';
import { upsertLocation } from '../db.ts';
import { HasDataClient, type HasDataResponse } from './client.ts';
import type { HasDataRaw } from './normalize.ts';
import type { Db, Location, LocationRow, HoursFormat, SocialLink } from '../schema-types.ts';

const PAGE_SIZE = 20;
const MAX_PAGES = 2;
const SEARCH_RADIUS_KM = 75; // resultados dentro de ~75km del destino del viaje

export interface SearchOptions {
  lat?: number | null;
  lng?: number | null;
}

// Distancia haversine en km entre dos puntos.
export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Filtra filas por proximidad al destino (si no hay coords, devuelve todas).
function filterByDistance(
  rows: LocationRow[],
  lat: number | null | undefined,
  lng: number | null | undefined,
  radiusKm = SEARCH_RADIUS_KM,
): LocationRow[] {
  if (lat == null || lng == null) return rows;
  return rows.filter(
    (r) => r.lat != null && r.lng != null && distanceKm(lat, lng, r.lat, r.lng) <= radiusKm,
  );
}

// Construye una query FTS5 segura a partir del texto del usuario (tokens con prefijo OR).
export function buildFtsQuery(q: unknown): string | null {
  const tokens = String(q ?? '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t.replaceAll('"', '')}"*`).join(' OR ');
}

// Busqueda local en FTS5 sobre locations (solo lugares con categoria, no destinos).
// Con lat/lng se limita al area del destino (pais/ciudad del viaje).
// Favoritos del usuario SIEMPRE primero (LEFT JOIN user_favorites).
export function searchLocal(db: Db, q: string, { lat, lng }: SearchOptions = {}, limit = 20, userId?: string | null): LocationRow[] {
  const fts = buildFtsQuery(q);
  if (!fts) return [];
  const rows = db.prepare(`
    SELECT l.*
    FROM locations_fts f
    JOIN locations l ON l.id = f.location_id
    LEFT JOIN user_favorites fav ON fav.location_id = l.id AND fav.user_id = ?
    WHERE locations_fts MATCH ?
      AND l.category IS NOT NULL
    ORDER BY CASE WHEN fav.user_id IS NULL THEN 1 ELSE 0 END, bm25(locations_fts)
    LIMIT 100
  `).all(userId ?? '', fts) as unknown as LocationRow[];
  return filterByDistance(rows, lat, lng).slice(0, limit);
}

// Extrae resultados de la respuesta HasData manejando localResults[]/placeResults[]
// sin asumir siempre lista, con fallback a results/data/places.
export function extractResults(data: HasDataResponse | null | undefined): HasDataRaw[] {
  const list: HasDataRaw[] = [];
  const append = (v: unknown) => {
    if (Array.isArray(v)) list.push(...(v as HasDataRaw[]));
    else if (v && typeof v === 'object') list.push(v as HasDataRaw);
  };
  append(data?.localResults);
  append(data?.placeResults);
  if (list.length === 0) {
    for (const key of ['results', 'data', 'places'] as const) append(data?.[key]);
  }
  return list;
}

// Pagina sobre HasData: max MAX_PAGES paginas (presupuesto de creditos), start 0/20/40...
export async function searchHasDataPaged(client: HasDataClient, q: string, { lat, lng }: SearchOptions = {}): Promise<HasDataRaw[]> {
  const collected: HasDataRaw[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const start = page * PAGE_SIZE;
    const data = await client.search(q, { lat, lng, start });
    const raw = extractResults(data);
    collected.push(...raw);
    if (raw.length < PAGE_SIZE) break;
  }
  return collected;
}

// Mapea una fila de locations a la forma GraphQL `Location`.
// favIds (opcional): set de ids favoritos del usuario -> isFavorite.
export function locationRowToGraphQL(row: LocationRow | null | undefined, favIds?: Set<string> | null): Location | null {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    category: row.category ?? 'activity',
    rawType: row.raw_type ?? null,
    description: row.description ?? null,
    lat: row.lat,
    lng: row.lng,
    address: row.address ?? null,
    rating: row.rating ?? null,
    ratingCount: row.rating_count ?? null,
    phone: row.phone ?? null,
    priceLevel: row.price_level ?? null,
    websiteUrl: row.website_url ?? null,
    imageUrl: row.image_url ?? null,
    cost: row.cost ?? null,
    durationHours: row.duration_hours ?? null,
    tags: row.tags_json ? safeJsonArray(row.tags_json) : [],
    hours: row.hours_json ? (safeJson(row.hours_json) as HoursFormat | null) : null,
    socialLinks: row.social_links_json ? (safeJson(row.social_links_json) as SocialLink[] | null) : null,
    source: row.source,
    placeId: row.place_id ?? null,
    isFavorite: favIds ? favIds.has(row.id) : false,
  };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s) as unknown;
  } catch {
    return null;
  }
}

function safeJsonArray(s: string): unknown[] {
  try {
    const v = JSON.parse(s) as unknown;
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

// Extrae el objeto de detalle de la respuesta del endpoint /place (formas defensivas).
export function extractPlaceDetail(data: HasDataResponse | null | undefined): unknown {
  return data?.data ?? data?.place ?? data?.placeDetails ?? data?.result ?? data;
}

// Convierte webResults (place + fetchWebResults) a social_links_json.
export function webResultsToSocialLinks(data: HasDataResponse | null | undefined): string | null {
  const wr = (data?.webResults ?? data?.web_results) as unknown;
  if (!Array.isArray(wr)) return null;
  const links = wr
    .map((r) => {
      const rec = r as Record<string, unknown>;
      return {
        title: (rec?.title ?? rec?.name ?? null) as string | null,
        url: (rec?.link ?? rec?.url ?? rec?.website ?? null) as string | null,
      };
    })
    .filter((l): l is { title: string | null; url: string } => Boolean(l.url));
  return links.length ? JSON.stringify(links) : null;
}

export interface SearchLocationsDeps {
  db: Db;
  client: HasDataClient | null;
  q: string;
  lat?: number | null;
  lng?: number | null;
  userId?: string | null;
}

// Flujo completo de searchLocations: cache-first + fallback HasData + upsert.
// Devuelve filas de locations (ya en DB). Con lat/lng todo se limita al area
// del destino (FTS filtrado por distancia + HasData con ll=@lat,lng,14z).
// Favoritos del usuario SIEMPRE primero.
export async function searchLocations({ db, client, q, lat, lng, userId }: SearchLocationsDeps): Promise<LocationRow[]> {
  const local = searchLocal(db, q, { lat, lng }, 20, userId);
  if (local.length > 0) return local;
  if (!client) return [];

  const rawResults = await searchHasDataPaged(client, q, { lat, lng });
  // Dedupe por place_id/data_id: HasData puede devolver el mismo lugar en
  // paginas/arrays distintos; sin esto la UI renderiza keys duplicadas.
  const seenRaw = new Set<string>();
  const normalized = rawResults
    .map(normalizeHasDataPlace)
    .filter((l) => l.place_id != null || l.data_id != null)
    .filter((l) => {
      const key = (l.place_id ?? l.data_id) as string;
      if (seenRaw.has(key)) return false;
      seenRaw.add(key);
      return true;
    });

  const saved: LocationRow[] = [];
  const seenIds = new Set<string>();
  for (const loc of normalized) {
    const row = upsertLocation(db, loc);
    if (row && !seenIds.has(row.id)) {
      seenIds.add(row.id);
      saved.push(row);
    }
  }
  // Favoritos primero en el fallback HasData (el upsert no reordena).
  if (userId) {
    const favIds = new Set(
      (db.prepare('SELECT location_id FROM user_favorites WHERE user_id = ?').all(userId) as {
        location_id: string;
      }[]).map((r) => r.location_id)
    );
    saved.sort((a, b) => {
      const aFav = favIds.has(a.id) ? 0 : 1;
      const bFav = favIds.has(b.id) ? 0 : 1;
      return aFav - bFav;
    });
  }
  return saved;
}
