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
  TripEvent,
  TripItem,
  TripSummary,
  UpdateItemInput,
  UpdateTripSettingsInput,
  UpdateTripCoverInput,
  UserProfile,
  TripPreview,
  InviteResult,
  Attachment,
  SuggestionChat,
  AutoSuggestResult,
  LlmSettings,
  UpdateLlmSettingsInput,
  EmailSettings,
  UpdateEmailSettingsInput,
} from './types';
import type { TriplannerApi } from './types';
import { es } from './i18n/es';
import type { TranslationKey } from './i18n';

// Traductor mínimo (no acopla la fachada al contexto React).
export type ApiTranslator = (key: TranslationKey, params?: Record<string, string | number>) => string;

// Error de API con el `extensions.code` del backend (si lo hubo). El caller
// decide cómo traducirlo con `localizeApiError`; la fachada nunca importa React.
export class ApiError extends Error {
  readonly code?: string;
  readonly params?: Record<string, string | number>;

  constructor(message: string, options?: { code?: string; params?: Record<string, string | number> }) {
    super(message);
    this.name = 'ApiError';
    this.code = options?.code;
    this.params = options?.params;
  }
}

function hasErrorKey(key: string): key is TranslationKey {
  return Object.prototype.hasOwnProperty.call(es, key);
}

// Traduce un error de API a partir de su `code` (clave `errors.<CODE>`); si no
// hay clave conocida, cae al mensaje del servidor (o al genérico).
export function localizeApiError(err: unknown, t: ApiTranslator): string {
  if (err instanceof ApiError && err.code) {
    const key = `errors.${err.code}`;
    if (hasErrorKey(key)) return t(key, err.params);
  }
  if (err instanceof Error && err.message) return err.message;
  return t('errors.generic');
}

// Fachada de datos del frontend Next.js. El navegador SOLO habla con el proxy
// /api/graphql (route handler de Next); ese proxy reenvia al backend local y
// resuelve del lado del servidor el x-user-id demo. Aqui nunca viajan
// credenciales ni claves: patron inicial CSR completo.

export type DataMode = 'local' | 'aws' | 'mock';

// El cliente siempre habla con el backend local a traves del proxy; no hay
// modo mock en Next (si el backend no esta, el proxy devuelve 502 y la UI
// muestra el mismo empty state).
export const mode: DataMode = 'local';

const ENDPOINT = '/api/graphql';

export const DEMO_USER_ID = 'demo-user';
export const DEMO_FRIEND_ID = 'demo-friend';
export const DEMO_FRIEND_EMAIL = 'friend@triplanner.local';

const DEMO_IDENTITIES: Record<string, { email: string; displayName: string }> = {
  [DEMO_USER_ID]: { email: 'demo@triplanner.local', displayName: 'Demo' },
  [DEMO_FRIEND_ID]: { email: DEMO_FRIEND_EMAIL, displayName: 'Demo Friend' },
};

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
  extensions?: { code?: string } | null;
}

interface GqlResponse<T> {
  data?: T;
  errors?: GqlError[];
}

// Cabeceras de auth resueltas desde el provider inyectado por useAuth. Se
// exponen para que clientes de fetch directo (p. ej. el agente de sugerencias)
// usen EXACTAMENTE el mismo token que la fachada GraphQL.
export async function getAuthHeaders(): Promise<Record<string, string>> {
  return { 'x-user-id': currentUser?.userId ?? DEMO_USER_ID };
}

async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(await getAuthHeaders()),
  };

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, variables }),
    });
  } catch {
    // El mensaje es un fallback: la UI lo traduce vía errors.backendUnreachable.
    throw new ApiError('No se pudo conectar con el backend local.', { code: 'backendUnreachable' });
  }
  if (!res.ok) {
    throw new ApiError(`El backend local respondió con estado ${res.status}.`, {
      code: 'backendStatus',
      params: { status: res.status },
    });
  }
  const json = (await res.json()) as GqlResponse<T>;
  if (json.errors && json.errors.length > 0) {
    const first = json.errors[0];
    throw new ApiError(first.message, { code: first.extensions?.code });
  }
  return json.data as T;
}

