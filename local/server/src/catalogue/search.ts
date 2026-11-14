// Catalogue-backed location search. The local runner has no external place
// provider: every result comes from the local catalogue (DynamoDB today,
// MongoDB in M2). Favorites-first ordering and the 75 km radius stay here.

import { distanceKm } from '../geo.ts';
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
  q: string;
  lat?: number | null;
  lng?: number | null;
  userId?: string | null;
}

// GraphQL/internal search entry point. Kept async for callers that expect the
// old cache-first signature; there is no remote fallback anymore.
export async function searchLocationsWithCatalogue({
  catalogue,
  db,
  q,
  lat,
  lng,
  userId,
}: CatalogueSearchDeps): Promise<LocationRow[]> {
  return searchCatalogue(catalogue, db, q, { lat, lng }, 20, userId);
}
