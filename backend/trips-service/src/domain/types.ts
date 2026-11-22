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
