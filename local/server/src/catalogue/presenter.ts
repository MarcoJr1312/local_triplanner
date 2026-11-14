// Maps a catalogue row to the GraphQL `Location` shape.
// Kept separate from the catalogue adapters so the data store does not own the API shape.

import type { HoursFormat, Location, LocationRow, SocialLink } from '../schema-types.ts';

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

export function locationRowToGraphQL(
  row: LocationRow | null | undefined,
  favIds?: Set<string> | null,
): Location | null {
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
