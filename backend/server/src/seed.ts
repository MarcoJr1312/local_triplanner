// Idempotent demo seed for PostgreSQL.
// - applies the Postgres schema
// - creates the demo user, trip, membership and items
// The locations catalogue is owned and seeded by backend/locations-service.
// Re-running does not duplicate anything.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from './db/migrate.ts';
import { PgDb } from './pg/db.ts';
import { resolveDatabaseUrl } from './pg/config.ts';
import { uploadsRoot } from './storage.ts';
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
const SEED_IMAGES_DIR = path.join(DB_DIR, 'seed-images');

// Copies the committed seed images into the API uploads volume.
// The dataset stores URLs as /uploads/seed/<file>.
export function copySeedImages(): number {
  if (!existsSync(SEED_IMAGES_DIR)) return 0;
  const target = path.join(uploadsRoot(), 'seed');
  mkdirSync(target, { recursive: true });
  let count = 0;
  for (const file of readdirSync(SEED_IMAGES_DIR)) {
    const source = path.join(SEED_IMAGES_DIR, file);
    if (!statSync(source).isFile()) continue;
    copyFileSync(source, path.join(target, file));
    count++;
  }
  return count;
}

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

const FALLBACK_ITEMS: SeedActivity[] = [
  { id: 'tor-cn-tower', name: 'CN Tower', category: 'sight', lat: 43.6426, lng: -79.3871, cost: 43 },
  { id: 'tor-alo', name: 'Alo Restaurant', category: 'food', lat: 43.6486, lng: -79.3956, cost: 110 },
];

// A 3-day demo should show variety, not the first nine sightseeing rows.
function pickDemoActivities(activities: SeedActivity[]): SeedActivity[] {
  const wanted: Record<string, number> = { sight: 3, food: 3, activity: 2, nightlife: 1 };
  const picked: SeedActivity[] = [];
  for (const [category, count] of Object.entries(wanted)) {
    picked.push(...activities.filter((activity) => activity.category === category).slice(0, count));
  }
  if (picked.length < 9) {
    for (const activity of activities) {
      if (!picked.includes(activity)) picked.push(activity);
      if (picked.length >= 9) break;
    }
  }
  return picked.slice(0, 9);
}

export async function seedDemo(db: AsyncDb, activities: SeedActivity[] = []): Promise<void> {
  await db
    .prepare(
      `INSERT INTO users (id, email, display_name, color, language)
       VALUES ('demo-user', 'demo@triplanner.local', 'Demo', '#6366f1', 'en')
       ON CONFLICT DO NOTHING`,
    )
    .run();

  // Second identity for invite/collaboration flows. It is not a trip member
  // until the owner invites it.
  await db
    .prepare(
      `INSERT INTO users (id, email, display_name, color, language)
       VALUES ('demo-friend', 'friend@triplanner.local', 'Demo Friend', '#10b981', 'en')
       ON CONFLICT DO NOTHING`,
    )
    .run();

  await db
    .prepare(
      `INSERT INTO trips (id, name, destination_id, destination_name, start_date, end_date, total_budget, owner_id, invite_code)
       VALUES ('demo-trip', 'Fin de semana en Toronto', 'toronto', 'Toronto', '2026-12-04', '2026-12-06', 1200, 'demo-user', 'DEMO123')
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

  const days = ['2026-12-04', '2026-12-05', '2026-12-06'];
  const picks = activities.length > 0 ? pickDemoActivities(activities) : FALLBACK_ITEMS;
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

export async function seedAll(db: AsyncDb, data: SeedData): Promise<void> {
  await seedDemo(db, data.destinations[0]?.activities ?? []);
}

if (import.meta.main) {
  const url = await resolveDatabaseUrl();
  const data = JSON.parse(readFileSync(SEED_DATA_PATH, 'utf8')) as SeedData;

  await migrate(url);
  const db = await PgDb.connect(url);
  try {
    const images = copySeedImages();
    await seedAll(db, data);
    console.log(`Seed OK — Postgres listo; catálogo en locations-service, ${images} imágenes`);
  } finally {
    await db.close();
  }
}
