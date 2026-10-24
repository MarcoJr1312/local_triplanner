import type {
  Activity,
  AddItemInput,
  CreateTripInput,
  Destination,
  InviteMemberArgs,
  Member,
  MemberRole,
  Presence,
  PresenceInput,
  Suggestion,
  SuggestionSet,
  Trip,
  TripItem,
  TripSummary,
  UpdateItemInput,
  UpdateTripSettingsInput,
  UserProfile,
} from './types';
import { TriplannerApi } from './types';
import { CURRENT_USER_ID, SEED_USERS, buildSeedTrips, seedActivities, seedDestinations } from './seed';
import { inviteCodeFor, nowIso, uid } from './format';

const SESSION_KEY = 'triplanner.session';

const delay = (min = 150, max = 400) =>
  new Promise<void>((resolve) => setTimeout(resolve, min + Math.random() * (max - min)));

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function computeSpent(items: TripItem[]): { spent: number; spentByCategory: Trip['spentByCategory'] } {
  const byCategory = new Map<string, number>();
  let spent = 0;
  for (const it of items) {
    spent += it.cost;
    byCategory.set(it.category, (byCategory.get(it.category) ?? 0) + it.cost);
  }
  return {
    spent: round2(spent),
    spentByCategory: Array.from(byCategory.entries())
      .map(([category, amount]) => ({ category, amount: round2(amount) }))
      .sort((a, b) => b.amount - a.amount),
  };
}

function decorate(trip: Trip): Trip {
  const { spent, spentByCategory } = computeSpent(trip.items);
  return { ...trip, spent, spentByCategory };
}

function summary(trip: Trip, userId: string): TripSummary {
  const role = trip.members.find((m) => m.userId === userId)?.role ?? 'viewer';
  return {
    tripId: trip.id,
    tripName: trip.name,
    destinationName: trip.destinationName,
    startDate: trip.startDate,
    endDate: trip.endDate,
    role,
    joinedAt: trip.createdAt,
  };
}

function userOf(userId: string): { email: string; displayName: string; color: string } {
  const known = SEED_USERS[userId];
  if (known) return known;
  return { email: `${userId}@demo.com`, displayName: userId.replace('user-', ''), color: '#94a3b8' };
}

// ---------------------------------------------------------------------------
// Store (in-memory)
// ---------------------------------------------------------------------------

const trips: Trip[] = buildSeedTrips();
const destinations: Destination[] = clone(seedDestinations);
const activities: Record<string, Activity[]> = clone(seedActivities);

let currentUserId: string | null = null;

// tripId -> list of currently online presences (includes current user + simulated bots)
const presence: Record<string, Presence[]> = {};

// tripId -> userIds of simulated bots currently "online" for that trip
const botPresence: Record<string, string[]> = {};

let version = 0;
const listeners = new Set<() => void>();

