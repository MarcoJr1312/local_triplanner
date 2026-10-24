// Historial de chats de sugerencias (agente M3) por (trip, user, day).
// - Persistencia en suggestion_chats: messages como JSON.
// - Upsert idempotente por (trip_id, user_id, day): la segunda escritura actualiza.
// - Lo consume el frontend via GraphQL (suggestionChats/saveSuggestionChat) y el
//   agente interno via POST /internal/save-chat (mismo helper, sin duplicar).

import { randomUUID } from 'node:crypto';
import type { Db } from './schema-types.ts';

export interface ChatMessage {
  role: string;
  content: string;
}

export interface SuggestionChatRow {
  id: string;
  trip_id: string;
  user_id: string;
  day: string;
  messages: string;
  created_at: string;
  updated_at: string;
}

export interface SuggestionChatGql {
  id: string;
  tripId: string;
  userId: string;
  day: string;
  messages: ChatMessage[];
}

export function parseMessages(json: string | null | undefined): ChatMessage[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json) as unknown;
    if (!Array.isArray(v)) return [];
    return v
      .filter(
        (m): m is ChatMessage =>
          !!m &&
          typeof m === 'object' &&
          typeof (m as ChatMessage).role === 'string' &&
          typeof (m as ChatMessage).content === 'string',
      )
      .map((m) => ({ role: m.role, content: m.content }));
  } catch {
    return [];
  }
}

export function isValidMessages(messages: unknown): messages is ChatMessage[] {
  if (!Array.isArray(messages) || messages.length === 0) return false;
  return messages.every(
    (m) =>
      !!m &&
      typeof m === 'object' &&
      typeof (m as ChatMessage).role === 'string' &&
      (m as ChatMessage).role.length > 0 &&
      typeof (m as ChatMessage).content === 'string',
  );
}

function rowToGql(row: SuggestionChatRow): SuggestionChatGql {
  return {
    id: row.id,
    tripId: row.trip_id,
    userId: row.user_id,
    day: row.day,
    messages: parseMessages(row.messages),
  };
}

export function getSuggestionChat(db: Db, tripId: string, userId: string, day: string): SuggestionChatGql | null {
  const row = db
    .prepare('SELECT * FROM suggestion_chats WHERE trip_id = ? AND user_id = ? AND day = ?')
    .get(tripId, userId, day) as SuggestionChatRow | undefined;
  return row ? rowToGql(row) : null;
}

export function listSuggestionChats(db: Db, tripId: string, userId: string, day?: string | null): SuggestionChatGql[] {
  const rows = day
    ? (db
        .prepare(
          'SELECT * FROM suggestion_chats WHERE trip_id = ? AND user_id = ? AND day = ? ORDER BY updated_at ASC',
        )
        .all(tripId, userId, day) as unknown as SuggestionChatRow[])
    : (db
        .prepare('SELECT * FROM suggestion_chats WHERE trip_id = ? AND user_id = ? ORDER BY updated_at ASC')
        .all(tripId, userId) as unknown as SuggestionChatRow[]);
  return rows.map(rowToGql);
}

export function upsertSuggestionChat(
  db: Db,
  { tripId, userId, day, messages }: { tripId: string; userId: string; day: string; messages: ChatMessage[] },
): SuggestionChatGql {
  const messagesJson = JSON.stringify(messages);
  const now = new Date().toISOString();
  const existing = db
    .prepare('SELECT id FROM suggestion_chats WHERE trip_id = ? AND user_id = ? AND day = ?')
    .get(tripId, userId, day) as { id: string } | undefined;
  if (existing) {
    db.prepare('UPDATE suggestion_chats SET messages = ?, updated_at = ? WHERE id = ?').run(
      messagesJson,
      now,
      existing.id,
    );
  } else {
    const id = randomUUID();
    db.prepare(
      'INSERT INTO suggestion_chats (id, trip_id, user_id, day, messages, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(id, tripId, userId, day, messagesJson, now, now);
  }
  return getSuggestionChat(db, tripId, userId, day)!;
}
