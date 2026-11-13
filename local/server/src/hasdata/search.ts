// HasData search helpers that do not touch storage.
// Catalogue-backed search lives in catalogue/search.ts.

import type { HasDataClient, HasDataResponse } from './client.ts';
import type { LocationRow, Location, HoursFormat, SocialLink } from '../schema-types.ts';
import type { HasDataRaw } from './normalize.ts';

const PAGE_SIZE = 20;
const MAX_PAGES = 2;

export interface SearchOptions {
  lat?: number | null;
  lng?: number | null;
}

// Haversine distance in km.
export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Extracts results from HasData, tolerating localResults/placeResults and the
// results/data/places fallbacks.
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

// Pages HasData: max MAX_PAGES pages (credit budget), start 0/20/40...
export async function searchHasDataPaged(
  client: HasDataClient,
  q: string,
  { lat, lng }: SearchOptions = {},
): Promise<HasDataRaw[]> {
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

// Maps a catalogue row to the GraphQL `Location` shape.
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

// Extracts the detail object from the /place response (defensive shapes).
export function extractPlaceDetail(data: HasDataResponse | null | undefined): unknown {
  return data?.data ?? data?.place ?? data?.placeDetails ?? data?.result ?? data;
}

// Converts webResults to social_links_json.
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
