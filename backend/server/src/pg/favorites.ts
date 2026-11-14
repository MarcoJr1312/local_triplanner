// Postgres port of favorites.ts. The catalogue lives in DynamoDB, so existence
// is validated by the caller (which owns the catalogue client) through `exists`.

import type { AsyncDb } from './db.ts';

export type LocationExists = (locationId: string) => Promise<boolean>;

export async function setFavorite(
  db: AsyncDb,
  userId: string,
  locationId: string,
  favorite: boolean,
  exists?: LocationExists,
): Promise<boolean> {
  if (exists && !(await exists(locationId))) throw new Error('Lugar no encontrado.');
  if (favorite) {
    await db
      .prepare('INSERT INTO user_favorites (user_id, location_id) VALUES (?, ?) ON CONFLICT DO NOTHING')
      .run(userId, locationId);
  } else {
    await db.prepare('DELETE FROM user_favorites WHERE user_id = ? AND location_id = ?').run(userId, locationId);
  }
  return favorite;
}

export async function isFavorite(db: AsyncDb, userId: string, locationId: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS ok FROM user_favorites WHERE user_id = ? AND location_id = ?')
    .get<{ ok: number }>(userId, locationId);
  return Boolean(row);
}

// Favorite ids in one pass, so lists are enriched without N+1.
export async function favoriteIdsForUser(db: AsyncDb, userId: string): Promise<Set<string>> {
  const rows = await db
    .prepare('SELECT location_id FROM user_favorites WHERE user_id = ?')
    .all<{ location_id: string }>(userId);
  return new Set(rows.map((r) => r.location_id));
}
