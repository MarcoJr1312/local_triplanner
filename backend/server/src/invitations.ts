// Invitation helpers. Persistence is owned by the trips service; the API only
// validates codes and matches emails before/after calling it.

import { randomBytes } from 'node:crypto';
import type { InvitationRow } from './schema-types.ts';

export type InvitationStatus = InvitationRow['status'];
export type InvitationRole = InvitationRow['role'];

// 12 URL-safe characters (base64url of 9 random bytes).
export function generateInviteCode(): string {
  return randomBytes(9).toString('base64url');
}

export function isInviteCodeValid(code: unknown): code is string {
  return typeof code === 'string' && /^[A-Za-z0-9_-]{12}$/.test(code);
}

// Case-insensitive match between the invitation email and the caller email.
export function isEmailMatch(invitation: InvitationRow, email: string): boolean {
  return invitation.email.toLowerCase() === email.trim().toLowerCase();
}
