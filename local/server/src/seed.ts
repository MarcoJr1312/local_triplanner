// Idempotent seed for the Postgres + DynamoDB stack.
// - applies the Postgres schema
// - upserts destinations/activities from local/db/seed-data.json into the catalogue
// - creates the demo user, trip, membership and items
// Re-running does not duplicate anything.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from './db/migrate.ts';
import { PgDb } from './pg/db.ts';
import { resolveDatabaseUrl } from './pg/config.ts';
import { DynamoLocationCatalogue } from './catalogue/dynamo.ts';
import { ensureTable } from './catalogue/bootstrap.ts';
import type { LocationCatalogue } from './catalogue/types.ts';
import type { AsyncDb } from './pg/db.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_DATA_PATH = path.resolve(__dirname, '..', '..', 'db', 'seed-data.json');

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
        parent_id: dest.slug,
        last_updated: now(),
      });
      count++;
    }
  }
  return count;
}

export async function seedDemo(db: AsyncDb): Promise<void> {
  await db
    .prepare(
      `INSERT INTO users (id, email, display_name, color)
       VALUES ('demo-user', 'demo@triplanner.local', 'Demo', '#6366f1')
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

  const items = [
    { id: 'demo-item-1', locationId: 'tor-cn-tower', title: 'CN Tower', category: 'sight', cost: 43, day: '2026-11-06', order: 0 },
    { id: 'demo-item-2', locationId: 'tor-alo', title: 'Alo Restaurant', category: 'food', cost: 110, day: '2026-11-07', order: 0 },
  ];
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
  await seedDemo(db);
  return locations;
}

if (import.meta.main) {
  const url = await resolveDatabaseUrl();
  const data = JSON.parse(readFileSync(SEED_DATA_PATH, 'utf8')) as SeedData;

  await ensureTable();
  await migrate(url);
  const db = await PgDb.connect(url);
  const catalogue = new DynamoLocationCatalogue();
  try {
    const total = await seedAll(catalogue, db, data);
    const destinations = await catalogue.listDestinations();
    console.log(`Seed OK — ${destinations.length} destinos, ${total - destinations.length} actividades`);
  } finally {
    await db.close();
  }
}
