// Contrato del catalogo de lugares. Los DTO usan snake_case porque son el
// contrato de almacenamiento que la API ya consume; la API los transforma al
// shape GraphQL con su presenter.

export interface LocationRow {
  id: string;
  source: string | null;
  place_id: string | null;
  data_id: string | null;
  slug: string | null;
  name: string;
  category: string | null;
  raw_type: string | null;
  country: string | null;
  description: string | null;
  lat: number | null;
  lng: number | null;
  address: string | null;
  rating: number | null;
  rating_count: number | null;
  hours_json: string | null;
  website_url: string | null;
  social_links_json: string | null;
  phone: string | null;
  price_level: number | null;
  image_url: string | null;
  cost: number | null;
  tags_json: string | null;
  duration_hours: number | null;
  parent_id: string | null;
  last_updated: string | null;
  created_at?: string | null;
  expires_at?: number | null;
}

export interface UpsertLocationInput {
  id: string;
  source?: string | null;
  place_id?: string | null;
  data_id?: string | null;
  slug?: string | null;
  name: string;
  category?: string | null;
  raw_type?: string | null;
  country?: string | null;
  description?: string | null;
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
  rating?: number | null;
  rating_count?: number | null;
  hours_json?: string | null;
  website_url?: string | null;
  social_links_json?: string | null;
  phone?: string | null;
  price_level?: string | number | null;
  image_url?: string | null;
  cost?: number | null;
  tags_json?: string | null;
  duration_hours?: number | null;
  parent_id?: string | null;
  last_updated?: string | null;
}

export interface SearchOptions {
  lat?: number | null;
  lng?: number | null;
  limit?: number;
}

export interface LocationCatalogue {
  ping(): Promise<void>;
  getById(id: string): Promise<LocationRow | null>;
  getByPlaceId(placeId: string): Promise<LocationRow | null>;
  getByDataId(dataId: string): Promise<LocationRow | null>;
  search(q: string, options?: SearchOptions): Promise<LocationRow[]>;
  listDestinations(): Promise<LocationRow[]>;
  listByParent(parentId: string, limit?: number): Promise<LocationRow[]>;
  listPlaces(): Promise<LocationRow[]>;
  upsert(loc: UpsertLocationInput): Promise<LocationRow>;
  clear(): Promise<void>;
  close(): Promise<void>;
}

export const SEARCH_RADIUS_KM = 75;
export const SEARCH_MAX_LIMIT = 100;
export const ACTIVITIES_MAX_LIMIT = 200;

export function tokenize(q: unknown): string[] {
  return String(q ?? '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * earthKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function withinRadius(
  rows: LocationRow[],
  lat?: number | null,
  lng?: number | null,
): LocationRow[] {
  if (lat == null || lng == null) return rows;
  return rows.filter(
    (row) => row.lat != null && row.lng != null && distanceKm(lat, lng, row.lat, row.lng) <= SEARCH_RADIUS_KM,
  );
}

export function rankPlaces(rows: LocationRow[]): LocationRow[] {
  return [...rows].sort(
    (a, b) =>
      (b.rating ?? 0) - (a.rating ?? 0) ||
      (b.rating_count ?? 0) - (a.rating_count ?? 0) ||
      a.name.localeCompare(b.name),
  );
}

export function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), 1), max);
}

export const LOCATION_FIELDS = [
  'id',
  'source',
  'place_id',
  'data_id',
  'slug',
  'name',
  'category',
  'raw_type',
  'country',
  'description',
  'lat',
  'lng',
  'address',
  'rating',
  'rating_count',
  'hours_json',
  'website_url',
  'social_links_json',
  'phone',
  'price_level',
  'image_url',
  'cost',
  'tags_json',
  'duration_hours',
  'parent_id',
  'last_updated',
  'created_at',
  'expires_at',
] as const;
