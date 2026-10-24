// Mapeo keyword-based del tipo de Google Maps -> una de las 4 categorias de presupuesto
// de Triplanner (sight|food|activity|nightlife). Ver STD Integracion HasData + ARQ.
// Desconocido -> 'activity'. El type original SIEMPRE se guarda en raw_type.

export type BudgetCategory = 'sight' | 'food' | 'activity' | 'nightlife';

const KEYWORDS: Record<Exclude<BudgetCategory, 'activity'>, readonly string[]> = {
  sight: [
    'museum', 'gallery', 'monument', 'church', 'cathedral', 'temple', 'landmark',
    'tourist attraction', 'viewpoint', 'aquarium', 'zoo', 'historic', 'castle',
    'memorial', 'statue', 'mosque', 'synagogue', 'shrine', 'art gallery',
  ],
  food: [
    'restaurant', 'cafe', 'coffee', 'bakery', 'bistro', 'brasserie', 'food', 'meal',
    'grocery', 'pizza', 'burger', 'sushi', 'deli', 'steak', 'seafood', 'ice cream',
    'dessert', 'brunch', 'breakfast', 'taqueria', 'taco', 'ramen', 'noodle', 'barbecue',
    'bbq', 'grill', 'kitchen', 'eatery', 'diner', 'canteen', 'gastropub', 'bar & grill',
  ],
  nightlife: [
    'night club', 'nightclub', 'disco', 'lounge', 'cocktail', 'karaoke', 'bar', 'pub',
    'brewery', 'dance', 'nightlife',
  ],
};

function hasAny(text: string, words: readonly string[]): boolean {
  return words.some((w) => text.includes(w));
}

export function mapTypeToCategory(type: unknown): BudgetCategory {
  if (type == null) return 'activity';
  const t = String(type).toLowerCase();

  // bar/pub "gastro" (gastropub, gastro bar) -> food
  if (/bar|pub/.test(t) && /gastro/.test(t)) return 'food';

  if (hasAny(t, KEYWORDS.sight)) return 'sight';
  if (hasAny(t, KEYWORDS.food)) return 'food';
  if (hasAny(t, KEYWORDS.nightlife)) return 'nightlife';
  return 'activity';
}
