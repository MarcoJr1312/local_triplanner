// Postgres port of src/auth.ts: demo user bootstrap and request identity.
// Kept alongside the SQLite version until the adapter is flipped.

import type { Profile, UserRow } from '../schema-types.ts';
import { verifyFirebaseIdToken, type FirebaseClaims } from '../auth/verify.ts';
import type { AsyncDb } from './db.ts';
import { upsertUserByEmail } from './users.ts';

export const DEMO_USER_ID = 'demo-user';

export type TokenVerifier = (idToken: string) => Promise<FirebaseClaims>;

// Idempotent: the demo row survives restarts and repeated boots.
export async function ensureDemoUser(db: AsyncDb): Promise<void> {
  await db
    .prepare(
      `INSERT INTO users (id, email, display_name, color)
       VALUES (?, ?, ?, ?)
       ON CONFLICT DO NOTHING`,
    )
    .run(DEMO_USER_ID, 'demo@triplanner.local', 'Demo', '#6366f1');
}

export function getCurrentUserId(request: Request | { headers: Headers | Record<string, string> } | undefined): string {
  const headers = request?.headers;
  const value = headers instanceof Headers ? headers.get('x-user-id') : headers?.['x-user-id'];
  const id = typeof value === 'string' && value.trim() ? value.trim() : DEMO_USER_ID;
  return id;
}

// With `Authorization: Bearer <firebaseIdToken>` the identity comes from the
// VERIFIED token, resolved by email. Without it, the local x-user-id session
// (demo mode) is kept. The verifier is injectable so tests never hit Firebase.
export async function resolveCurrentUserId(
  db: AsyncDb,
  request: Request | { headers: Headers | Record<string, string> } | undefined,
  verify: TokenVerifier = verifyFirebaseIdToken,
): Promise<string> {
  const headers = request?.headers;
  const authHeader = headers instanceof Headers ? headers.get('authorization') : headers?.['authorization'];
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const claims = await verify(authHeader.slice('Bearer '.length).trim());
    const { user } = await upsertUserByEmail(db, claims);
    return user.id;
  }
  return getCurrentUserId(request);
}

export function toProfile(row: UserRow): Profile {
  return {
    userId: row.id,
    email: row.email,
    displayName: row.display_name,
    color: row.color,
    avatarUrl: row.avatar_url ?? null,
    language: row.language ?? 'es',
  };
}
