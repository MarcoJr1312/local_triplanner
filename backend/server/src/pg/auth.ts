// Demo identity helpers. Accounts live in the users service; the API only
// resolves the x-user-id header and maps profiles to GraphQL.

import type { Profile } from '../schema-types.ts';

export const DEMO_USER_UUID = '11111111-1111-4111-8111-111111111111';
export const DEMO_FRIEND_UUID = '22222222-2222-4222-8222-222222222222';

export const DEMO_USER_ID = DEMO_USER_UUID;
export const DEMO_FRIEND_ID = DEMO_FRIEND_UUID;

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
  deleted_at?: string | null;
}

export function toProfile(row: ProfileSource): Profile {
  return {
    userId: row.id,
    username: row.username,
    email: row.email,
    displayName: row.display_name,
    color: row.color ?? null,
    avatarUrl: row.avatar_url ?? null,
    language: row.language ?? 'en',
    deletedAt: row.deleted_at ?? null,
  };
}
