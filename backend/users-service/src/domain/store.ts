// SQL for the users service. Every query stays inside this module so the
// service owns its store and the API never sees SQL.

import type { Db } from '../db.ts';
import type { UserRow } from './types.ts';

const COLUMNS = `id, username, email, password_hash, display_name, color,
                 avatar_url, language, created_at, deleted_at`;

export async function findActiveById(db: Db, id: string): Promise<UserRow | null> {
  return db.one<UserRow>(
    `SELECT ${COLUMNS} FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
}

/** Includes soft-deleted rows so member/attachment enrichment keeps working. */
export async function findAnyById(db: Db, id: string): Promise<UserRow | null> {
  return db.one<UserRow>(`SELECT ${COLUMNS} FROM users WHERE id = $1`, [id]);
}

export async function findByUsername(db: Db, username: string): Promise<UserRow | null> {
  return db.one<UserRow>(
    `SELECT ${COLUMNS} FROM users
      WHERE lower(username) = lower($1) AND deleted_at IS NULL`,
    [username],
  );
}

export async function findByEmail(db: Db, email: string): Promise<UserRow | null> {
  return db.one<UserRow>(
    `SELECT ${COLUMNS} FROM users
      WHERE lower(email) = lower($1) AND deleted_at IS NULL`,
    [email],
  );
}

export async function search(db: Db, query: string, limit: number): Promise<UserRow[]> {
  if (query === '') {
    return db.query<UserRow>(
      `SELECT ${COLUMNS} FROM users
        WHERE deleted_at IS NULL
        ORDER BY username
        LIMIT $1`,
      [limit],
    );
  }
  return db.query<UserRow>(
    `SELECT ${COLUMNS} FROM users
      WHERE deleted_at IS NULL
        AND (position(lower($1) in lower(username)) > 0
             OR position(lower($1) in lower(display_name)) > 0)
      ORDER BY username
      LIMIT $2`,
    [query, limit],
  );
}

export async function batch(db: Db, ids: string[]): Promise<UserRow[]> {
  if (ids.length === 0) return [];
  return db.query<UserRow>(
    `SELECT ${COLUMNS} FROM users WHERE id = ANY($1::uuid[]) ORDER BY username`,
    [ids],
  );
}

export interface InsertUser {
  id: string;
  username: string;
  passwordHash: string;
  displayName: string;
  language: string;
  email?: string | null;
  color?: string | null;
}

export async function insert(db: Db, user: InsertUser): Promise<UserRow> {
  const row = await db.one<UserRow>(
    `INSERT INTO users (id, username, email, password_hash, display_name, color, language)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${COLUMNS}`,
    [
      user.id,
      user.username,
      user.email ?? null,
      user.passwordHash,
      user.displayName,
      user.color ?? null,
      user.language,
    ],
  );
  if (!row) throw new Error('INSERT users returned no row');
  return row;
}

export interface UpdateUser {
  displayName?: string;
  language?: string;
  avatarUrl?: string | null;
  color?: string | null;
}

export async function update(
  db: Db,
  id: string,
  patch: UpdateUser,
): Promise<UserRow | null> {
  const sets: string[] = [];
  const params: unknown[] = [id];

  if (patch.displayName !== undefined) {
    params.push(patch.displayName);
    sets.push(`display_name = $${params.length}`);
  }
  if (patch.language !== undefined) {
    params.push(patch.language);
    sets.push(`language = $${params.length}`);
  }
  if (patch.avatarUrl !== undefined) {
    params.push(patch.avatarUrl);
    sets.push(`avatar_url = $${params.length}`);
  }
  if (patch.color !== undefined) {
    params.push(patch.color);
    sets.push(`color = $${params.length}`);
  }
  if (sets.length === 0) return null;

  return db.one<UserRow>(
    `UPDATE users SET ${sets.join(', ')}
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING ${COLUMNS}`,
    params,
  );
}

/** Returns true when the row exists (whether or not it was already deleted). */
export async function softDelete(db: Db, id: string): Promise<boolean> {
  const deleted = await db.run(
    'UPDATE users SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL',
    [id],
  );
  if (deleted > 0) return true;
  const existing = await db.one<{ id: string }>('SELECT id FROM users WHERE id = $1', [id]);
  return existing !== null;
}
