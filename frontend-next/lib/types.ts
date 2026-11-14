export type AWSDate = string;
export type AWSDateTime = string;
export type ID = string;

export type MemberRole = 'owner' | 'editor' | 'viewer';

export interface UserProfile {
  userId: string;
  email: string;
  displayName: string;
  color?: string | null;
  avatarUrl?: string | null;
  language?: 'es' | 'en' | null;
}

export interface Member {
  userId: string;
  displayName: string;
  email: string;
  role: MemberRole;
  joinedAt?: string | null;
  color?: string | null;
  avatarUrl?: string | null;
}

export interface TripItem {
  id: ID;
  day: AWSDate;
  order: number;
  activityId?: string | null;
  title: string;
  category: string;
  cost: number;
  startTime?: string | null;
  notes?: string | null;
  imageUrl?: string | null;
  addedBy?: string | null;
  attachments?: Attachment[];
  isFavorite?: boolean;
  lat?: number | null;
  lng?: number | null;
  locationText?: string | null;
  reminderEnabled?: number;
}

export type AttachmentVisibility = 'private' | 'shared' | 'legacy';

export interface Attachment {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  createdAt?: string;
  uploadedByName?: string | null;
  viewerIds?: string[] | null;
  visibility?: AttachmentVisibility;
  createdBy?: string | null;
}

export interface CategorySpend {
  category: string;
  amount: number;
}

export interface Trip {
  id: ID;
  name: string;
  destinationId: string;
  destinationName: string;
  destinationLat?: number | null;
  destinationLng?: number | null;
  coverPreset?: string | null;
  coverPhotoUrl?: string | null;
  startDate: AWSDate;
  endDate: AWSDate;
  timezone?: string;
  totalBudget: number;
  spent: number;
  spentByCategory: CategorySpend[];
  ownerId: string;
  inviteCode: string;
  members: Member[];
  items: TripItem[];
  myRole: MemberRole;
  createdAt: AWSDateTime;
  updatedAt: AWSDateTime;
}

export interface TripSummary {
  tripId: ID;
  tripName: string;
  destinationName: string;
  startDate: AWSDate;
  endDate: AWSDate;
  role: MemberRole;
  joinedAt: AWSDateTime;
}

export interface Destination {
  slug: ID;
  name: string;
  country: string;
  description: string;
  imageUrl: string | null;
  lat: number;
  lng: number;
}

export interface Activity {
  id: ID;
  name: string;
  category: string;
  cost: number;
  lat?: number | null;
  lng?: number | null;
  description?: string;
  tags: string[];
  durationHours?: number | null;
  imageUrl?: string | null;
  rating?: number | null;
  isFavorite?: boolean;
}

export interface Location {
  id: ID;
  name: string;
  category: string;
  rawType?: string | null;
  description?: string | null;
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
  rating?: number | null;
  ratingCount?: number | null;
  phone?: string | null;
  priceLevel?: string | number | null;
  websiteUrl?: string | null;
  imageUrl?: string | null;
  cost?: number | null;
  durationHours?: number | null;
  tags?: string[];
  hours?: unknown | null;
  socialLinks?: unknown | null;
  source?: string | null;
  placeId?: string | null;
  isFavorite?: boolean;
}

export interface Presence {
  userId: ID;
  tripId: ID;
  displayName: string;
  color: string;
  editingItemId: string | null;
  lastSeen: AWSDateTime;
}

// Evento emitido por la subscription onTripChanged (SSE). `entity` es un
// AWSJSON: el backend lo serializa con JSON.stringify, por eso llega como string.
export interface TripEvent {
  tripId: ID;
  mutationType: string;
  entity: string;
  actorId: string;
}

export interface Suggestion {
  title: string;
  category: string;
  cost: number;
  rationale: string;
  activityId: string | null;
}

export interface SuggestionSet {
  day: AWSDate;
  items: Suggestion[];
}

export interface SuggestionChatMessage {
  role: string;
  content: string;
}

export interface SuggestionChat {
  id: ID;
  tripId: ID;
  userId: ID;
  day: string;
  messages: SuggestionChatMessage[];
}

// Sugerencia automática (endpoint del agente): lugar del destino puntuado
// contra los intereses del usuario. `score` es 0..100.
export interface AutoSuggestItem {
  placeId: string;
  title: string;
  category: string;
  cost: number | null;
  score: number;
}

export interface AutoSuggestResult {
  items: AutoSuggestItem[];
  hasMore: boolean;
  offset: number;
}

export interface CreateTripInput {
  name: string;
  destinationId: string;
  destinationName: string;
  startDate: AWSDate;
  endDate: AWSDate;
  timezone?: string;
  totalBudget: number;
  displayName: string;
}

export interface UpdateTripSettingsInput {
  name?: string;
  startDate?: AWSDate;
  endDate?: AWSDate;
  destinationId?: string;
  destinationName?: string;
}

export interface UpdateTripCoverInput {
  coverPreset?: string | null;
  coverPhotoDataUrl?: string | null;
  removePhoto?: boolean | null;
}