// ---------------------------------------------------------------------------
// Subscriptions GraphQL reales por SSE (fetch + ReadableStream, sin deps)
// ---------------------------------------------------------------------------
//
// OJO: esto NO tiene nada que ver con notify()/subscribe(listener) de arriba
// (aquel es un simple bus de re-suscripcion en memoria). Aqui abrimos una
// conexion HTTP persistente contra el backend graphql-yoga (via el proxy
// /api/graphql) que emite text/event-stream y entregamos cada evento al caller.

const SUBSCRIBE_TRIP = `subscription($tripId: ID!) { onTripChanged(tripId: $tripId) { tripId mutationType entity actorId } }`;
const SUBSCRIBE_PRESENCE = `subscription($tripId: ID!) { onPresenceChanged(tripId: $tripId) { userId tripId displayName color editingItemId lastSeen } }`;

const SSE_MAX_BACKOFF_MS = 10_000;

interface SseSubscription<T> {
  query: string;
  tripId: string;
  field: string;
  onEvent: (ev: T) => void;
  signal?: AbortSignal;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);
    function finish(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    }
    signal.addEventListener('abort', finish, { once: true });
  });
}

// Parsea lineas SSE (`event:`/`data:`/comentarios `:`/separadores) y emite el
// payload GraphQL `{ data: { <field>: {...} } }` al callback. Resuelve en EOF.
async function readEventStream<T>(
  body: ReadableStream<Uint8Array>,
  field: string,
  onEvent: (ev: T) => void
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const raw = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
        // Solo nos interesan las lineas `data:`; ignoramos `event:`, `id:`,
        // heartbeats (`:`) y separadores en blanco.
        if (!line.startsWith('data:')) continue;
        const payload = line.slice('data:'.length).trim();
        if (!payload) continue;
        try {
          const json = JSON.parse(payload) as { data?: Record<string, T> };
          const ev = json.data?.[field];
          if (ev) onEvent(ev);
        } catch {
          // Fragmento no-JSON (no deberia ocurrir): se descarta sin romper.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// Bucle de conexion + reconexion. Reutiliza getAuthHeaders() en CADA intento
// para recoger la identidad demo seleccionada.
async function runSse<T>(sub: SseSubscription<T>, controller: AbortController): Promise<void> {
  const { query, tripId, field, onEvent } = sub;
  const { signal } = controller;
  let attempt = 0;
  let authRetried = false;

  while (!signal.aborted) {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          ...(await getAuthHeaders()),
        },
        body: JSON.stringify({ query, variables: { tripId } }),
        signal,
      });

      if (res.status === 401 || res.status === 403) {
        // Reintenta UNA vez releyendo el token (getAuthHeaders puede refrescarlo).
        if (!authRetried) {
          authRetried = true;
          attempt = 0;
          continue;
        }
        console.warn(`[realtime] suscripción rechazada (${res.status}); se detiene.`);
        return;
      }

      if (!res.ok || !res.body) {
        throw new Error(`SSE respondió con estado ${res.status}.`);
      }

      authRetried = false;
      attempt = 0;
      await readEventStream<T>(res.body, field, onEvent);
      // EOF: el servidor cerró el stream → reconectar con backoff.
    } catch {
      if (signal.aborted) return;
      // Error de red / abort de fetch: cae al backoff y reintenta.
    }

    if (signal.aborted) return;
    const delay = Math.min(1000 * 2 ** attempt, SSE_MAX_BACKOFF_MS);
    attempt += 1;
    await sleep(delay, signal);
  }
}

function startSse<T>(sub: SseSubscription<T>): () => void {
  const controller = new AbortController();
  const external = sub.signal;
  const abortFromExternal = (): void => controller.abort();

  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener('abort', abortFromExternal, { once: true });
  }

  void runSse(sub, controller);

  return () => {
    controller.abort();
    external?.removeEventListener('abort', abortFromExternal);
  };
}

// Suscripcion viva a los cambios de un viaje. Devuelve la funcion de cleanup.
export function subscribeTrip(
  tripId: string,
  onEvent: (ev: TripEvent) => void,
  signal?: AbortSignal
): () => void {
  return startSse<TripEvent>({ query: SUBSCRIBE_TRIP, tripId, field: 'onTripChanged', onEvent, signal });
}

// Suscripcion viva a la presencia de los miembros de un viaje.
export function subscribePresence(
  tripId: string,
  onEvent: (ev: Presence) => void,
  signal?: AbortSignal
): () => void {
  return startSse<Presence>({ query: SUBSCRIBE_PRESENCE, tripId, field: 'onPresenceChanged', onEvent, signal });
}

