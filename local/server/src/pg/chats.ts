// Postgres port of chats.ts (suggestion chat history).
// Row parsing/validation is shared with the SQLite version.

import { randomUUID } from 'node:crypto';
import { parseMessages, type ChatMessage, type SuggestionChatGql, type SuggestionChatRow } from '../chats.ts';
import type { AsyncDb } from './db.ts';

function rowToGql(row: SuggestionChatRow): SuggestionChatGql {
  return {
    id: row.id,
    tripId: row.trip_id,
    userId: row.user_id,
    day: row.day,
    messages: parseMessages(row.messages),
  };
}

export async function getSuggestionChat(
  db: AsyncDb,
  tripId: string,
  userId: string,
  day: string,
): Promise<SuggestionChatGql | null> {
  const row = await db
    .prepare('SELECT * FROM suggestion_chats WHERE trip_id = ? AND user_id = ? AND day = ?')
    .get<SuggestionChatRow>(tripId, userId, day);
  return row ? rowToGql(row) : null;
}

export async function listSuggestionChats(
  db: AsyncDb,
  tripId: string,
  userId: string,
  day?: string | null,
): Promise<SuggestionChatGql[]> {
  const rows = day
    ? await db
        .prepare('SELECT * FROM suggestion_chats WHERE trip_id = ? AND user_id = ? AND day = ? ORDER BY updated_at ASC')
        .all<SuggestionChatRow>(tripId, userId, day)
    : await db
        .prepare('SELECT * FROM suggestion_chats WHERE trip_id = ? AND user_id = ? ORDER BY updated_at ASC')
        .all<SuggestionChatRow>(tripId, userId);
  return rows.map(rowToGql);
}

export async function upsertSuggestionChat(
  db: AsyncDb,
  { tripId, userId, day, messages }: { tripId: string; userId: string; day: string; messages: ChatMessage[] },
): Promise<SuggestionChatGql> {
  const messagesJson = JSON.stringify(messages);
  const now = new Date().toISOString();
  const existing = await db
    .prepare('SELECT id FROM suggestion_chats WHERE trip_id = ? AND user_id = ? AND day = ?')
    .get<{ id: string }>(tripId, userId, day);

  if (existing) {
    await db
      .prepare('UPDATE suggestion_chats SET messages = ?, updated_at = ? WHERE id = ?')
      .run(messagesJson, now, existing.id);
  } else {
    await db
      .prepare(
        'INSERT INTO suggestion_chats (id, trip_id, user_id, day, messages, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(randomUUID(), tripId, userId, day, messagesJson, now, now);
  }

  const saved = await getSuggestionChat(db, tripId, userId, day);
  if (!saved) throw new Error('No se pudo guardar el chat');
  return saved;
}
