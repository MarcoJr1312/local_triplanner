// Port between the public GraphQL API and trip persistence. The local adapter
// wraps the existing Postgres functions during the cutover; the remote adapter
// calls the trips service. Resolvers only see this interface.

import type { InvitationRow } from '../schema-types.ts';

export type TripRole = 'owner' | 'editor' | 'viewer';
export type InviteRole = 'editor' | 'viewer';

export interface TripRowFull {
  id: string;
  name: string;
  destination_id: string | null;
  destination_name: string | null;
  destination_lat: number | null;
  destination_lng: number | null;
  start_date: string | null;
  end_date: string | null;
  total_budget: number | null;
  cover_preset: string | null;
  cover_photo_url: string | null;
  timezone: string | null;
  owner_id: string;
  invite_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface TripMemberRow {
  user_id: string;
  role: string;
  joined_at: string | null;
  invited_email: string | null;
}

export interface TripItemRow {
  id: string;
  trip_id: string;
  day: string | null;
  order: number | null;
  location_id: string | null;
  location_text: string | null;
  location_name: string | null;
  location_address: string | null;
  lat: number | null;
  lng: number | null;
  title: string;
  category: string | null;
  cost: number | null;
  start_time: string | null;
  notes: string | null;
  image_url: string | null;
  created_by: string | null;
  created_at: string;
  reminder?: ItemReminder;
}

export interface ItemReminder {
  enabled: boolean;
  lead_minutes: number;
  recipient_ids: string[];
  can_edit: boolean;
}

export interface ItemReminderInput {
  enabled: boolean;
  leadMinutes?: number;
  recipientIds?: string[];
  startTime?: string | null;
}

export interface DueReminderData {
  item_id: string;
  trip_id: string;
  trip_name: string;
  item_title: string;
  day: string;
  start_at: string;
  due_at: string;
  lead_minutes: number;
  recipient_ids: string[];
}

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
    input: ItemReminderInput,
  ): Promise<TripItemRow>;
  getItemReminder(
    userId: string,
    tripId: string,
    itemId: string,
  ): Promise<ItemReminder>;
  dueReminders(now?: string): Promise<DueReminderData[]>;
  markRemindersSent(itemId: string, userIds: string[]): Promise<void>;
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
  /** Local channel: no email, no code, no outbox. */
  createLocalInvitation(
    userId: string,
    tripId: string,
    inviteeUserId: string,
    role: InviteRole,
  ): Promise<InvitationRow>;
  joinLocal(
    userId: string,
    tripId: string,
    invitationId: string,
  ): Promise<{ joined: boolean; data: TripData }>;
  declineLocalInvitation(
    userId: string,
    tripId: string,
    invitationId: string,
  ): Promise<InvitationRow>;
  /** Inviter/editor cancellation used for notification compensation. */
  revokeLocalInvitation(
    userId: string,
    tripId: string,
    invitationId: string,
  ): Promise<InvitationRow>;
  joinTrip(userId: string, tripId: string, input: JoinInput): Promise<JoinResult>;
}
