// Presence en memoria (no requiere tabla). touchPresence actualiza; listPresence lee.

export interface PresenceEntry {
  userId: string;
  tripId: string;
  displayName: string;
  color: string | null;
  editingItemId: string | null;
  lastSeen: string;
}

export interface TouchPresenceInput {
  userId: string;
  tripId: string;
  displayName: string;
  color: string | null;
  editingItemId?: string | null;
}

const presence = new Map<string, PresenceEntry>(); // key `${tripId}:${userId}` -> Presence object

export function touchPresence({ userId, tripId, displayName, color, editingItemId }: TouchPresenceInput): PresenceEntry {
  const key = `${tripId}:${userId}`;
  const entry: PresenceEntry = {
    userId,
    tripId,
    displayName,
    color,
    editingItemId: editingItemId ?? null,
    lastSeen: new Date().toISOString(),
  };
  presence.set(key, entry);
  return entry;
}

export function listPresence(tripId: string): PresenceEntry[] {
  return [...presence.values()].filter((p) => p.tripId === tripId);
}
