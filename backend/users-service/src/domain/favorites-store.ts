// Private favorite places. location_id is an opaque reference to the
// locations service catalogue; this store never validates or joins it.

import type { Db, Queryable } from '../db.ts';
import type { FavoriteRow } from './types.ts';

export async function listForUser(db: Queryable, userId: string): Promise<FavoriteRow[]> {
  return db.query<FavoriteRow>(
    `SELECT user_id, location_id, created_at
       FROM favorite_locations
      WHERE user_id = $1
      ORDER BY created_at DESC, location_id ASC`,
    [userId],
  );
}

export async function add(db: Db, userId: string, locationId: string): Promise<void> {
  await db.run(
    `INSERT INTO favorite_locations (user_id, location_id)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [userId, locationId],
  );
}

export async function remove(db: Db, userId: string, locationId: string): Promise<void> {
  await db.run('DELETE FROM favorite_locations WHERE user_id = $1 AND location_id = $2', [
    userId,
    locationId,
  ]);
}
