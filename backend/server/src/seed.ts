// Idempotent demo seed for the platform PostgreSQL database.
// The platform owns users, favorites, interests, chats, attachments and agent
// vectors. Trips, memberships, items and invitations belong to the trips
// service, which seeds its own demo trip (SEED_DEMO=true).
//
// The locations catalogue is owned and seeded by backend/locations-service.

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
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

// Accounts and trips are seeded by their own services; this command keeps the
// platform image seed and exists for compose/bootstrap compatibility.
export async function seedAll(_db: AsyncDb): Promise<void> {
  // No platform identities remain after the M10.13 decommission.
}

if (import.meta.main) {
  const url = await resolveDatabaseUrl();
  await migrate(url);
  const db = await PgDb.connect(url);
  try {
    const images = copySeedImages();
    await seedAll(db);
    console.log(
      `Seed OK — Postgres listo; usuarios demo; catálogo en locations-service, ${images} imágenes`,
    );
  } finally {
    await db.close();
  }
}
