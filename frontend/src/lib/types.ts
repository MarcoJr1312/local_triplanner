export type AWSDate = string;
export type AWSDateTime = string;
export type ID = string;

export type MemberRole = 'owner' | 'editor' | 'viewer';

export interface UserProfile {
  userId: ID;
  email: string;
  displayName: string;
}

export interface Member {
  userId: ID;
  displayName: string;
  email: string;
  role: MemberRole;
  joinedAt: AWSDateTime;
}

export interface TripItem {
  id: ID;
  day: AWSDate;
  order: number;
  activityId: string | null;
  title: string;
  category: string;
  cost: number;
  startTime: string | null;
  notes: string | null;
  imageUrl: string | null;
  addedBy: string;
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
  startDate: AWSDate;
  endDate: AWSDate;
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
  lat: number;
  lng: number;
  description: string;
  tags: string[];
  durationHours: number | null;
  imageUrl: string | null;
  rating: number | null;
}

export interface Location {
  id: ID;
  name: string;
  category: string;
  rawType: string | null;
  description: string | null;
  lat: number;
  lng: number;
  address: string | null;
  rating: number | null;
  ratingCount: number | null;
  phone: string | null;
  priceLevel: string | null;
  websiteUrl: string | null;
  imageUrl: string | null;
  cost: number | null;
  durationHours: number | null;
  tags: string[];
  hours: unknown | null;
  socialLinks: unknown | null;
  source: string;
  placeId: string | null;
}

export interface Presence {
  userId: ID;
  tripId: ID;
  displayName: string;
  color: string;
  editingItemId: string | null;
  lastSeen: AWSDateTime;
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

export interface TripEvent {
  tripId: ID;
  mutationType: string;
  entity: string;
  actorId: string;
}

export interface CreateTripInput {
  name: string;
  destinationId: string;
  destinationName: string;
  startDate: AWSDate;
  endDate: AWSDate;
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
}

export interface UpdateItemInput {
  day?: AWSDate;
  order?: number;
  startTime?: string | null;
  notes?: string | null;
  title?: string;
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
  loginDemo(): Promise<UserProfile>;
  logout(): Promise<void>;
  restoreSession(): Promise<UserProfile | null>;
  getCurrentUser(): UserProfile | null;
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
  leaveTrip(tripId: ID): Promise<Trip>;

  addItem(tripId: ID, input: AddItemInput): Promise<TripItem>;
  updateItem(tripId: ID, itemId: ID, input: UpdateItemInput): Promise<TripItem>;
  setItemCost(tripId: ID, itemId: ID, cost: number): Promise<TripItem>;
  moveItem(tripId: ID, itemId: ID, day: AWSDate, order: number): Promise<TripItem>;
  removeItem(tripId: ID, itemId: ID): Promise<TripItem>;

  requestSuggestions(tripId: ID, day: AWSDate): Promise<SuggestionSet>;
  touchPresence(input: PresenceInput): Promise<Presence>;

  subscribe(listener: () => void): () => void;
  getVersion(): number;
}
