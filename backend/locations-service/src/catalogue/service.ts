// Cache-first catalogue facade. With provider=preloaded it is a pass-through
// to MongoDB. With provider=hasdata it serves fresh cached rows, calls HasData
// on a cache miss, and upserts every HasData result with a 5-day expiry.
// Failed HasData calls fall back to whatever is already cached.

import {
  SEARCH_MAX_LIMIT,
  clampLimit,
  distanceKm,
  rankPlaces,
  withinRadius,
  type LocationCatalogue,
  type LocationRow,
  type SearchOptions,
  type UpsertLocationInput,
} from './types.ts';
import type { HasDataClient } from '../hasdata.ts';
import type { LocationsSettingsProvider } from '../settings.ts';

const PARENT_RADIUS_KM = 100;

export function isFresh(row: LocationRow, now = Date.now()): boolean {
  if (row.expires_at == null) return true;
  const expires = new Date(row.expires_at).getTime();
  return Number.isFinite(expires) && expires > now;
}

function dedupe(rows: LocationRow[]): LocationRow[] {
  const byKey = new Map<string, LocationRow>();
  for (const row of rows) {
    const key = row.place_id ?? row.id;
    const existing = byKey.get(key);
    // Later rows come from HasData and win over cached duplicates.
    if (!existing || row.source === 'hasdata') byKey.set(key, row);
  }
  return [...byKey.values()];
}

function nearestDestination(
  lat: number,
  lng: number,
  destinations: LocationRow[],
): LocationRow | null {
  let best: { row: LocationRow; distance: number } | null = null;
  for (const destination of destinations) {
    if (destination.slug == null || destination.lat == null || destination.lng == null) continue;
    const distance = distanceKm(lat, lng, destination.lat, destination.lng);
    if (distance > PARENT_RADIUS_KM) continue;
    if (!best || distance < best.distance) best = { row: destination, distance };
  }
  return best?.row ?? null;
}

export interface CatalogueServiceOptions {
  store: LocationCatalogue;
  settings: LocationsSettingsProvider;
  hasdata?: HasDataClient;
  cacheTtlMs: number;
}

export class CatalogueService implements LocationCatalogue {
  private readonly store: LocationCatalogue;
  private readonly settings: LocationsSettingsProvider;
  private readonly hasdata?: HasDataClient;
  private readonly cacheTtlMs: number;

  constructor({ store, settings, hasdata, cacheTtlMs }: CatalogueServiceOptions) {
    this.store = store;
    this.settings = settings;
    this.hasdata = hasdata;
    this.cacheTtlMs = cacheTtlMs;
  }

  private remote(): HasDataClient | null {
    const settings = this.settings.get();
    if (settings.provider !== 'hasdata' || settings.apiKey.length === 0) return null;
    return this.hasdata ?? null;
  }

  private async persist(rows: UpsertLocationInput[]): Promise<LocationRow[]> {
    if (rows.length === 0) return [];
    const destinations = await this.store.listDestinations();
    const expiresAt = new Date(Date.now() + this.cacheTtlMs).toISOString();
    const saved: LocationRow[] = [];

    for (const row of rows) {
      const next: UpsertLocationInput = { ...row, expires_at: expiresAt };
      if (next.parent_id == null && next.lat != null && next.lng != null) {
        const destination = nearestDestination(next.lat, next.lng, destinations);
        if (destination?.slug) next.parent_id = destination.slug;
      }
      const existing = next.place_id
        ? await this.store.getByPlaceId(next.place_id)
        : await this.store.getById(next.id);
      // Never put an expiry on a committed seed row; only HasData-only rows
      // are cache entries. Enriched seed rows keep expires_at=null.
      if (existing?.source === 'seed') next.expires_at = null;
      saved.push(await this.store.upsert(next));
    }
    return saved;
  }

  async ping(): Promise<void> {
    await this.store.ping();
  }

  async getById(id: string): Promise<LocationRow | null> {
    const cached = await this.store.getById(id);
    if (!cached || !this.remote()) return cached;
    if (isFresh(cached)) return cached;
    if (!cached.place_id) return cached;
    return (await this.getByPlaceId(cached.place_id)) ?? cached;
  }

  async getByPlaceId(placeId: string): Promise<LocationRow | null> {
    const cached = await this.store.getByPlaceId(placeId);
    const remote = this.remote();
    if (!remote) return cached;
    if (cached && isFresh(cached)) return cached;

    try {
      const row = await remote.getPlace(placeId);
      if (!row) return cached;
      const [saved] = await this.persist([row]);
      return saved ?? cached;
    } catch (error) {
      console.warn('[locations] HasData place failed; serving cache', {
        reason: error instanceof Error ? error.message : 'unknown error',
      });
      return cached;
    }
  }

  async getByDataId(dataId: string): Promise<LocationRow | null> {
    return this.store.getByDataId(dataId);
  }

  async search(q: string, options: SearchOptions = {}): Promise<LocationRow[]> {
    const limit = clampLimit(options.limit, SEARCH_MAX_LIMIT, SEARCH_MAX_LIMIT);
    const cached = await this.store.search(q, { ...options, limit });
    const remote = this.remote();
    if (!remote) return cached;

    const fresh = cached.filter((row) => isFresh(row));
    if (fresh.length > 0) return fresh.slice(0, limit);

    try {
      const rows = await remote.search(q, { lat: options.lat, lng: options.lng, limit });
      if (rows.length === 0) return cached;
      const saved = await this.persist(rows);
      return rankPlaces(
        withinRadius(dedupe([...cached, ...saved]), options.lat, options.lng),
      ).slice(0, limit);
    } catch (error) {
      console.warn('[locations] HasData search failed; serving cache', {
        reason: error instanceof Error ? error.message : 'unknown error',
      });
      return cached;
    }
  }

  async listDestinations(): Promise<LocationRow[]> {
    return this.store.listDestinations();
  }

  async listByParent(parentId: string, limit?: number): Promise<LocationRow[]> {
    return this.store.listByParent(parentId, limit);
  }

  async listPlaces(): Promise<LocationRow[]> {
    return this.store.listPlaces();
  }

  async countPlaces(): Promise<number> {
    return this.store.countPlaces();
  }

  async upsert(loc: UpsertLocationInput): Promise<LocationRow> {
    return this.store.upsert(loc);
  }

  async clear(): Promise<void> {
    await this.store.clear();
  }

  async close(): Promise<void> {
    await this.store.close();
  }
}