// ---------------------------------------------------------------------------
// Documentos GraphQL
// ---------------------------------------------------------------------------

const TRIP_FIELDS = `
  id
  name
  destinationId
  destinationName
  destinationLat
  destinationLng
  startDate
  endDate
  timezone
  totalBudget
  spent
  spentByCategory { category amount }
  ownerId
  inviteCode
  coverPreset
  coverPhotoUrl
  members { userId displayName email invitedEmail role joinedAt color avatarUrl }
  items { id day order activityId title category cost startTime notes imageUrl addedBy isFavorite lat lng locationText reminderEnabled attachments { id fileName mimeType sizeBytes url createdAt uploadedByName viewerIds visibility createdBy } }
  myRole
  createdAt
  updatedAt
`;

const ITEM_FIELDS = `
  id day order activityId title category cost startTime notes imageUrl addedBy isFavorite lat lng locationText reminderEnabled
  attachments { id fileName mimeType sizeBytes url createdAt uploadedByName viewerIds visibility createdBy }
`;

const LOCATION_FIELDS = `
  id name category rawType description lat lng address rating ratingCount
  phone priceLevel websiteUrl imageUrl cost durationHours tags hours socialLinks source placeId isFavorite
`;

const LIST_MY_TRIPS = `query { listMyTrips { tripId tripName destinationName startDate endDate role joinedAt } }`;
const GET_TRIP = `query($id: ID!) { getTrip(id: $id) { ${TRIP_FIELDS} } }`;
const LIST_DESTINATIONS = `query { listDestinations { slug name country description imageUrl lat lng } }`;
const LIST_ACTIVITIES = `query($destSlug: String!, $category: String) { listActivities(destSlug: $destSlug, category: $category) { id name category cost lat lng description tags durationHours imageUrl rating isFavorite } }`;
const LIST_PRESENCE = `query($tripId: ID!) { listPresence(tripId: $tripId) { userId tripId displayName color editingItemId lastSeen } }`;
const FIND_USER_BY_EMAIL = `query($email: String!) { findUserByEmail(email: $email) { userId email displayName } }`;
const GET_TRIP_BY_CODE = `query($code: String!) { getTripByCode(code: $code) { id name destinationName ownerName invitedEmail } }`;
const SEND_TRIP_INVITE = `mutation($tripId: ID!, $email: String!, $role: String!) { sendTripInvite(tripId: $tripId, email: $email, role: $role) { invitationId status email code joinUrl } }`;
const JOIN_TRIP_WITH_CODE = `mutation($code: String!, $email: String!) { joinTripWithCode(code: $code, email: $email) { ${TRIP_FIELDS} } }`;
const GET_MY_PROFILE = `query { getMyProfile { userId email displayName color avatarUrl language } }`;
const UPDATE_MY_PROFILE = `mutation($input: UpdateMyProfileInput!) { updateMyProfile(input: $input) { userId email displayName color avatarUrl language } }`;
const ADD_ITEM_ATTACHMENT = `mutation($tripId: ID, $itemId: ID!, $input: AddItemAttachmentInput!, $viewerIds: [String!]) { addItemAttachment(tripId: $tripId, itemId: $itemId, input: $input, viewerIds: $viewerIds) { id fileName mimeType sizeBytes url createdAt uploadedByName viewerIds visibility createdBy } }`;
const UPDATE_ATTACHMENT_VIEWERS = `mutation($attachmentId: ID!, $viewerIds: [String!]) { updateAttachmentViewers(attachmentId: $attachmentId, viewerIds: $viewerIds) { id fileName mimeType sizeBytes url createdAt uploadedByName viewerIds visibility createdBy } }`;
const REMOVE_ITEM_ATTACHMENT = `mutation($attachmentId: ID!) { removeItemAttachment(attachmentId: $attachmentId) { id } }`;
const FAVORITE_LOCATION = `mutation($locationId: ID!, $favorite: Boolean!) { favoriteLocation(locationId: $locationId, favorite: $favorite) { locationId favorite } }`;

