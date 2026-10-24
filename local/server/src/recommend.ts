// Recomendador local (fase 2, sin Bedrock): sugerencias deterministas desde el
// catalogo del destino. Prioriza rating, variedad de categorias y presupuesto.
//
// Sin llamadas externas ni creditos: todo sale de SQLite.

import type { BudgetCategory } from './hasdata/category.ts';
import type { Db, LocationRow, TripRow } from './schema-types.ts';

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

// allItems: filas de trip_items (o actividades) con activity_id/title/cost.
type Itemish = {
  activity_id?: string | null;
  title?: string | null;
  cost?: number | null;
};

export function buildSuggestions(
  db: Db,
  trip: TripRow | null | undefined,
  allItems: Itemish[],
  target = 5,
): LocalSuggestion[] {
  if (!trip) return [];
  const rows = db
    .prepare(
      `SELECT * FROM locations
       WHERE parent_id = ? AND source = 'seed'
       ORDER BY rating DESC NULLS LAST, rating_count DESC NULLS LAST, name ASC`,
    )
    .all(trip.destination_id) as unknown as LocationRow[];

  if (rows.length === 0) return [];

  const already = new Set<string>();
  for (const it of allItems) {
    if (it.activity_id) already.add(it.activity_id);
    if (it.title) already.add(String(it.title).toLowerCase());
  }

  const spent = allItems.reduce((sum, it) => sum + (Number(it.cost) || 0), 0);
  const remaining = Math.max(0, Number(trip.total_budget || 0) - spent);

  // Agrupar por categoria (orden de rating descendente) y elegir con
  // round-robin para garantizar variedad sight/food/activity/nightlife.
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
