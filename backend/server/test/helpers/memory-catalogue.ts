// In-memory catalogue for API unit/integration tests. After M6e the API no
// longer talks to MongoDB; the real catalogue tests live in
// backend/locations-service.

import type { LocationCatalogue } from '../../src/catalogue/types.ts';
import type { LocationRow, UpsertLocationInput } from '../../src/schema-types.ts';

function row(partial: Partial<LocationRow> & { id: string; name: string }): LocationRow {
  return {
    source: 'seed',
    place_id: null,
    data_id: null,
    slug: null,
    category: null,
    raw_type: null,
    country: null,
    description: null,
    lat: null,
    lng: null,
    address: null,
    rating: null,
    rating_count: null,
    hours_json: null,
    website_url: null,
    social_links_json: null,
    phone: null,
    price_level: null,
    image_url: null,
    cost: null,
    tags_json: null,
    duration_hours: null,
    parent_id: null,
    last_updated: null,
    created_at: null,
    expires_at: null,
    ...partial,
  };
}

export class MemoryLocationCatalogue implements LocationCatalogue {
  private rows = new Map<string, LocationRow>();

  async getById(id: string): Promise<LocationRow | null> {
    return this.rows.get(id) ?? null;
  }

  async getByPlaceId(placeId: string): Promise<LocationRow | null> {
    return [...this.rows.values()].find((item) => item.place_id === placeId) ?? null;
  }

  async getByDataId(dataId: string): Promise<LocationRow | null> {
    return [...this.rows.values()].find((item) => item.data_id === dataId) ?? null;
  }

  async search(
    q: string,
    limit = 20,
    _options: { lat?: number | null; lng?: number | null } = {},
  ): Promise<LocationRow[]> {
    const tokens = q
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean);
    if (tokens.length === 0) return [];
    return [...this.rows.values()]
      .filter((item) => item.category != null)
      .filter((item) => tokens.every((token) => item.name.toLowerCase().includes(token)))
      .slice(0, limit);
  }

  async listDestinations(): Promise<LocationRow[]> {
    return [...this.rows.values()]
      .filter((item) => item.slug != null)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async listByParent(parentId: string, limit = 200): Promise<LocationRow[]> {
    return [...this.rows.values()]
      .filter((item) => item.parent_id === parentId && item.category != null)
      .sort(
        (a, b) =>
          (b.rating ?? 0) - (a.rating ?? 0) ||
          (b.rating_count ?? 0) - (a.rating_count ?? 0) ||
          a.name.localeCompare(b.name),
      )
      .slice(0, limit);
  }

  async listPlaces(): Promise<LocationRow[]> {
    return [...this.rows.values()].filter((item) => item.category != null);
  }

  async upsert(loc: UpsertLocationInput): Promise<LocationRow> {
    let existing: LocationRow | null = null;
    if (loc.place_id) existing = await this.getByPlaceId(loc.place_id);
    if (!existing && loc.data_id) existing = await this.getByDataId(loc.data_id);
    if (!existing) existing = await this.getById(loc.id);

    const id = existing?.id ?? loc.id;
    const next = row({
      ...(existing ?? {}),
      ...loc,
      price_level: typeof loc.price_level === 'number' ? loc.price_level : (existing?.price_level ?? null),
      id,
      name: loc.name,
    });
    this.rows.set(id, next);
    return next;
  }

  async clear(): Promise<void> {
    this.rows.clear();
  }

  async close(): Promise<void> {}
}
