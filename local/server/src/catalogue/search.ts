// Catalogue-backed location search. Replaces the SQLite/FTS5 flow:
//   1) token search in DynamoDB
//   2) miss -> HasData (max 2 pages)
//   3) normalize, upsert into the catalogue, return
// Favorites-first ordering and the 75 km radius stay in the app layer.

import { normalizeHasDataPlace, type HasDataRaw } from '../hasdata/normalize.ts';
import { extractResults, searchHasDataPaged, distanceKm } from '../hasdata/search.ts';
import type { HasDataClient } from '../hasdata/client.ts';
import type { AsyncDb } from '../pg/db.ts';
import { favoriteIdsForUser } from '../pg/favorites.ts';
import type { LocationRow } from '../schema-types.ts';
import type { LocationCatalogue } from './types.ts';

const SEARCH_RADIUS_KM = 75;

export interface CatalogueSearchOptions {
  lat?: number | null;
  lng?: number | null;
}

function withinRadius(rows: LocationRow[], lat?: number | null, lng?: number | null): LocationRow[] {
  if (lat == null || lng == null) return rows;
  return rows.filter(
    (r) => r.lat != null && r.lng != null && distanceKm(lat, lng, r.lat, r.lng) <= SEARCH_RADIUS_KM,
  );
}

function rank(rows: LocationRow[], favorites: Set<string>): LocationRow[] {
  return [...rows].sort((a, b) => {
    const favA = favorites.has(a.id) ? 0 : 1;
    const favB = favorites.has(b.id) ? 0 : 1;
    if (favA !== favB) return favA - favB;
    if ((b.rating ?? 0) !== (a.rating ?? 0)) return (b.rating ?? 0) - (a.rating ?? 0);
    if ((b.rating_count ?? 0) !== (a.rating_count ?? 0)) return (b.rating_count ?? 0) - (a.rating_count ?? 0);
    return a.name.localeCompare(b.name);
  });
}

// Catalogue search, favorites first, limited to the destination area.
export async function searchCatalogue(
  catalogue: LocationCatalogue,
  db: AsyncDb,
  q: string,
  options: CatalogueSearchOptions = {},
  limit = 20,
  userId?: string | null,
): Promise<LocationRow[]> {
  const rows = await catalogue.search(q, 100);
  const favorites = userId ? await favoriteIdsForUser(db, userId) : new Set<string>();
  const filtered = withinRadius(rows, options.lat, options.lng);
  return rank(filtered, favorites).slice(0, limit);
}

export interface CatalogueSearchDeps {
  catalogue: LocationCatalogue;
  db: AsyncDb;
  client: HasDataClient | null;
  q: string;
  lat?: number | null;
  lng?: number | null;
  userId?: string | null;
}

// Full searchLocations flow: cache-first, HasData fallback, upsert on the way in.
export async function searchLocationsWithCatalogue({
  catalogue,
  db,
  client,
  q,
  lat,
  lng,
  userId,
}: CatalogueSearchDeps): Promise<LocationRow[]> {
  const local = await searchCatalogue(catalogue, db, q, { lat, lng }, 20, userId);
  if (local.length > 0) return local;
  if (!client) return [];

  const rawResults = await searchHasDataPaged(client, q, { lat, lng });
  const seen = new Set<string>();
  const normalized = rawResults
    .map(normalizeHasDataPlace)
    .filter((l) => l.place_id != null || l.data_id != null)
    .filter((l) => {
      const key = (l.place_id ?? l.data_id) as string;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  const saved: LocationRow[] = [];
  const seenIds = new Set<string>();
  for (const loc of normalized) {
    const row = await catalogue.upsert(loc);
    if (!seenIds.has(row.id)) {
      seenIds.add(row.id);
      saved.push(row);
    }
  }

  const favorites = userId ? await favoriteIdsForUser(db, userId) : new Set<string>();
  return rank(withinRadius(saved, lat, lng), favorites);
}

export type { HasDataRaw };
