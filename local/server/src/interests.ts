// Intereses del usuario (chips + texto libre).
// - SQLite (user_interests) es la verdad del CRUD; Chroma (agente) es un indice
//   semantico que se sincroniza best-effort tras cada guardado.
// - setMyInterests REEMPLAZA la lista completa: normaliza (trim, lowercase,
//   sin duplicados), corta a MAX_INTERESTS y re-inserta con source 'custom'.

import { randomUUID } from 'node:crypto';
import { AGENT_BASE_URL, INTERNAL_TOKEN } from './env.ts';
import type { Db } from './schema-types.ts';

export const MAX_INTERESTS = 20;

// Normaliza preservando el orden de primera aparicion y aplicando el tope.
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

// Terminos del usuario en orden de creacion (created_at ASC). rowid desempata
// inserciones dentro del mismo milisegundo para conservar el orden guardado.
export function listUserInterests(db: Db, userId: string): string[] {
  const rows = db
    .prepare('SELECT term FROM user_interests WHERE user_id = ? ORDER BY created_at ASC, rowid ASC')
    .all(userId) as { term: string }[];
  return rows.map((r) => r.term);
}

export type InterestsSync = (userId: string, terms: readonly string[]) => Promise<void>;

// POST al agente (dueno de Chroma). Puede lanzar: el llamador decide.
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

// Reemplazo completo. El guardado se confirma ANTES del sync; un fallo del
// agente solo se loguea (nunca revierte ni rompe la mutation).
export async function replaceUserInterests(
  db: Db,
  userId: string,
  terms: readonly string[],
  sync: InterestsSync = syncInterestsToAgent,
): Promise<string[]> {
  const normalized = normalizeInterests(terms);

  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM user_interests WHERE user_id = ?').run(userId);
    const insert = db.prepare(
      "INSERT INTO user_interests (id, user_id, term, source) VALUES (?, ?, ?, 'custom')",
    );
    for (const term of normalized) {
      insert.run(randomUUID(), userId, term);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  try {
    await sync(userId, normalized);
  } catch (e) {
    console.error(
      `[interests] sync con el agente falló para ${userId}:`,
      e instanceof Error ? e.message : e,
    );
  }

  return normalized;
}
