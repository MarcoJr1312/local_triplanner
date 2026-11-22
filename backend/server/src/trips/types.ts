// Port between the public GraphQL API and trip persistence. The local adapter
// wraps the existing Postgres functions during the cutover; the remote adapter
// calls the trips service. Resolvers only see this interface.

import type { InvitationRow } from '../schema-types.ts';
import type { TripItemRow, TripMemberRow, TripRowFull } from '../pg/trips.ts';

export type TripRole = 'owner' | 'editor' | 'viewer';
export type InviteRole = 'editor' | 'viewer';

export interface TripData {
  trip: TripRowFull;
  members: TripMemberRow[];
  items: TripItemRow[];
  myRole: TripRole;
  spent: number;
  spentByCategory: { category: string; amount: number }[];
}

export interface TripSummaryData {
  id: string;
  name: string;
  destination_name: string | null;
  start_date: string;
  end_date: string;
  role: TripRole;
  joined_at: string;
}

export interface CreateTripInput {
  name: string;
  destinationId?: string | null;
  destinationName?: string | null;
  destinationLat?: number | null;
  destinationLng?: number | null;
  startDate: string;
  endDate: string;
  totalBudget?: number | null;
  timezone?: string | null;
}

export interface UpdateTripInput {
  name?: string;
  startDate?: string;
  endDate?: string;
  destinationId?: string | null;
  destinationName?: string | null;
  destinationLat?: number | null;
  destinationLng?: number | null;
  totalBudget?: number;
  coverPreset?: string | null;
  coverPhotoUrl?: string | null;
  removePhoto?: boolean;
}

export interface AddItemInput {
  locationId?: string | null;
  locationText?: string | null;
  locationName?: string | null;
  locationAddress?: string | null;
  lat?: number | null;
  lng?: number | null;
  title: string;
  category: string;
  cost?: number | null;
  day: string;
  order?: number | null;
  startTime?: string | null;
  notes?: string | null;
  imageUrl?: string | null;
}

export interface UpdateItemInput {
  day?: string;
  order?: number;
  startTime?: string | null;
  notes?: string | null;
  title?: string;
  locationText?: string | null;
  cost?: number;
}

export interface InviteNotifyInput {
  inviterName: string;
  language: 'es' | 'en';
  appUrl: string;
  demo: boolean;
}

export interface CreateInvitationInput {
  email: string;
  role: InviteRole;
  notify?: InviteNotifyInput;
}

export interface InvitationResult {
  invitation: InvitationRow;
  emailQueued: boolean;
}

export interface TripPreviewData {
  invitation: InvitationRow;
  trip: {
    id: string;
    name: string;
    destination_name: string | null;
    owner_id: string;
  };
}

export interface JoinNotifyInput {
  ownerEmail: string;
  ownerName: string;
  memberName: string;
  language: 'es' | 'en';
}

export interface JoinInput {
  userId: string;
  email: string;
  code: string;
  notify?: JoinNotifyInput;
}

export interface JoinResult {
  joined: boolean;
  data: TripData;
  memberEmailQueued: boolean;
  reason?: 'ALREADY_MEMBER';
}

export interface TripsStore {
  listMyTrips(userId: string): Promise<TripSummaryData[]>;
  getTrip(userId: string, tripId: string): Promise<TripData>;
  createTrip(userId: string, input: CreateTripInput): Promise<TripData>;
  updateTrip(userId: string, tripId: string, input: UpdateTripInput): Promise<TripData>;
  deleteTrip(userId: string, tripId: string): Promise<void>;

  inviteMember(
    userId: string,
    tripId: string,
    targetUserId: string,
    role: InviteRole,
  ): Promise<TripData>;
  updateMemberRole(
    userId: string,
    tripId: string,
    targetUserId: string,
    role: InviteRole,
  ): Promise<TripData>;
  removeMember(userId: string, tripId: string, targetUserId: string): Promise<TripData>;
  leaveTrip(userId: string, tripId: string, newOwnerId?: string | null): Promise<TripData>;
  getMemberRole(userId: string, tripId: string): Promise<TripRole | null>;
  isMember(userId: string, tripId: string): Promise<boolean>;
  assertMember(userId: string, tripId: string): Promise<void>;
  listMemberIds(userId: string, tripId: string): Promise<string[]>;

  addItem(userId: string, tripId: string, input: AddItemInput): Promise<TripItemRow>;
  updateItem(
    userId: string,
    tripId: string,
    itemId: string,
    input: UpdateItemInput,
  ): Promise<TripItemRow>;
  setItemCost(
    userId: string,
    tripId: string,
    itemId: string,
    cost: number,
  ): Promise<TripItemRow>;
  moveItem(
    userId: string,
    tripId: string,
    itemId: string,
    day: string,
    order: number,
  ): Promise<TripItemRow>;
  removeItem(userId: string, tripId: string, itemId: string): Promise<TripItemRow>;
  setItemReminder(
    userId: string,
    tripId: string,
    itemId: string,
    enabled: boolean,
  ): Promise<TripItemRow>;
  getItemForActor(
    userId: string,
    itemId: string,
  ): Promise<{ tripId: string; item: TripItemRow }>;

  previewInvitation(code: string): Promise<TripPreviewData>;
  createInvitation(
    userId: string,
    tripId: string,
    input: CreateInvitationInput,
  ): Promise<InvitationResult>;
  joinTrip(userId: string, tripId: string, input: JoinInput): Promise<JoinResult>;
}
