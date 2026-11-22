// Service DTOs. snake_case is deliberate: this is the storage/service contract,
// not the public GraphQL shape. The API adapter maps it to GraphQL camelCase.

export type Role = 'owner' | 'editor' | 'viewer';

export interface TripRow {
  id: string;
  name: string;
  destination_id: string | null;
  destination_name: string | null;
  destination_lat: number | null;
  destination_lng: number | null;
  start_date: string;
  end_date: string;
  total_budget: number;
  cover_preset: string | null;
  cover_photo_url: string | null;
  timezone: string;
  owner_id: string;
  invite_code: string;
  created_at: string;
  updated_at: string;
}

export interface TripMemberRow {
  user_id: string;
  role: Role;
  joined_at: string;
  invited_email: string | null;
}

export interface TripItemRow {
  id: string;
  trip_id: string;
  location_id: string | null;
  location_text: string | null;
  location_name: string | null;
  location_address: string | null;
  lat: number | null;
  lng: number | null;
  title: string;
  category: string | null;
  cost: number;
  day: string;
  order: number;
  start_time: string | null;
  notes: string | null;
  image_url: string | null;
  created_by: string | null;
  reminder_enabled: number;
  reminder_sent: number;
  reminder_due_at: string | null;
  created_at: string;
}

export interface TripSummaryRow {
  id: string;
  name: string;
  destination_name: string | null;
  start_date: string;
  end_date: string;
  role: Role;
  joined_at: string;
}

export interface CategorySpend {
  category: string;
  amount: number;
}

export interface TripAggregate extends TripRow {
  my_role: Role;
  members: TripMemberRow[];
  items: TripItemRow[];
  spent: number;
  spent_by_category: CategorySpend[];
}

export interface TripWriteResult extends TripAggregate {
  place_resolved: boolean;
}

export interface ItemWriteResult extends TripItemRow {
  place_resolved: boolean;
}

export interface ContextDayItem {
  id: string;
  title: string;
  category: string;
  cost: number;
  day: string;
  start_time: string | null;
  location_id: string | null;
}

export interface ContextDay {
  date: string;
  items: ContextDayItem[];
}

export interface TripContext {
  trip: {
    id: string;
    name: string;
    destination_id: string | null;
    destination_name: string | null;
    destination_lat: number | null;
    destination_lng: number | null;
    start_date: string;
    end_date: string;
    total_budget: number;
    spent: number;
  };
  days: ContextDay[];
  members: { user_id: string; role: Role }[];
  my_role: Role;
}

export type InvitationRole = 'editor' | 'viewer';
export type InvitationStatus = 'pending' | 'accepted' | 'declined' | 'revoked';
export type InvitationChannel = 'email' | 'local';

export interface InvitationRow {
  id: string;
  trip_id: string;
  email: string | null;
  code: string | null;
  role: InvitationRole;
  status: InvitationStatus;
  created_by: string;
  created_at: string;
  accepted_at: string | null;
  channel: InvitationChannel;
  invitee_user_id: string | null;
}

/** Email invitations always carry both fields (enforced by a DB check). */
export interface EmailInvitationRow extends InvitationRow {
  channel: 'email';
  email: string;
  code: string;
  invitee_user_id: null;
}

/** Local invitations carry the invitee instead of email/code. */
export interface LocalInvitationRow extends InvitationRow {
  channel: 'local';
  email: null;
  code: null;
  invitee_user_id: string;
}

export interface InvitationPreview {
  invitation: EmailInvitationRow;
  trip: {
    id: string;
    name: string;
    destination_name: string | null;
    owner_id: string;
  };
}

export interface EmailQueueStatus {
  queued: boolean;
  reason?: 'NO_NOTIFY' | 'ALREADY_MEMBER';
}

export interface InvitationResult {
  invitation: EmailInvitationRow;
  email: EmailQueueStatus;
}

export interface LocalInvitationResult {
  invitation: LocalInvitationRow;
  created: boolean;
}

export interface JoinResult {
  joined: boolean;
  trip: TripAggregate;
  member_email: EmailQueueStatus;
}

export interface LocalJoinResult {
  joined: boolean;
  trip: TripAggregate;
}

export interface OutboxRow {
  id: string;
  topic: string;
  event_key: string;
  payload: unknown;
  created_at: string;
  published_at: string | null;
  broker_offset: number | null;
  attempts: number;
  last_error: string | null;
}
