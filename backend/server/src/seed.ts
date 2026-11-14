// Idempotent seed for the Postgres + MongoDB stack.
// - applies the Postgres schema
// - upserts destinations/activities from backend/db/seed-data.json into MongoDB
// - creates the demo user, trip, membership and items
// Re-running does not duplicate anything.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from './db/migrate.ts';
import { PgDb } from './pg/db.ts';
import { resolveDatabaseUrl } from './pg/config.ts';
import { createCatalogue } from './catalogue/index.ts';
import type { LocationCatalogue } from './catalogue/types.ts';
import type { AsyncDb } from './pg/db.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Repo: backend/server/src -> backend/db. Container: /app/src -> /app/db.
const DB_DIR =
  [path.resolve(__dirname, '..', '..', 'db'), path.resolve(__dirname, '..', 'db')].find((candidate) =>
    existsSync(candidate),
  ) ?? path.resolve(__dirname, '..', '..', 'db');
const TORONTO_DATA_PATH = path.join(DB_DIR, 'toronto-locations.json');
const SEED_DATA_PATH = existsSync(TORONTO_DATA_PATH)
  ? TORONTO_DATA_PATH
  : path.join(DB_DIR, 'seed-data.json');

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

const FALLBACK_ITEMS: SeedActivity[] = [
  { id: 'tor-cn-tower', name: 'CN Tower', category: 'sight', lat: 43.6426, lng: -79.3871, cost: 43 },
  { id: 'tor-alo', name: 'Alo Restaurant', category: 'food', lat: 43.6486, lng: -79.3956, cost: 110 },
];

export async function seedDemo(db: AsyncDb, activities: SeedActivity[] = []): Promise<void> {
  await db
    .prepare(
      `INSERT INTO users (id, email, display_name, color)
       VALUES ('demo-user', 'demo@triplanner.local', 'Demo', '#6366f1')
       ON CONFLICT DO NOTHING`,
    )
    .run();

  // Second identity for invite/collaboration flows. It is not a trip member
  // until the owner invites it.
  await db
    .prepare(
      `INSERT INTO users (id, email, display_name, color)
       VALUES ('demo-friend', 'friend@triplanner.local', 'Demo Friend', '#10b981')
       ON CONFLICT DO NOTHING`,
    )
    .run();

  await db
    .prepare(
      `INSERT INTO trips (id, name, destination_id, destination_name, start_date, end_date, total_budget, owner_id, invite_code)
       VALUES ('demo-trip', 'Fin de semana en Toronto', 'toronto', 'Toronto', '2026-11-06', '2026-11-08', 1200, 'demo-user', 'DEMO123')
       ON CONFLICT DO NOTHING`,
    )
    .run();

  await db
    .prepare(
      `INSERT INTO trip_members (trip_id, user_id, role)
       VALUES ('demo-trip', 'demo-user', 'owner')
       ON CONFLICT DO NOTHING`,
    )
    .run();

  const days = ['2026-11-06', '2026-11-07', '2026-11-08'];
  const picks = activities.length > 0 ? activities.slice(0, 9) : FALLBACK_ITEMS;
  const items = picks.map((activity, index) => ({
    id: `demo-item-${index + 1}`,
    locationId: activity.id,
    title: activity.name,
    category: activity.category,
    cost: activity.cost ?? 0,
    day: days[Math.min(Math.floor(index / 3), days.length - 1)],
    order: index % 3,
  }));
  for (const item of items) {
    await db
      .prepare(
        `INSERT INTO trip_items (id, trip_id, location_id, title, category, cost, day, "order", created_by)
         VALUES (?, 'demo-trip', ?, ?, ?, ?, ?, ?, 'demo-user')
         ON CONFLICT DO NOTHING`,
      )
      .run(item.id, item.locationId, item.title, item.category, item.cost, item.day, item.order);
  }
}

export async function seedAll(catalogue: LocationCatalogue, db: AsyncDb, data: SeedData): Promise<number> {
  const locations = await seedCatalogue(catalogue, data);
  await seedDemo(db, data.destinations[0]?.activities ?? []);
  return locations;
}

if (import.meta.main) {
  const url = await resolveDatabaseUrl();
  const data = JSON.parse(readFileSync(SEED_DATA_PATH, 'utf8')) as SeedData;

  await migrate(url);
  const db = await PgDb.connect(url);
  const catalogue = await createCatalogue();
  try {
    const total = await seedAll(catalogue, db, data);
    const destinations = await catalogue.listDestinations();
    console.log(`Seed OK — ${destinations.length} destinos, ${total - destinations.length} actividades`);
  } finally {
    await db.close();
    await catalogue.close();
  }
}