function notify() {
  version += 1;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getVersion(): number {
  return version;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireTrip(tripId: string): Trip {
  const trip = trips.find((t) => t.id === tripId);
  if (!trip) throw new Error(`Viaje no encontrado: ${tripId}`);
  return trip;
}

function requireMember(trip: Trip, userId: string): Member {
  const m = trip.members.find((mm) => mm.userId === userId);
  if (!m) throw new Error('No eres miembro de este viaje');
  return m;
}

function assertRole(trip: Trip, userId: string, allowed: MemberRole[]): void {
  const m = requireMember(trip, userId);
  if (!allowed.includes(m.role)) throw new Error('No tienes permisos para esta acción');
}

function canEdit(trip: Trip, userId: string): boolean {
  const m = trip.members.find((mm) => mm.userId === userId);
  return !!m && m.role !== 'viewer';
}

function upsertPresence(userId: string, tripId: string): Presence {
  const u = userOf(userId);
  const entry: Presence = {
    userId,
    tripId,
    displayName: u.displayName,
    color: u.color,
    editingItemId: null,
    lastSeen: nowIso(),
  };
  const list = presence[tripId] ?? (presence[tripId] = []);
  const existing = list.findIndex((p) => p.userId === userId);
  if (existing >= 0) {
    list[existing] = { ...list[existing], lastSeen: entry.lastSeen, displayName: u.displayName, color: u.color };
  } else {
    list.push(entry);
  }
  return entry;
}

function removePresence(userId: string, tripId: string): void {
  if (!presence[tripId]) return;
  presence[tripId] = presence[tripId].filter((p) => p.userId !== userId);
}

// ---------------------------------------------------------------------------
// Presence simulation
// ---------------------------------------------------------------------------

const BOTS = ['user-sofia', 'user-diego', 'user-valeria', 'user-mateo'];

function schedulePresenceTick(): void {
  const next = 10000 + Math.random() * 10000;
  setTimeout(() => {
    for (const trip of trips) {
      if (Math.random() < 0.75) {
        const online = botPresence[trip.id] ?? (botPresence[trip.id] = []);
        const entering = Math.random() < 0.5 || online.length === 0;
        if (entering) {
          const candidates = BOTS.filter((b) => !online.includes(b));
          const pick = candidates[Math.floor(Math.random() * candidates.length)];
          if (pick) {
            online.push(pick);
            upsertPresence(pick, trip.id);
          }
        } else {
          const pick = online[Math.floor(Math.random() * online.length)];
          if (pick) {
            botPresence[trip.id] = online.filter((b) => b !== pick);
            removePresence(pick, trip.id);
          }
        }
      }
    }
    notify();
    schedulePresenceTick();
  }, next);
}

if (typeof window !== 'undefined') {
  schedulePresenceTick();
}

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

const RATIONALES: Record<string, string[]> = {
  sight: [
    'Imprescindible según viajeros que ya han estado aquí.',
    'Destacado en todas las guías de la ciudad.',
    'Vistas y experiencia que no te puedes perder.',
  ],
  food: [
    'Muy recomendado por la gente local para comer bien.',
    'Buena relación calidad-precio y ambiente auténtico.',
    'Un clásico que hay que probar al menos una vez.',
  ],
  activity: [
    'Una experiencia única que da vida al viaje.',
    'Ideal para este día y combina con tu itinerario.',
    'Actividad muy valorada, reserva con antelación.',
  ],
  nightlife: [
    'El mejor plan para cerrar la noche de este día.',
    'Ambiente genial y cerca de tu zona de interés.',
    'Favorito de la noche según los locales.',
  ],
};

const FALLBACK_RATIONALES = [
  'Encaja muy bien con el resto de tu itinerario.',
  'Una opción que equilibra tu presupuesto del día.',
  'Muy buena puntuación y comentarios recientes.',
];

function buildSuggestions(trip: Trip, day: string): Suggestion[] {
  const destActivities = activities[trip.destinationId] ?? [];
  const addedIds = new Set(trip.items.map((i) => i.activityId).filter(Boolean));
  const pool = destActivities.filter((a) => !addedIds.has(a.id));

  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const count = Math.max(3, Math.min(6, shuffled.length > 5 ? 5 : shuffled.length));
  const picks = shuffled.slice(0, count);

  const suggestions: Suggestion[] = picks.map((a) => {
    const bucket = RATIONALES[a.category] ?? FALLBACK_RATIONALES;
    return {
      title: a.name,
      category: a.category,
      cost: a.cost,
      rationale: bucket[Math.floor(Math.random() * bucket.length)],
      activityId: a.id,
    };
  });

  while (suggestions.length < 3) {
    suggestions.push({
      title: ['Paseo por la ciudad', 'Cena local', 'Visita sorpresa'][suggestions.length % 3],
      category: 'activity',
      cost: Math.round(10 + Math.random() * 40),
      rationale: FALLBACK_RATIONALES[Math.floor(Math.random() * FALLBACK_RATIONALES.length)],
      activityId: null,
    });
  }

  return suggestions;
}

// ---------------------------------------------------------------------------
// API implementation
// ---------------------------------------------------------------------------

export const mockApi: TriplannerApi = {
  subscribe,
  getVersion,

  async loginDemo(): Promise<UserProfile> {
    await delay();
    currentUserId = CURRENT_USER_ID;
    const u = SEED_USERS[CURRENT_USER_ID];
    if (typeof window !== 'undefined') {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ userId: CURRENT_USER_ID }));
    }
    notify();
    return { userId: u.userId, email: u.email, displayName: u.displayName };
  },

  async logout(): Promise<void> {
    await delay(80, 160);
    if (currentUserId) {
      for (const trip of trips) removePresence(currentUserId, trip.id);
    }
    currentUserId = null;
    if (typeof window !== 'undefined') {
      localStorage.removeItem(SESSION_KEY);
    }
    notify();
  },

  async restoreSession(): Promise<UserProfile | null> {
    if (typeof window === 'undefined') return null;
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { userId: string };
      if (parsed.userId && SEED_USERS[parsed.userId]) {
        currentUserId = parsed.userId;
        const u = SEED_USERS[parsed.userId];
        return { userId: u.userId, email: u.email, displayName: u.displayName };
      }
    } catch {
      localStorage.removeItem(SESSION_KEY);
    }
    return null;
  },

  getCurrentUser(): UserProfile | null {
    if (!currentUserId) return null;
    const u = SEED_USERS[currentUserId];
    if (!u) return null;
    return { userId: u.userId, email: u.email, displayName: u.displayName };
  },

  async findUserByEmail(email: string): Promise<UserProfile | null> {
    await delay(100, 200);
    const match = Object.values(SEED_USERS).find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
    if (!match) return null;
    return { userId: match.userId, email: match.email, displayName: match.displayName };
  },

  async listMyTrips(): Promise<TripSummary[]> {
    await delay();
    if (!currentUserId) return [];
    return trips
      .filter((t) => t.members.some((m) => m.userId === currentUserId))
      .map((t) => summary(t, currentUserId!));
  },

  async getTrip(id: string): Promise<Trip | null> {
    await delay();
    if (!currentUserId) return null;
    const trip = trips.find((t) => t.id === id);
    if (!trip) return null;
    const role = trip.members.find((m) => m.userId === currentUserId)?.role ?? 'viewer';
    return decorate({ ...clone(trip), myRole: role });
  },

  async listDestinations(): Promise<Destination[]> {
    await delay(100, 250);
    return clone(destinations);
  },

  async listActivities(destSlug: string, category?: string): Promise<Activity[]> {
    await delay(100, 250);
    const list = activities[destSlug] ?? [];
    return clone(category ? list.filter((a) => a.category === category) : list);
  },

  async listPresence(tripId: string): Promise<Presence[]> {
    await delay(60, 150);
    return clone(presence[tripId] ?? []);
  },

  async createTrip(input: CreateTripInput): Promise<Trip> {
    await delay();
    if (!currentUserId) throw new Error('Debes iniciar sesión');
    const now = nowIso();
    const me = SEED_USERS[currentUserId];
    const trip: Trip = {
      id: uid(),
      name: input.name,
      destinationId: input.destinationId,
      destinationName: input.destinationName,
      startDate: input.startDate,
      endDate: input.endDate,
      totalBudget: input.totalBudget,
      spent: 0,
      spentByCategory: [],
      ownerId: currentUserId,
      inviteCode: inviteCodeFor(uid()),
      members: [{ userId: currentUserId, displayName: me.displayName, email: me.email, role: 'owner', joinedAt: now }],
      items: [],
      myRole: 'owner',
      createdAt: now,
      updatedAt: now,
    };
    trips.unshift(trip);
    notify();
    return decorate(clone(trip));
  },

  async updateTripSettings(id: string, input: UpdateTripSettingsInput): Promise<Trip> {
    await delay();
    if (!currentUserId) throw new Error('Debes iniciar sesión');
    const trip = requireTrip(id);
    assertRole(trip, currentUserId, ['owner', 'editor']);
    if (input.name !== undefined) trip.name = input.name;
    if (input.startDate !== undefined) trip.startDate = input.startDate;
    if (input.endDate !== undefined) trip.endDate = input.endDate;
    if (input.destinationId !== undefined) trip.destinationId = input.destinationId;
    if (input.destinationName !== undefined) trip.destinationName = input.destinationName;
    trip.updatedAt = nowIso();
    notify();
    return decorate(clone(trip));
  },

  async setBudget(tripId: string, totalBudget: number): Promise<Trip> {
    await delay();
    if (!currentUserId) throw new Error('Debes iniciar sesión');
    const trip = requireTrip(tripId);
    assertRole(trip, currentUserId, ['owner', 'editor']);
    trip.totalBudget = round2(totalBudget);
    trip.updatedAt = nowIso();
    notify();
    return decorate(clone(trip));
  },

  async inviteMember(tripId: string, args: InviteMemberArgs): Promise<Trip> {
    await delay();
    if (!currentUserId) throw new Error('Debes iniciar sesión');
    const trip = requireTrip(tripId);
    assertRole(trip, currentUserId, ['owner', 'editor']);
    const now = nowIso();
    const userId = args.userId ?? `user-${uid().slice(0, 8)}`;
    if (trip.members.some((m) => m.userId === userId)) return decorate(clone(trip));
    trip.members.push({
      userId,
      displayName: args.displayName,
      email: args.email,
      role: args.role,
      joinedAt: now,
    });
    trip.updatedAt = now;
    notify();
    return decorate(clone(trip));
  },

  async updateMemberRole(tripId: string, userId: string, role: MemberRole): Promise<Trip> {
    await delay();
    if (!currentUserId) throw new Error('Debes iniciar sesión');
    const trip = requireTrip(tripId);
    assertRole(trip, currentUserId, ['owner', 'editor']);
    const m = requireMember(trip, userId);
    if (m.userId === trip.ownerId && role !== 'owner') {
      throw new Error('El propietario del viaje no puede cambiar de rol');
    }
    m.role = role;
    trip.updatedAt = nowIso();
    notify();
    return decorate(clone(trip));
  },

  async removeMember(tripId: string, userId: string): Promise<Trip> {
    await delay();
    if (!currentUserId) throw new Error('Debes iniciar sesión');
    const trip = requireTrip(tripId);
    assertRole(trip, currentUserId, ['owner', 'editor']);
    if (userId === trip.ownerId) throw new Error('No puedes quitar al propietario');
    trip.members = trip.members.filter((m) => m.userId !== userId);
    removePresence(userId, tripId);
    trip.updatedAt = nowIso();
    notify();
    return decorate(clone(trip));
  },

  async leaveTrip(tripId: string): Promise<Trip> {
    await delay();
    if (!currentUserId) throw new Error('Debes iniciar sesión');
    const trip = requireTrip(tripId);
    if (currentUserId === trip.ownerId) throw new Error('El propietario no puede salir del viaje');
    trip.members = trip.members.filter((m) => m.userId !== currentUserId);
    removePresence(currentUserId, tripId);
    trip.updatedAt = nowIso();
    notify();
    return decorate(clone(trip));
  },

  async addItem(tripId: string, input: AddItemInput): Promise<TripItem> {
    await delay();
    if (!currentUserId) throw new Error('Debes iniciar sesión');
    const trip = requireTrip(tripId);
    if (!canEdit(trip, currentUserId)) throw new Error('No tienes permisos para editar');
    const maxOrder = trip.items.filter((i) => i.day === input.day).reduce((m, i) => Math.max(m, i.order), -1);
    const newItem: TripItem = {
      id: uid(),
      day: input.day,
      order: input.order ?? maxOrder + 1,
      activityId: input.activityId ?? null,
      title: input.title,
      category: input.category,
      cost: round2(input.cost),
      startTime: input.startTime ?? null,
      notes: input.notes ?? null,
      imageUrl: input.imageUrl ?? null,
      addedBy: currentUserId,
    };
    trip.items.push(newItem);
    trip.updatedAt = nowIso();
    notify();
    return clone(newItem);
  },

  async updateItem(tripId: string, itemId: string, input: UpdateItemInput): Promise<TripItem> {
    await delay();
    if (!currentUserId) throw new Error('Debes iniciar sesión');
    const trip = requireTrip(tripId);
    if (!canEdit(trip, currentUserId)) throw new Error('No tienes permisos para editar');
    const item = trip.items.find((i) => i.id === itemId);
    if (!item) throw new Error('Ítem no encontrado');
    if (input.day !== undefined) item.day = input.day;
    if (input.order !== undefined) item.order = input.order;
    if (input.startTime !== undefined) item.startTime = input.startTime ?? null;
    if (input.notes !== undefined) item.notes = input.notes ?? null;
    if (input.title !== undefined) item.title = input.title;
    trip.updatedAt = nowIso();
    notify();
    return clone(item);
  },

  async setItemCost(tripId: string, itemId: string, cost: number): Promise<TripItem> {
    await delay();
    if (!currentUserId) throw new Error('Debes iniciar sesión');
    const trip = requireTrip(tripId);
    if (!canEdit(trip, currentUserId)) throw new Error('No tienes permisos para editar');
    const item = trip.items.find((i) => i.id === itemId);
    if (!item) throw new Error('Ítem no encontrado');
    item.cost = round2(cost);
    trip.updatedAt = nowIso();
    notify();
    return clone(item);
  },

  async moveItem(tripId: string, itemId: string, day: string, order: number): Promise<TripItem> {
    await delay();
    if (!currentUserId) throw new Error('Debes iniciar sesión');
    const trip = requireTrip(tripId);
    if (!canEdit(trip, currentUserId)) throw new Error('No tienes permisos para editar');
    const item = trip.items.find((i) => i.id === itemId);
    if (!item) throw new Error('Ítem no encontrado');
    item.day = day;
    item.order = order;
    trip.updatedAt = nowIso();
    notify();
    return clone(item);
  },

  async removeItem(tripId: string, itemId: string): Promise<TripItem> {
    await delay();
    if (!currentUserId) throw new Error('Debes iniciar sesión');
    const trip = requireTrip(tripId);
    if (!canEdit(trip, currentUserId)) throw new Error('No tienes permisos para editar');
    const idx = trip.items.findIndex((i) => i.id === itemId);
    if (idx < 0) throw new Error('Ítem no encontrado');
    const [removed] = trip.items.splice(idx, 1);
    trip.updatedAt = nowIso();
    notify();
    return clone(removed);
  },

  async requestSuggestions(tripId: string, day: string): Promise<SuggestionSet> {
    await delay(500, 900);
    if (!currentUserId) throw new Error('Debes iniciar sesión');
    const trip = requireTrip(tripId);
    return { day, items: buildSuggestions(trip, day) };
  },

  async touchPresence(input: PresenceInput): Promise<Presence> {
    await delay(50, 120);
    if (!currentUserId) throw new Error('Debes iniciar sesión');
    const entry = upsertPresence(currentUserId, input.tripId);
    entry.displayName = input.displayName;
    entry.color = input.color;
    if (input.editingItemId !== undefined) entry.editingItemId = input.editingItemId ?? null;
    notify();
    return clone(entry);
  },
};
