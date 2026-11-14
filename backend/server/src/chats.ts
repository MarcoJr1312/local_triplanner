// Suggestion chat types and JSON validation. Persistence lives in pg/chats.

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
