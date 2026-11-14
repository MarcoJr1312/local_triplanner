// Deterministic suggestions from the destination catalogue (no external calls).

import type { LocationCatalogue } from '../catalogue/types.ts';
import type { LocationRow, TripRow } from '../schema-types.ts';

const CATEGORY_DEFAULT_COST: Record<string, number> = { food: 30, sight: 20, activity: 35, nightlife: 25 };

function estimateCost(loc: LocationRow): number {
  if (loc.cost != null && Number(loc.cost) > 0) return Number(loc.cost);
  return CATEGORY_DEFAULT_COST[loc.category ?? ''] ?? 20;
}

function rationaleFor(loc: LocationRow, cost: number, remaining: number): string {
  const parts: string[] = [];
  if (loc.rating != null && loc.rating >= 4.5) parts.push('muy bien valorado');
  else if (loc.rating != null) parts.push('buena opcion');
  else parts.push('favorito del catalogo');
  if (cost <= remaining) parts.push('encaja en tu presupuesto');
  return `${parts.join(' y ')}.`;
}

export interface LocalSuggestion {
  title: string;
  category: string;
  cost: number;
  rationale: string;
  activityId: string;
}

type Itemish = {
  activity_id?: string | null;
  title?: string | null;
  cost?: number | null;
};

export async function buildSuggestions(
  catalogue: LocationCatalogue,
  trip: TripRow | null | undefined,
  allItems: Itemish[],
  target = 5,
): Promise<LocalSuggestion[]> {
  if (!trip?.destination_id) return [];

  const rows = (await catalogue.listByParent(trip.destination_id))
    .filter((loc) => loc.source === 'seed')
    .sort(
      (a, b) =>
        (b.rating ?? 0) - (a.rating ?? 0) ||
        (b.rating_count ?? 0) - (a.rating_count ?? 0) ||
        a.name.localeCompare(b.name),
    );

  if (rows.length === 0) return [];

  const already = new Set<string>();
  for (const it of allItems) {
    if (it.activity_id) already.add(it.activity_id);
    if (it.title) already.add(String(it.title).toLowerCase());
  }

  const spent = allItems.reduce((sum, it) => sum + (Number(it.cost) || 0), 0);
  const remaining = Math.max(0, Number(trip.total_budget || 0) - spent);

  const byCategory = new Map<string, LocationRow[]>();
  for (const loc of rows) {
    if (already.has(loc.id) || already.has((loc.name ?? '').toLowerCase())) continue;
    const cat = loc.category ?? 'activity';
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)?.push(loc);
  }

  const categories = [...byCategory.keys()];
  const picks: LocationRow[] = [];
  while (picks.length < target && categories.length > 0) {
    for (let i = categories.length - 1; i >= 0; i--) {
      const cat = categories[i];
      if (cat == null) continue;
      const pool = byCategory.get(cat);
      const loc = pool?.shift();
      if (!loc || pool?.length === 0) categories.splice(i, 1);
      if (loc) {
        picks.push(loc);
        if (picks.length >= target) break;
      }
    }
  }

  return picks.map((loc) => {
    const cost = estimateCost(loc);
    return {
      title: loc.name,
      category: loc.category ?? 'activity',
      cost,
      rationale: rationaleFor(loc, cost, remaining),
      activityId: loc.id,
    };
  });
}
