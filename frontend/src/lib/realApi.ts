import type {
  Activity,
  AddItemInput,
  CreateTripInput,
  Destination,
  InviteMemberArgs,
  Location,
  MemberRole,
  Presence,
  PresenceInput,
  SuggestionSet,
  Trip,
  TripItem,
  TripSummary,
  UpdateItemInput,
  UpdateTripSettingsInput,
  UserProfile,
} from './types';
import { TriplannerApi } from './types';
import { getLocalGraphqlUrl } from './config';

/**
 * Cliente GraphQL del backend local (graphql-yoga en localhost:4000/graphql).
 *
 * Usa fetch nativo (POST) contra el MISMO schema de AppSync más las extensiones
 * locales (searchLocations / locationDetails). Auth demo vía header `x-user-id`.
 *
 * Modo AWS (AppSync + Cognito) sigue siendo trabajo futuro: cuando
 * `aws-config.json` esté completo, este módulo deberá reemplazarse por un
 * cliente Amplify/Apollo. Hoy `getMode() === 'aws'` nunca se activa porque
 * aws-config.json está vacío.
 */

const DEFAULT_ENDPOINT = 'http://localhost:4000/graphql';
const ENDPOINT = getLocalGraphqlUrl() ?? DEFAULT_ENDPOINT;

const DEMO_USER_ID = 'demo-user';
const DEMO_EMAIL = 'demo@triplanner.local';
const DEMO_DISPLAY_NAME = 'Demo';

const SESSION_KEY = 'triplanner.local.session';

let currentUser: UserProfile | null = null;
let version = 0;
const listeners = new Set<() => void>();

function notify(): void {
  version += 1;
  listeners.forEach((l) => l());
}

interface GqlError {
  message: string;
}

interface GqlResponse<T> {
  data?: T;
  errors?: GqlError[];
}

async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': currentUser?.userId ?? DEMO_USER_ID,
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch {
    throw new Error('No se pudo conectar con el backend local.');
  }
  if (!res.ok) {
    throw new Error(`El backend local respondió con estado ${res.status}.`);
  }
  const json = (await res.json()) as GqlResponse<T>;
  if (json.errors && json.errors.length > 0) {
    throw new Error(json.errors[0].message);
  }
  return json.data as T;
}

// ---------------------------------------------------------------------------
// Documentos GraphQL
// ---------------------------------------------------------------------------

const TRIP_FIELDS = `
  id
  name
  destinationId
  destinationName
  startDate
  endDate
  totalBudget
  spent
  spentByCategory { category amount }
  ownerId
  inviteCode
  members { userId displayName email role joinedAt }
  items { id day order activityId title category cost startTime notes imageUrl addedBy }
  myRole
  createdAt
  updatedAt
`;

const ITEM_FIELDS = `
  id day order activityId title category cost startTime notes imageUrl addedBy
`;

const LOCATION_FIELDS = `
  id name category rawType description lat lng address rating ratingCount
  phone priceLevel websiteUrl imageUrl cost durationHours tags hours socialLinks source placeId
`;

const LIST_MY_TRIPS = `query { listMyTrips { tripId tripName destinationName startDate endDate role joinedAt } }`;
const GET_TRIP = `query($id: ID!) { getTrip(id: $id) { ${TRIP_FIELDS} } }`;
const LIST_DESTINATIONS = `query { listDestinations { slug name country description imageUrl lat lng } }`;
const LIST_ACTIVITIES = `query($destSlug: String!, $category: String) { listActivities(destSlug: $destSlug, category: $category) { id name category cost lat lng description tags durationHours imageUrl rating } }`;
const LIST_PRESENCE = `query($tripId: ID!) { listPresence(tripId: $tripId) { userId tripId displayName color editingItemId lastSeen } }`;
const FIND_USER_BY_EMAIL = `query($email: String!) { findUserByEmail(email: $email) { userId email displayName } }`;

const REGISTER_USER = `mutation($input: RegisterUserInput!) { registerUser(input: $input) { userId email displayName } }`;
const CREATE_TRIP = `mutation($input: CreateTripInput!) { createTrip(input: $input) { ${TRIP_FIELDS} } }`;
const UPDATE_TRIP_SETTINGS = `mutation($id: ID!, $input: UpdateTripSettingsInput!) { updateTripSettings(id: $id, input: $input) { ${TRIP_FIELDS} } }`;
const SET_BUDGET = `mutation($tripId: ID!, $totalBudget: Float!) { setBudget(tripId: $tripId, totalBudget: $totalBudget) { ${TRIP_FIELDS} } }`;
const INVITE_MEMBER = `mutation($tripId: ID!, $userId: String!, $email: String!, $displayName: String!, $role: MemberRole!) { inviteMember(tripId: $tripId, userId: $userId, email: $email, displayName: $displayName, role: $role) { ${TRIP_FIELDS} } }`;
const UPDATE_MEMBER_ROLE = `mutation($tripId: ID!, $userId: String!, $role: MemberRole!) { updateMemberRole(tripId: $tripId, userId: $userId, role: $role) { ${TRIP_FIELDS} } }`;
const REMOVE_MEMBER = `mutation($tripId: ID!, $userId: String!) { removeMember(tripId: $tripId, userId: $userId) { ${TRIP_FIELDS} } }`;
const LEAVE_TRIP = `mutation($tripId: ID!) { leaveTrip(tripId: $tripId) { ${TRIP_FIELDS} } }`;

