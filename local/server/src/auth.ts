// Auth demo: un usuario demo persistente en SQLite + session simple via header x-user-id.
// La persistencia la da SQLite (el usuario sobrevive recargas del servidor).

import type { Db, Profile, UserRow } from './schema-types.ts';
import { upsertUserByEmail } from './auth/users.ts';
import { verifyFirebaseIdToken, type FirebaseClaims } from './auth/verify.ts';

export const DEMO_USER_ID = 'demo-user';

export function ensureDemoUser(db: Db): void {
  db.prepare(
    'INSERT OR IGNORE INTO users (id, email, display_name, color) VALUES (?, ?, ?, ?)'
  ).run(DEMO_USER_ID, 'demo@triplanner.local', 'Demo', '#6366f1');
}

export function getCurrentUserId(request: Request | { headers: Headers | Record<string, string> } | undefined): string {
  const headers = request?.headers;
  const value = headers instanceof Headers ? headers.get('x-user-id') : headers?.['x-user-id'];
  const id = typeof value === 'string' && value.trim() ? value.trim() : DEMO_USER_ID;
  return id;
}

// Regla ARQ 2: si la request trae Authorization: Bearer <firebaseIdToken>, la
// identidad sale del token VERIFICADO (jose) resuelto por email — nunca de un
// header confiable. Sin Bearer se conserva la sesión local x-user-id/demo.
export async function resolveCurrentUserId(db: Db, request: Request | { headers: Headers | Record<string, string> } | undefined): Promise<string> {
  const headers = request?.headers;
  const authHeader = headers instanceof Headers ? headers.get('authorization') : headers?.['authorization'];
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const claims: FirebaseClaims = await verifyFirebaseIdToken(authHeader.slice('Bearer '.length).trim());
    const { user } = upsertUserByEmail(db, claims);
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
