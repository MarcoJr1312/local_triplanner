// Location catalogue contract. DynamoDB is the source of truth in AWS and in
// local dev (DynamoDB Local), so search/details do not depend on Postgres.

import type { LocationRow, UpsertLocationInput } from '../schema-types.ts';

export interface LocationCatalogue {
  /** Insert or update, deduping by place_id/data_id when present. */
  upsert(loc: UpsertLocationInput): Promise<LocationRow>;
  getById(id: string): Promise<LocationRow | null>;
  getByPlaceId(placeId: string): Promise<LocationRow | null>;
  getByDataId(dataId: string): Promise<LocationRow | null>;
  /** Token AND match over the lowercased name; places only (category set). */
  search(q: string, limit?: number): Promise<LocationRow[]>;
  /** Rows with a slug (destinations). */
  listDestinations(): Promise<LocationRow[]>;
  /** Places whose parent is this destination. */
  listByParent(parentId: string): Promise<LocationRow[]>;
  /** Test/seed helper. */
  clear(): Promise<void>;
}

export function tokenize(q: unknown): string[] {
  return String(q ?? '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
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
