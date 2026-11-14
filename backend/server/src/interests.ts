// User interests: normalization and the best-effort agent sync.
// Persistence lives in pg/interests.ts.

import { AGENT_BASE_URL, INTERNAL_TOKEN } from './env.ts';

export const MAX_INTERESTS = 20;

// Preserves first-seen order and applies the cap.
export function normalizeInterests(terms: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of terms) {
    if (typeof raw !== 'string') continue;
    const term = raw.trim().toLowerCase();
    if (!term || seen.has(term)) continue;
    seen.add(term);
    out.push(term);
    if (out.length === MAX_INTERESTS) break;
  }
  return out;
}

export type InterestsSync = (userId: string, terms: readonly string[]) => Promise<void>;

// POST to the agent (owner of the semantic index). May throw: caller decides.
export async function syncInterestsToAgent(userId: string, terms: readonly string[]): Promise<void> {
  const res = await fetch(`${AGENT_BASE_URL}/internal/interests/sync`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-token': INTERNAL_TOKEN,
    },
    body: JSON.stringify({ userId, terms }),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
}
