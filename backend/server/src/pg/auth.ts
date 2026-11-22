// Demo authentication for the local runner.
// No Firebase and no JWT: the request identity comes from `x-user-id`. In
// USERS_MODE=local the platform table backs login; in remote mode the users
// service owns accounts and this module only exposes identity helpers.

import type { Profile } from '../schema-types.ts';

export const DEMO_USER_UUID = '11111111-1111-4111-8111-111111111111';
export const DEMO_FRIEND_UUID = '22222222-2222-4222-8222-222222222222';

// The API now uses UUIDs everywhere; the legacy text ids only stay as aliases
// for the pre-migration data and the local rollback adapter.
export const DEMO_USER_ID = DEMO_USER_UUID;
export const DEMO_FRIEND_ID = DEMO_FRIEND_UUID;

export const DEMO_PASSWORD = 'demo123';

interface DemoUser {
  id: string;
  username: string;
  email: string;
  name: string;
  color: string;
}

export const DEMO_USERS: readonly DemoUser[] = [
  {
    id: DEMO_USER_ID,
    username: 'demo',
    email: 'demo@triplanner.local',
    name: 'Demo',
    color: '#6366f1',
  },
  {
    id: DEMO_FRIEND_ID,
    username: 'demo-friend',
    email: 'friend@triplanner.local',
    name: 'Demo Friend',
    color: '#10b981',
  },
];

export function getCurrentUserId(
  request: Request | { headers: Headers | Record<string, string> } | undefined,
): string {
  const headers = request?.headers;
  const value = headers instanceof Headers ? headers.get('x-user-id') : headers?.['x-user-id'];
  return typeof value === 'string' && value.trim() ? value.trim() : DEMO_USER_ID;
}

interface ProfileSource {
  id: string;
  username: string;
  email: string | null;
  display_name: string;
  color?: string | null;
  avatar_url?: string | null;
  language?: string | null;
}

export function toProfile(row: ProfileSource): Profile {
  return {
    userId: row.id,
    username: row.username,
    // GraphQL keeps `email: String!` until the M10.9 frontend switch.
    email: row.email ?? '',
    displayName: row.display_name,
    color: row.color ?? null,
    avatarUrl: row.avatar_url ?? null,
    language: row.language ?? 'en',
  };
}
