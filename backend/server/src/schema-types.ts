// Tipos del dominio de Triplanner, reflejando backend/graphql/schema.graphql
// + las extensiones locales (searchLocations, locationDetails, locationById).
// Se mantienen alineados a mano con el schema (fuente: backend/graphql/schema.graphql).

// The server runs on Postgres now; `Db` is the async handle from src/pg/db.ts.
export type { AsyncDb as Db } from './pg/db.ts';

// ---- Filas de SQLite (nombres snake_case de la tabla) ----

export interface UserRow {
  id: string;
  username?: string | null;
  email: string | null;
  password_hash?: string | null;
  display_name: string;
  color: string | null;
  avatar_url: string | null;
  language: string;
  created_at: string;
  deleted_at?: string | null;
}

export interface LocationRow {
  id: string;
  source: string | null;
  place_id: string | null;
  data_id: string | null;
  slug: string | null;
  name: string;
  category: string | null;
  raw_type: string | null;
  country: string | null;
  description: string | null;
  lat: number | null;
  lng: number | null;
  address: string | null;
  rating: number | null;
  rating_count: number | null;
  hours_json: string | null;
  website_url: string | null;
  social_links_json: string | null;
  phone: string | null;
  price_level: number | null;
  image_url: string | null;
  cost: number | null;
  tags_json: string | null;
  duration_hours: number | null;
  parent_id: string | null;
  last_updated: string | null;
  created_at?: string | null;
  expires_at?: number | null;
}

export interface InvitationRow {
  id: string;
  trip_id: string;
  email: string;
  code: string;
  role: 'owner' | 'editor' | 'viewer';
  status: 'pending' | 'accepted' | 'revoked';
  created_by: string;
  created_at: string;
  accepted_at: string | null;
}

// ---- Tipos GraphQL (camelCase, lo que devuelven los resolvers) ----

export interface Profile {
  userId: string;
  email: string;
  displayName: string;
  color?: string | null;
  avatarUrl?: string | null;
  language?: string | null;
}

export interface Destination {
  slug: string;
  name: string;
  country: string;
  description: string | null;
  imageUrl: string | null;
  lat: number | null;
  lng: number | null;
  activities: unknown[];
}

export interface TripItem {
  id: string;
  tripId: string;
  title: string;
  category: string;
  startTime: string | null;
  endTime: string | null;
  locationId: string | null;
  locationName: string | null;
  locationAddress: string | null;
  cost: number | null;
  notes: string | null;
  dayNumber: number | null;
  reminderEnabled?: number;
  createdAt: string;
}

export interface TripMember {
  userId: string;
  displayName: string | null;
  email: string | null;
  invitedEmail: string | null;
  role: string;
}

export interface TripStats {
  days: number;
  itemsCount: number;
  spent: number;
  remaining: number;
}

export interface Trip {
  id: string;
  name: string;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  coverImageUrl: string | null;
  createdAt: string;
  updatedAt: string;
  ownerId: string;
  status: string;
  currency: string;
  destinationId: string | null;
  totalBudget: number | null;
  timezone: string;
  destination: Destination | null;
  members: TripMember[];
  items: TripItem[];
  stats: TripStats;
}

// ---- Ubicaciones (categoria mapeada a sight/food/activity/nightlife) ----

export interface HoursDay {
  day: string;
  time: string;
}

export interface HoursFormat {
  timezone?: string | null;
  days?: HoursDay[] | null;
}

export interface SocialLink {
  platform: string;
  url: string;
}

export interface Location {
  id: string;
  name: string;
  category: string | null;
  rawType: string | null;
  description: string | null;
  lat: number | null;
  lng: number | null;
  address: string | null;
  rating: number | null;
  ratingCount: number | null;
  phone: string | null;
  priceLevel: string | number | null;
  websiteUrl: string | null;
  imageUrl: string | null;
  cost: number | null;
  durationHours: number | null;
  tags: unknown[];
  hours: HoursFormat | null;
  socialLinks: SocialLink[] | null;
  source: string | null;
  placeId: string | null;
  isFavorite?: boolean;
}

export interface LocationDetails extends Location {
  details?: Record<string, unknown>;
  reviews?: unknown[];
}

export interface Suggestion {
  id: string;
  title: string;
  category: string;
  reason: string;
  priceLevel: number | null;
}

export interface BudgetCategory {
  category: string;
  spent: number;
  limit: number | null;
}

export interface BudgetSummary {
  categories: BudgetCategory[];
}

// ---- Args de operaciones ----

export interface SearchLocationsArgs {
  q: string;
  lat?: number | null;
  lng?: number | null;
}

export interface LocationByIdArgs {
  id: string;
}

export interface LocationDetailsArgs {
  placeId?: string | null;
  dataId?: string | null;
  id?: string | null;
}

export interface RequestSuggestionsArgs {
  tripId: string;
  count?: number | null;
}

export interface CreateTripArgs {
  name: string;
  destinationId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  description?: string | null;
  currency?: string | null;
  totalBudget?: number | null;
  timezone?: string | null;
}

export interface UpsertLocationInput {
  id: string;
  source?: string | null;
  place_id?: string | null;
  data_id?: string | null;
  slug?: string | null;
  name: string;
  category?: string | null;
  raw_type?: string | null;
  country?: string | null;
  description?: string | null;
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
  rating?: number | null;
  rating_count?: number | null;
  hours_json?: string | null;
  website_url?: string | null;
  social_links_json?: string | null;
  phone?: string | null;
  price_level?: string | number | null;
  image_url?: string | null;
  cost?: number | null;
  tags_json?: string | null;
  duration_hours?: number | null;
  parent_id?: string | null;
  last_updated?: string | null;
}
