// Email event envelopes produced by trips. The email service owns rendering;
// trips only guarantees the versioned contract and at-least-once delivery.

import type { InvitationRow, TripRow } from './types.ts';

export interface InviteNotify {
  inviter_name: string;
  language: 'es' | 'en';
  app_url: string;
  demo: boolean;
}

export interface MemberJoinedNotify {
  owner_email: string;
  owner_name: string;
  member_name: string;
  language: 'es' | 'en';
}

export interface EventEnvelope {
  id: string;
  type: 'email.invite.v1' | 'email.member.joined.v1';
  version: 1;
  occurredAt: string;
  source: 'triplanner-trips';
  payload: Record<string, unknown>;
}

export function buildInviteEvent(
  trip: TripRow,
  invitation: InvitationRow,
  notify: InviteNotify,
  now: Date = new Date(),
): EventEnvelope {
  const appUrl = notify.app_url.replace(/\/+$/, '');
  const joinUrl = `${appUrl}/join?trip=${encodeURIComponent(trip.id)}&code=${encodeURIComponent(invitation.code)}&auto=1`;

  return {
    id: invitation.id,
    type: 'email.invite.v1',
    version: 1,
    occurredAt: now.toISOString(),
    source: 'triplanner-trips',
    payload: {
      to: invitation.email,
      tripName: trip.name,
      ownerName: notify.inviter_name,
      code: invitation.code,
      joinUrl,
      role: invitation.role,
      language: notify.language,
      demo: notify.demo,
    },
  };
}

export function buildMemberJoinedEvent(
  input: {
    id: string;
    tripName: string;
    notify: MemberJoinedNotify;
  },
  now: Date = new Date(),
): EventEnvelope {
  return {
    id: input.id,
    type: 'email.member.joined.v1',
    version: 1,
    occurredAt: now.toISOString(),
    source: 'triplanner-trips',
    payload: {
      to: input.notify.owner_email,
      ownerName: input.notify.owner_name,
      memberName: input.notify.member_name,
      tripName: input.tripName,
      language: input.notify.language,
    },
  };
}