const ADD_ITEM = `mutation($tripId: ID!, $input: AddItemInput!) { addItem(tripId: $tripId, input: $input) { ${ITEM_FIELDS} } }`;
const UPDATE_ITEM = `mutation($tripId: ID!, $itemId: ID!, $input: UpdateItemInput!) { updateItem(tripId: $tripId, itemId: $itemId, input: $input) { ${ITEM_FIELDS} } }`;
const SET_ITEM_COST = `mutation($tripId: ID!, $itemId: ID!, $cost: Float!) { setItemCost(tripId: $tripId, itemId: $itemId, cost: $cost) { ${ITEM_FIELDS} } }`;
const MOVE_ITEM = `mutation($tripId: ID!, $itemId: ID!, $day: AWSDate!, $order: Int!) { moveItem(tripId: $tripId, itemId: $itemId, day: $day, order: $order) { ${ITEM_FIELDS} } }`;
const REMOVE_ITEM = `mutation($tripId: ID!, $itemId: ID!) { removeItem(tripId: $tripId, itemId: $itemId) { ${ITEM_FIELDS} } }`;

const TOUCH_PRESENCE = `mutation($input: PresenceInput!) { touchPresence(input: $input) { userId tripId displayName color editingItemId lastSeen } }`;
const REQUEST_SUGGESTIONS = `mutation($tripId: ID!, $day: AWSDate!) { requestSuggestions(tripId: $tripId, day: $day) { day items { title category cost rationale activityId } } }`;

const SEARCH_LOCATIONS = `query($q: String!, $lat: Float, $lng: Float) { searchLocations(q: $q, lat: $lat, lng: $lng) { ${LOCATION_FIELDS} } }`;
const LOCATION_DETAILS = `query($placeId: String!) { locationDetails(placeId: $placeId) { ${LOCATION_FIELDS} } }`;
const LOCATION_BY_ID = `query($id: ID!) { locationById(id: $id) { ${LOCATION_FIELDS} } }`;

// ---------------------------------------------------------------------------
// Operaciones extra (no forman parte de la fachada TriplannerApi)
// ---------------------------------------------------------------------------

export async function searchLocations(q: string, lat?: number, lng?: number): Promise<Location[]> {
  const data = await gql<{ searchLocations: Location[] }>(SEARCH_LOCATIONS, { q, lat, lng });
  return data.searchLocations.map((loc) => ({ ...loc, tags: loc.tags ?? [] }));
}

export async function locationDetails(placeId: string): Promise<Location | null> {
  const data = await gql<{ locationDetails: Location | null }>(LOCATION_DETAILS, { placeId });
  return data.locationDetails;
}

export async function locationById(id: string): Promise<Location | null> {
  const data = await gql<{ locationById: Location | null }>(LOCATION_BY_ID, { id });
  return data.locationById;
}

export async function registerUser(displayName: string): Promise<UserProfile> {
  const data = await gql<{ registerUser: UserProfile }>(REGISTER_USER, {
    input: { displayName },
  });
  return data.registerUser;
}

// ---------------------------------------------------------------------------
// Implementación de la fachada
// ---------------------------------------------------------------------------

function persistSession(profile: UserProfile): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(SESSION_KEY, JSON.stringify(profile));
  }
}

