// Seed idempotente del catalogo. La fuente es el JSON comprometido en
// backend/db/toronto-locations.json; se puede re-ejecutar sin duplicar filas.

import { readFileSync } from 'node:fs';
import type { LocationCatalogue } from './catalogue/types.ts';

export interface SeedActivity {
  id: string;
  name: string;
  category: string;
  description?: string;
  lat: number;
  lng: number;
  rating?: number;
  imageUrl?: string | null;
  cost?: number;
  tags?: unknown[];
  durationHours?: number;
  address?: string | null;
  placeId?: string | null;
  rawType?: string | null;
  websiteUrl?: string | null;
  phone?: string | null;
  priceLevel?: string | null;
}

export interface SeedDestination {
  slug: string;
  name: string;
  country: string;
  description?: string;
  lat: number;
  lng: number;
  imageUrl?: string | null;
  activities?: SeedActivity[];
}

export interface SeedData {
  destinations: SeedDestination[];
}

const now = (): string => new Date().toISOString();

export async function seedCatalogue(catalogue: LocationCatalogue, data: SeedData): Promise<number> {
  if (!Array.isArray(data.destinations)) {
    throw new Error('Dataset invalido: falta el array destinations');
  }

  let count = 0;
  for (const dest of data.destinations) {
    await catalogue.upsert({
      id: dest.slug,
      source: 'seed',
      slug: dest.slug,
      name: dest.name,
      category: null,
      country: dest.country,
      description: dest.description ?? null,
      lat: dest.lat,
      lng: dest.lng,
      image_url: dest.imageUrl ?? null,
      parent_id: null,
      last_updated: now(),
    });
    count++;

    for (const activity of dest.activities ?? []) {
      await catalogue.upsert({
        id: activity.id,
        source: 'seed',
        slug: null,
        name: activity.name,
        category: activity.category,
        description: activity.description ?? null,
        lat: activity.lat,
        lng: activity.lng,
        rating: activity.rating ?? null,
        image_url: activity.imageUrl ?? null,
        cost: activity.cost ?? null,
        tags_json: activity.tags ? JSON.stringify(activity.tags) : null,
        duration_hours: activity.durationHours ?? null,
        address: activity.address ?? null,
        place_id: activity.placeId ?? null,
        raw_type: activity.rawType ?? null,
        website_url: activity.websiteUrl ?? null,
        phone: activity.phone ?? null,
        price_level: activity.priceLevel ?? null,
        parent_id: dest.slug,
        last_updated: now(),
      });
      count++;
    }
  }
  return count;
}

export async function seedFromFile(catalogue: LocationCatalogue, filePath: string): Promise<number> {
  const raw = JSON.parse(readFileSync(filePath, 'utf8')) as SeedData;
  return seedCatalogue(catalogue, raw);
}