export interface AddItemInput {
  day: AWSDate;
  order: number;
  activityId?: string | null;
  title: string;
  category: string;
  cost: number;
  startTime?: string | null;
  notes?: string | null;
  imageUrl?: string | null;
  locationText?: string | null;
}

export interface UpdateItemInput {
  day?: AWSDate;
  order?: number;
  startTime?: string | null;
  notes?: string | null;
  title?: string;
  locationText?: string | null;
}

export interface PresenceInput {
  tripId: ID;
  displayName: string;
  color: string;
  editingItemId?: string | null;
}

export interface InviteMemberArgs {
  userId?: string;
  email: string;
  displayName: string;
  role: MemberRole;
}

export interface TriplannerApi {
  loginDemo(userId?: string): Promise<UserProfile>;
  logout(): Promise<void>;
  restoreSession(): Promise<UserProfile | null>;
  getCurrentUser(): UserProfile | null;
  setSessionProfile(profile: UserProfile): Promise<void>;
  findUserByEmail(email: string): Promise<UserProfile | null>;

  listMyTrips(): Promise<TripSummary[]>;
  getTrip(id: ID): Promise<Trip | null>;
  listDestinations(): Promise<Destination[]>;
  listActivities(destSlug: string, category?: string): Promise<Activity[]>;
  listPresence(tripId: ID): Promise<Presence[]>;

  createTrip(input: CreateTripInput): Promise<Trip>;
  updateTripSettings(id: ID, input: UpdateTripSettingsInput): Promise<Trip>;
  setBudget(tripId: ID, totalBudget: number): Promise<Trip>;
  inviteMember(tripId: ID, args: InviteMemberArgs): Promise<Trip>;
  updateMemberRole(tripId: ID, userId: ID, role: MemberRole): Promise<Trip>;
  removeMember(tripId: ID, userId: ID): Promise<Trip>;
  leaveTrip(tripId: ID, newOwnerId?: ID): Promise<Trip>;
  deleteTrip(tripId: ID): Promise<ID>;
  updateTripCover(tripId: ID, input: UpdateTripCoverInput): Promise<Trip>;

  sendTripInvite(tripId: ID, email: string, role?: 'viewer' | 'editor'): Promise<InviteResult>;
  getTripByCode(code: string): Promise<TripPreview | null>;
  joinTripWithCode(code: string, email: string): Promise<Trip>;
  getMyProfile(): Promise<UserProfile | null>;
  updateMyProfile(input: UpdateMyProfileInput): Promise<UserProfile>;
  addItemAttachment(tripId: ID, itemId: ID, input: AddItemAttachmentInput, viewerIds: ID[]): Promise<Attachment>;
  updateAttachmentViewers(attachmentId: ID, viewerIds: ID[]): Promise<Attachment>;
  removeItemAttachment(attachmentId: ID): Promise<void>;
  favoriteLocation(locationId: ID, favorite: boolean): Promise<{ locationId: string; favorite: boolean }>;

  addItem(tripId: ID, input: AddItemInput): Promise<TripItem>;
  updateItem(tripId: ID, itemId: ID, input: UpdateItemInput): Promise<TripItem>;
  setItemCost(tripId: ID, itemId: ID, cost: number): Promise<TripItem>;
  setItemReminder(itemId: ID, enabled: boolean): Promise<TripItem>;
  moveItem(tripId: ID, itemId: ID, day: AWSDate, order: number): Promise<TripItem>;
  removeItem(tripId: ID, itemId: ID): Promise<TripItem>;

  requestSuggestions(tripId: ID, day: AWSDate): Promise<SuggestionSet>;
  getSuggestionChats(tripId: ID, day?: string): Promise<SuggestionChat[]>;
  getMyInterests(): Promise<string[]>;
  setMyInterests(terms: string[]): Promise<string[]>;
  getLlmSettings(): Promise<LlmSettings>;
  updateLlmSettings(input: UpdateLlmSettingsInput): Promise<LlmSettings>;
  autoSuggest(tripId: ID, offset?: number, limit?: number): Promise<AutoSuggestResult>;
  touchPresence(input: PresenceInput): Promise<Presence>;

  subscribe(listener: () => void): () => void;
  getVersion(): number;
  notify(): void;
}

export interface InviteResult {
  invitationId: string;
  status: string;
  email: string;
  code: string;
  joinUrl: string;
}

export interface UpdateMyProfileInput {
  displayName: string;
  avatarDataUrl?: string | null;
  avatarRemove?: boolean | null;
  language?: 'es' | 'en' | null;
}

export interface LlmSettings {
  provider: string;
  model: string;
  baseUrl: string;
  hasKey: boolean;
  demo: boolean;
}

export interface UpdateLlmSettingsInput {
  provider: string;
  apiKey?: string | null;
  model?: string | null;
  baseUrl?: string | null;
  clearKey?: boolean | null;
}

export interface AddItemAttachmentInput {
  fileName: string;
  mimeType: string;
  dataUrl: string;
}

export interface TripPreview {
  id: string;
  name: string;
  destinationName: string | null;
  ownerName: string | null;
  invitedEmail: string;
}