const CREATE_TRIP = `mutation($input: CreateTripInput!) { createTrip(input: $input) { ${TRIP_FIELDS} } }`;
const UPDATE_TRIP_SETTINGS = `mutation($id: ID!, $input: UpdateTripSettingsInput!) { updateTripSettings(id: $id, input: $input) { ${TRIP_FIELDS} } }`;
const SET_BUDGET = `mutation($tripId: ID!, $totalBudget: Float!) { setBudget(tripId: $tripId, totalBudget: $totalBudget) { ${TRIP_FIELDS} } }`;
const INVITE_MEMBER = `mutation($tripId: ID!, $userId: String!, $email: String!, $displayName: String!, $role: MemberRole!) { inviteMember(tripId: $tripId, userId: $userId, email: $email, displayName: $displayName, role: $role) { ${TRIP_FIELDS} } }`;
const UPDATE_MEMBER_ROLE = `mutation($tripId: ID!, $userId: String!, $role: MemberRole!) { updateMemberRole(tripId: $tripId, userId: $userId, role: $role) { ${TRIP_FIELDS} } }`;
const REMOVE_MEMBER = `mutation($tripId: ID!, $userId: String!) { removeMember(tripId: $tripId, userId: $userId) { ${TRIP_FIELDS} } }`;
const LEAVE_TRIP = `mutation($tripId: ID!, $newOwnerId: ID) { leaveTrip(tripId: $tripId, newOwnerId: $newOwnerId) { ${TRIP_FIELDS} } }`;
const DELETE_TRIP = `mutation($tripId: ID!) { deleteTrip(tripId: $tripId) }`;
const UPDATE_TRIP_COVER = `mutation($tripId: ID!, $input: UpdateTripCoverInput!) { updateTripCover(tripId: $tripId, input: $input) { ${TRIP_FIELDS} } }`;

const ADD_ITEM = `mutation($tripId: ID!, $input: AddItemInput!) { addItem(tripId: $tripId, input: $input) { ${ITEM_FIELDS} } }`;
const UPDATE_ITEM = `mutation($tripId: ID!, $itemId: ID!, $input: UpdateItemInput!) { updateItem(tripId: $tripId, itemId: $itemId, input: $input) { ${ITEM_FIELDS} } }`;
const SET_ITEM_COST = `mutation($tripId: ID!, $itemId: ID!, $cost: Float!) { setItemCost(tripId: $tripId, itemId: $itemId, cost: $cost) { ${ITEM_FIELDS} } }`;
const SET_ITEM_REMINDER = `mutation($itemId: ID!, $enabled: Boolean!) { setItemReminder(itemId: $itemId, enabled: $enabled) { ${ITEM_FIELDS} } }`;
const MOVE_ITEM = `mutation($tripId: ID!, $itemId: ID!, $day: AWSDate!, $order: Int!) { moveItem(tripId: $tripId, itemId: $itemId, day: $day, order: $order) { ${ITEM_FIELDS} } }`;
const REMOVE_ITEM = `mutation($tripId: ID!, $itemId: ID!) { removeItem(tripId: $tripId, itemId: $itemId) { ${ITEM_FIELDS} } }`;

const TOUCH_PRESENCE = `mutation($input: PresenceInput!) { touchPresence(input: $input) { userId tripId displayName color editingItemId lastSeen } }`;
const REQUEST_SUGGESTIONS = `mutation($tripId: ID!, $day: AWSDate!) { requestSuggestions(tripId: $tripId, day: $day) { day items { title category cost rationale activityId } } }`;
const SUGGESTION_CHATS = `query($tripId: ID!, $day: String) { suggestionChats(tripId: $tripId, day: $day) { id tripId userId day messages { role content } } }`;
const GET_MY_INTERESTS = `query { getMyInterests }`;
const SET_MY_INTERESTS = `mutation($terms: [String!]!) { setMyInterests(terms: $terms) }`;
const LLM_SETTINGS_FIELDS = `provider model baseUrl hasKey demo`;
const GET_LLM_SETTINGS = `query { getLlmSettings { ${LLM_SETTINGS_FIELDS} } }`;
const UPDATE_LLM_SETTINGS = `mutation($input: UpdateLlmSettingsInput!) { updateLlmSettings(input: $input) { ${LLM_SETTINGS_FIELDS} } }`;
const EMAIL_SETTINGS_FIELDS = `provider from replyTo hasKey ready`;
const GET_EMAIL_SETTINGS = `query { getEmailSettings { ${EMAIL_SETTINGS_FIELDS} } }`;
const UPDATE_EMAIL_SETTINGS = `mutation($input: UpdateEmailSettingsInput!) { updateEmailSettings(input: $input) { ${EMAIL_SETTINGS_FIELDS} } }`;

