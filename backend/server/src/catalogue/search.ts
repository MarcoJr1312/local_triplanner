// Catalogue-backed location search. The local runner has no external place
// provider: every result comes from MongoDB. Favorites-first ordering and the
// 75 km radius stay here. Favorites are supplied by the caller (users
// service); this module no longer reads any database.

import { distanceKm } from '../geo.ts';
import type { LocationRow } from '../schema-types.ts';
import { SEARCH_RADIUS_KM, type LocationCatalogue } from './types.ts';

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

function rank(rows: LocationRow[], favorites: ReadonlySet<string>): LocationRow[] {
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
  q: string,
  options: CatalogueSearchOptions = {},
  limit = 20,
  favorites: ReadonlySet<string> = new Set<string>(),
): Promise<LocationRow[]> {
  const rows = await catalogue.search(q, 100, { lat: options.lat, lng: options.lng });
  const filtered = withinRadius(rows, options.lat, options.lng);
  return rank(filtered, favorites).slice(0, limit);
}

export interface CatalogueSearchDeps {
  catalogue: LocationCatalogue;
  q: string;
  lat?: number | null;
  lng?: number | null;
  favorites?: ReadonlySet<string>;
}

// GraphQL/internal search entry point. Kept async for callers that expect the
// old cache-first signature; there is no remote fallback anymore.
export async function searchLocationsWithCatalogue({
  catalogue,
  q,
  lat,
  lng,
  favorites = new Set<string>(),
}: CatalogueSearchDeps): Promise<LocationRow[]> {
  return searchCatalogue(catalogue, q, { lat, lng }, 20, favorites);
}
