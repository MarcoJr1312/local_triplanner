// Demo authentication for the local runner.
// No Firebase: the request identity comes from `x-user-id`, defaulting to the
// seeded demo user. Two identities support collaboration/invite flows.

import type { Profile, UserRow } from '../schema-types.ts';
import type { AsyncDb } from './db.ts';

export const DEMO_USER_ID = 'demo-user';
export const DEMO_FRIEND_ID = 'demo-friend';

const DEMO_USERS = [
  { id: DEMO_USER_ID, email: 'demo@triplanner.local', name: 'Demo', color: '#6366f1' },
  { id: DEMO_FRIEND_ID, email: 'friend@triplanner.local', name: 'Demo Friend', color: '#10b981' },
] as const;

// Idempotent: both demo rows survive restarts and repeated boots.
export async function ensureDemoUsers(db: AsyncDb): Promise<void> {
  for (const user of DEMO_USERS) {
    await db
      .prepare(
        `INSERT INTO users (id, email, display_name, color)
         VALUES (?, ?, ?, ?)
         ON CONFLICT DO NOTHING`,
      )
      .run(user.id, user.email, user.name, user.color);
  }
}

// Kept for callers/tests that only need the owner identity.
export async function ensureDemoUser(db: AsyncDb): Promise<void> {
  await ensureDemoUsers(db);
}

export function getCurrentUserId(
  request: Request | { headers: Headers | Record<string, string> } | undefined,
): string {
  const headers = request?.headers;
  const value = headers instanceof Headers ? headers.get('x-user-id') : headers?.['x-user-id'];
  return typeof value === 'string' && value.trim() ? value.trim() : DEMO_USER_ID;
}

export function toProfile(row: UserRow): Profile {
  return {
    userId: row.id,
    email: row.email,
    displayName: row.display_name,
    color: row.color,
    avatarUrl: row.avatar_url ?? null,
    language: row.language ?? 'en',
  };
}