// Endpoint determinista del agente (sin LLM): puntúa los lugares del destino
// contra los intereses del usuario. Va por el proxy /api/agent/* igual que el
// chat de sugerencias y usa las MISMAS cabeceras de auth.
const AUTO_SUGGEST_ENDPOINT = '/api/agent/auto-suggest';
const AUTO_SUGGEST_TIMEOUT_MS = 45_000;

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

// ---------------------------------------------------------------------------
// Implementación de la fachada
// ---------------------------------------------------------------------------

function persistSession(profile: UserProfile): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(SESSION_KEY, JSON.stringify(profile));
  }
}

export const api: TriplannerApi = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getVersion: () => version,

  notify,

  async setSessionProfile(profile: UserProfile): Promise<void> {
    currentUser = profile;
    persistSession(profile);
    notify();
  },

  async loginDemo(userId: string = DEMO_USER_ID): Promise<UserProfile> {
    const identity = DEMO_IDENTITIES[userId] ?? DEMO_IDENTITIES[DEMO_USER_ID];
    const fallback: UserProfile = {
      userId,
      email: identity.email,
      displayName: identity.displayName,
      language: 'en',
    };
    let profile: UserProfile | null = null;
    try {
      const data = await gql<{ findUserByEmail: UserProfile | null }>(FIND_USER_BY_EMAIL, {
        email: identity.email,
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

  // ---- Invitaciones locales (link copiable, sin email) ----

  async sendTripInvite(tripId: string, email: string, role: 'viewer' | 'editor' = 'viewer'): Promise<InviteResult> {
    const data = await gql<{ sendTripInvite: InviteResult | null }>(
      SEND_TRIP_INVITE,
      { tripId, email, role }
    );
    if (!data.sendTripInvite) {
      throw new ApiError('No se pudo crear la invitación.', { code: 'INVITE_CREATE_FAILED' });
    }
    return data.sendTripInvite;
  },

  async getTripByCode(code: string): Promise<TripPreview | null> {
    const data = await gql<{ getTripByCode: TripPreview | null }>(GET_TRIP_BY_CODE, { code });
    return data.getTripByCode;
  },

  async joinTripWithCode(code: string, email: string): Promise<Trip> {
    const data = await gql<{ joinTripWithCode: Trip }>(JOIN_TRIP_WITH_CODE, { code, email });
    notify();
    return data.joinTripWithCode;
  },

  async getMyProfile(): Promise<UserProfile | null> {
    const data = await gql<{ getMyProfile: UserProfile | null }>(GET_MY_PROFILE);
    return data.getMyProfile;
  },

  async updateMyProfile(input: { displayName: string; avatarDataUrl?: string | null; avatarRemove?: boolean | null; language?: 'es' | 'en' | null }): Promise<UserProfile> {
    const data = await gql<{ updateMyProfile: UserProfile }>(UPDATE_MY_PROFILE, { input });
    return data.updateMyProfile;
  },

  async addItemAttachment(
    tripId: string,
    itemId: string,
    input: { fileName: string; mimeType: string; dataUrl: string },
    viewerIds: string[]
  ): Promise<Attachment> {
    const data = await gql<{ addItemAttachment: Attachment }>(ADD_ITEM_ATTACHMENT, {
      tripId,
      itemId,
      input,
      viewerIds,
    });
    notify();
    return data.addItemAttachment;
  },

  async updateAttachmentViewers(attachmentId: string, viewerIds: string[]): Promise<Attachment> {
    const data = await gql<{ updateAttachmentViewers: Attachment }>(UPDATE_ATTACHMENT_VIEWERS, {
      attachmentId,
      viewerIds,
    });
    notify();
    return data.updateAttachmentViewers;
  },

  async removeItemAttachment(attachmentId: string): Promise<void> {
    await gql<{ removeItemAttachment: { id: string } | null }>(REMOVE_ITEM_ATTACHMENT, { attachmentId });
    notify();
  },

  async favoriteLocation(locationId: string, favorite: boolean): Promise<{ locationId: string; favorite: boolean }> {
    const data = await gql<{ favoriteLocation: { locationId: string; favorite: boolean } }>(
      FAVORITE_LOCATION,
      { locationId, favorite }
    );
    return data.favoriteLocation;
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

  async leaveTrip(tripId: string, newOwnerId?: string): Promise<Trip> {
    const data = await gql<{ leaveTrip: Trip }>(LEAVE_TRIP, { tripId, newOwnerId });
    notify();
    return data.leaveTrip;
  },

  async deleteTrip(tripId: string): Promise<string> {
    const data = await gql<{ deleteTrip: string }>(DELETE_TRIP, { tripId });
    notify();
    return data.deleteTrip;
  },

  async updateTripCover(tripId: string, input: UpdateTripCoverInput): Promise<Trip> {
    const data = await gql<{ updateTripCover: Trip }>(UPDATE_TRIP_COVER, { tripId, input });
    notify();
    return data.updateTripCover;
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

  async setItemReminder(itemId: string, enabled: boolean): Promise<TripItem> {
    const data = await gql<{ setItemReminder: TripItem }>(SET_ITEM_REMINDER, { itemId, enabled });
    notify();
    return data.setItemReminder;
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

  async getSuggestionChats(tripId: string, day?: string): Promise<SuggestionChat[]> {
    const data = await gql<{ suggestionChats: SuggestionChat[] }>(SUGGESTION_CHATS, { tripId, day });
    return data.suggestionChats;
  },

  async getMyInterests(): Promise<string[]> {
    const data = await gql<{ getMyInterests: string[] }>(GET_MY_INTERESTS);
    return data.getMyInterests;
  },

  async setMyInterests(terms: string[]): Promise<string[]> {
    const data = await gql<{ setMyInterests: string[] }>(SET_MY_INTERESTS, { terms });
    return data.setMyInterests;
  },

  async getLlmSettings(): Promise<LlmSettings> {
    const data = await gql<{ getLlmSettings: LlmSettings }>(GET_LLM_SETTINGS);
    return data.getLlmSettings;
  },

  async updateLlmSettings(input: UpdateLlmSettingsInput): Promise<LlmSettings> {
    const data = await gql<{ updateLlmSettings: LlmSettings }>(UPDATE_LLM_SETTINGS, { input });
    return data.updateLlmSettings;
  },

  async getEmailSettings(): Promise<EmailSettings> {
    const data = await gql<{ getEmailSettings: EmailSettings }>(GET_EMAIL_SETTINGS);
    return data.getEmailSettings;
  },

  async updateEmailSettings(input: UpdateEmailSettingsInput): Promise<EmailSettings> {
    const data = await gql<{ updateEmailSettings: EmailSettings }>(UPDATE_EMAIL_SETTINGS, { input });
    return data.updateEmailSettings;
  },

  async autoSuggest(tripId: string, offset = 0, limit = 10): Promise<AutoSuggestResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AUTO_SUGGEST_TIMEOUT_MS);
    try {
      let res: Response;
      try {
        res = await fetch(AUTO_SUGGEST_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(await getAuthHeaders()),
          },
          body: JSON.stringify({ tripId, offset, limit }),
          signal: controller.signal,
        });
      } catch {
        if (controller.signal.aborted) {
          throw new ApiError('El agente tardó demasiado en responder.', { code: 'AGENT_TIMEOUT' });
        }
        throw new ApiError('No se pudo conectar con el agente.', { code: 'AGENT_ERROR' });
      }

      const json = (await res.json().catch(() => null)) as
        | (Partial<AutoSuggestResult> & { error?: { code?: string; message?: string } })
        | null;

      if (res.ok && json && Array.isArray(json.items)) {
        return {
          items: json.items,
          hasMore: Boolean(json.hasMore),
          offset: typeof json.offset === 'number' ? json.offset : offset,
        };
      }

      throw new ApiError(json?.error?.message ?? 'El agente no pudo responder.', {
        code: json?.error?.code ?? 'AGENT_ERROR',
      });
    } finally {
      clearTimeout(timer);
    }
  },

  async touchPresence(input: PresenceInput): Promise<Presence> {
    const data = await gql<{ touchPresence: Presence }>(TOUCH_PRESENCE, { input });
    return data.touchPresence;
  },
};

export function subscribe(listener: () => void): () => void {
  return api.subscribe(listener);
}

export function getVersion(): number {
  return api.getVersion();
}
