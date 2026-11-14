// Builds the public invitation link shown in the UI.
// No email provider is involved in the local runner.

import { APP_URL } from './env.ts';

export function buildJoinUrl(tripId: string, code: string): string {
  const base = APP_URL.replace(/\/+$/, '');
  const params = new URLSearchParams({ trip: tripId, code });
  return `${base}/join?${params.toString()}`;
}
