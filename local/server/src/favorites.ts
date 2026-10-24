// Favoritos de lugares (corazon) por usuario. Toggle idempotente.

import type { Db } from './schema-types.ts';

export function setFavorite(db: Db, userId: string, locationId: string, favorite: boolean): boolean {
  const exists = db
    .prepare('SELECT 1 FROM locations WHERE id = ?')
    .get(locationId);
  if (!exists) throw new Error('Lugar no encontrado.');
  if (favorite) {
    db.prepare('INSERT OR IGNORE INTO user_favorites (user_id, location_id) VALUES (?, ?)').run(
      userId,
      locationId
    );
  } else {
    db.prepare('DELETE FROM user_favorites WHERE user_id = ? AND location_id = ?').run(
      userId,
      locationId
    );
  }
  return favorite;
}

export function isFavorite(db: Db, userId: string, locationId: string): boolean {
  return Boolean(
    db.prepare('SELECT 1 FROM user_favorites WHERE user_id = ? AND location_id = ?').get(
      userId,
      locationId
    )
  );
}

// Set de ids favoritos del usuario (una pasada para enriquecer listas sin N+1).
export function favoriteIdsForUser(db: Db, userId: string): Set<string> {
  const rows = db
    .prepare('SELECT location_id FROM user_favorites WHERE user_id = ?')
    .all(userId) as { location_id: string }[];
  return new Set(rows.map((r) => r.location_id));
}