export const realApi: TriplannerApi = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getVersion: () => version,

  async loginDemo(): Promise<UserProfile> {
    const fallback: UserProfile = {
      userId: DEMO_USER_ID,
      email: DEMO_EMAIL,
      displayName: DEMO_DISPLAY_NAME,
    };
    let profile: UserProfile | null = null;
    try {
      const data = await gql<{ findUserByEmail: UserProfile | null }>(FIND_USER_BY_EMAIL, {
        email: DEMO_EMAIL,
      });
      profile = data.findUserByEmail;
    } catch {
      profile = null;
    }
    currentUser = profile ?? fallback;
    persistSession(currentUser);
    notify();
    return currentUser;
  },

  async logout(): Promise<void> {
    currentUser = null;
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
      const parsed = JSON.parse(raw) as UserProfile;
      if (parsed.userId) {
        currentUser = parsed;
        return parsed;
      }
    } catch {
      localStorage.removeItem(SESSION_KEY);
    }
    return null;
  },

  getCurrentUser(): UserProfile | null {
    return currentUser;
  },

  async findUserByEmail(email: string): Promise<UserProfile | null> {
    const data = await gql<{ findUserByEmail: UserProfile | null }>(FIND_USER_BY_EMAIL, { email });
    return data.findUserByEmail;
  },

  async listMyTrips(): Promise<TripSummary[]> {
    const data = await gql<{ listMyTrips: TripSummary[] }>(LIST_MY_TRIPS);
    return data.listMyTrips;
  },

  async getTrip(id: string): Promise<Trip | null> {
    const data = await gql<{ getTrip: Trip | null }>(GET_TRIP, { id });
    return data.getTrip;
  },

  async listDestinations(): Promise<Destination[]> {
    const data = await gql<{ listDestinations: Destination[] }>(LIST_DESTINATIONS);
    return data.listDestinations;
  },

  async listActivities(destSlug: string, category?: string): Promise<Activity[]> {
    const data = await gql<{ listActivities: Activity[] }>(LIST_ACTIVITIES, { destSlug, category });
    return data.listActivities;
  },

  async listPresence(tripId: string): Promise<Presence[]> {
    const data = await gql<{ listPresence: Presence[] }>(LIST_PRESENCE, { tripId });
    return data.listPresence;
  },

  async createTrip(input: CreateTripInput): Promise<Trip> {
    const data = await gql<{ createTrip: Trip }>(CREATE_TRIP, { input });
    notify();
    return data.createTrip;
  },

  async updateTripSettings(id: string, input: UpdateTripSettingsInput): Promise<Trip> {
    const data = await gql<{ updateTripSettings: Trip }>(UPDATE_TRIP_SETTINGS, { id, input });
    notify();
    return data.updateTripSettings;
  },

  async setBudget(tripId: string, totalBudget: number): Promise<Trip> {
    const data = await gql<{ setBudget: Trip }>(SET_BUDGET, { tripId, totalBudget });
    notify();
    return data.setBudget;
  },

  async inviteMember(tripId: string, args: InviteMemberArgs): Promise<Trip> {
    const data = await gql<{ inviteMember: Trip }>(INVITE_MEMBER, {
      tripId,
      userId: args.userId ?? '',
      email: args.email,
      displayName: args.displayName,
      role: args.role,
    });
    notify();
    return data.inviteMember;
  },

  async updateMemberRole(tripId: string, userId: string, role: MemberRole): Promise<Trip> {
    const data = await gql<{ updateMemberRole: Trip }>(UPDATE_MEMBER_ROLE, { tripId, userId, role });
    notify();
    return data.updateMemberRole;
  },

  async removeMember(tripId: string, userId: string): Promise<Trip> {
    const data = await gql<{ removeMember: Trip }>(REMOVE_MEMBER, { tripId, userId });
    notify();
    return data.removeMember;
  },

  async leaveTrip(tripId: string): Promise<Trip> {
    const data = await gql<{ leaveTrip: Trip }>(LEAVE_TRIP, { tripId });
    notify();
    return data.leaveTrip;
  },

  async addItem(tripId: string, input: AddItemInput): Promise<TripItem> {
    const data = await gql<{ addItem: TripItem }>(ADD_ITEM, { tripId, input });
    notify();
    return data.addItem;
  },

  async updateItem(tripId: string, itemId: string, input: UpdateItemInput): Promise<TripItem> {
    const data = await gql<{ updateItem: TripItem }>(UPDATE_ITEM, { tripId, itemId, input });
    notify();
    return data.updateItem;
  },

  async setItemCost(tripId: string, itemId: string, cost: number): Promise<TripItem> {
    const data = await gql<{ setItemCost: TripItem }>(SET_ITEM_COST, { tripId, itemId, cost });
    notify();
    return data.setItemCost;
  },

  async moveItem(tripId: string, itemId: string, day: string, order: number): Promise<TripItem> {
    const data = await gql<{ moveItem: TripItem }>(MOVE_ITEM, { tripId, itemId, day, order });
    notify();
    return data.moveItem;
  },

  async removeItem(tripId: string, itemId: string): Promise<TripItem> {
    const data = await gql<{ removeItem: TripItem }>(REMOVE_ITEM, { tripId, itemId });
    notify();
    return data.removeItem;
  },

  async requestSuggestions(tripId: string, day: string): Promise<SuggestionSet> {
    const data = await gql<{ requestSuggestions: SuggestionSet }>(REQUEST_SUGGESTIONS, { tripId, day });
    return data.requestSuggestions;
  },

  async touchPresence(input: PresenceInput): Promise<Presence> {
    const data = await gql<{ touchPresence: Presence }>(TOUCH_PRESENCE, { input });
    return data.touchPresence;
  },
};
