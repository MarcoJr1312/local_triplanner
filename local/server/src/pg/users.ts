// Postgres port of auth/users.ts (Firebase identity -> local users row).
// Kept alongside the SQLite version while the port is expanded slice by slice.

import { randomUUID } from 'node:crypto';
import type { UserRow } from '../schema-types.ts';
import type { FirebaseClaims } from '../auth/verify.ts';
import type { AsyncDb } from './db.ts';

export interface UpsertUserResult {
  user: UserRow;
  created: boolean;
}

// Default name when the token has none: the email prefix.
export function defaultDisplayName(email: string): string {
  const prefix = email.split('@')[0]?.trim();
  return prefix && prefix.length > 0 ? prefix : 'Viajero';
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function upsertUserByEmail(db: AsyncDb, claims: FirebaseClaims): Promise<UpsertUserResult> {
  const email = normalizeEmail(claims.email);
  if (!email) throw new Error('El token de Firebase no incluye email');
  const uid = claims.uid || null;
  const verified = claims.email_verified ? 1 : 0;

  const existing = await db.prepare('SELECT * FROM users WHERE email = ?').get<UserRow>(email);
  if (existing) {
    // Only fill firebase_uid when it was empty; never re-link to another uid.
    const nextUid = existing.firebase_uid ?? uid;
    await db
      .prepare('UPDATE users SET firebase_uid = ?, email_verified = ? WHERE id = ?')
      .run(nextUid, verified, existing.id);

    const claimedName = claims.name?.trim();
    const storedName = existing.display_name ?? '';
    if (
      claimedName &&
      claimedName.length > 0 &&
      (storedName.length === 0 || storedName === defaultDisplayName(email) || storedName === email)
    ) {
      await db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(claimedName, existing.id);
    }

    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get<UserRow>(existing.id);
    return { user: user as UserRow, created: false };
  }

  const id = randomUUID();
  const name = claims.name?.trim() || defaultDisplayName(email);
  await db
    .prepare(
      `INSERT INTO users (id, email, display_name, color, language, firebase_uid, email_verified)
       VALUES (?, ?, ?, NULL, 'es', ?, ?)`,
    )
    .run(id, email, name, uid, verified);

  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get<UserRow>(id);
  return { user: user as UserRow, created: true };
}

export async function markWelcomeSent(db: AsyncDb, userId: string): Promise<void> {
  await db.prepare('UPDATE users SET welcome_sent_at = now() WHERE id = ?').run(userId);
}
