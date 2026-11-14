// Postgres port of interests.ts. Normalization and the agent sync are shared
// with the SQLite version; only persistence changes.

import { randomUUID } from 'node:crypto';
import { normalizeInterests, syncInterestsToAgent, type InterestsSync } from '../interests.ts';
import type { AsyncDb } from './db.ts';

export async function listUserInterests(db: AsyncDb, userId: string): Promise<string[]> {
  // `seq` (identity) preserves the order the user saved, which created_at
  // cannot do inside a single replace-all transaction.
  const rows = await db
    .prepare('SELECT term FROM user_interests WHERE user_id = ? ORDER BY seq ASC')
    .all<{ term: string }>(userId);
  return rows.map((r) => r.term);
}

export async function replaceUserInterests(
  db: AsyncDb,
  userId: string,
  terms: readonly string[],
  sync: InterestsSync = syncInterestsToAgent,
): Promise<string[]> {
  const normalized = normalizeInterests(terms);

  await db.transaction(async (tx) => {
    await tx.prepare('DELETE FROM user_interests WHERE user_id = ?').run(userId);
    const insert = tx.prepare(
      "INSERT INTO user_interests (id, user_id, term, source) VALUES (?, ?, ?, 'custom')",
    );
    for (const term of normalized) {
      await insert.run(randomUUID(), userId, term);
    }
  });

  // The write is committed before the sync; an agent failure only logs.
  try {
    await sync(userId, normalized);
  } catch (e) {
    console.error(`[interests] sync con el agente falló para ${userId}:`, e instanceof Error ? e.message : e);
  }

  return normalized;
}
