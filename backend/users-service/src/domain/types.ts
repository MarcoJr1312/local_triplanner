// Domain types shared by the users service store and HTTP layer.

export interface UserRow {
  id: string;
  username: string;
  email: string | null;
  password_hash: string;
  display_name: string;
  color: string | null;
  avatar_url: string | null;
  language: string;
  created_at: string;
  deleted_at: string | null;
}

/** Wire shape: never includes the password hash. */
export interface UserPublic {
  id: string;
  username: string;
  email: string | null;
  display_name: string;
  color: string | null;
  avatar_url: string | null;
  language: string;
  created_at: string;
  deleted_at: string | null;
}

export function toPublicUser(row: UserRow): UserPublic {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    display_name: row.display_name,
    color: row.color,
    avatar_url: row.avatar_url,
    language: row.language,
    created_at: row.created_at,
    deleted_at: row.deleted_at,
  };
}

// --------------------------------------------------------- favorites

export interface FavoriteRow {
  user_id: string;
  location_id: string;
  created_at: string;
}

export interface FavoritePublic {
  location_id: string;
  created_at: string;
}

export function toPublicFavorite(row: FavoriteRow): FavoritePublic {
  return { location_id: row.location_id, created_at: row.created_at };
}

// --------------------------------------------------------- notifications

export interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  trip_id: string;
  trip_name: string;
  invitation_id: string | null;
  inviter_user_id: string | null;
  role: string | null;
  item_id: string | null;
  item_title: string | null;
  start_at: string | null;
  lead_minutes: number | null;
  dedupe_key: string | null;
  status: string;
  created_at: string;
  read_at: string | null;
}

export type NotificationStatus = 'unread' | 'read' | 'accepted' | 'declined';

export interface NotificationJoinedRow extends NotificationRow {
  inviter_id: string | null;
  inviter_username: string | null;
  inviter_email: string | null;
  inviter_display_name: string | null;
  inviter_color: string | null;
  inviter_avatar_url: string | null;
  inviter_language: string | null;
  inviter_created_at: string | null;
  inviter_deleted_at: string | null;
}

/** Wire shape for the notification inbox. */
export interface NotificationPublic {
  id: string;
  type: string;
  trip_id: string;
  trip_name: string;
  invitation_id: string | null;
  inviter_user_id: string | null;
  inviter: UserPublic | null;
  role: string | null;
  item_id: string | null;
  item_title: string | null;
  start_at: string | null;
  lead_minutes: number | null;
  status: string;
  created_at: string;
  read_at: string | null;
}

export function toPublicNotification(row: NotificationJoinedRow): NotificationPublic {
  const inviter: UserPublic | null =
    row.inviter_id && row.inviter_username && row.inviter_display_name
      ? {
          id: row.inviter_id,
          username: row.inviter_username,
          email: row.inviter_email,
          display_name: row.inviter_display_name,
          color: row.inviter_color,
          avatar_url: row.inviter_avatar_url,
          language: row.inviter_language ?? 'en',
          created_at: row.inviter_created_at ?? '',
          deleted_at: row.inviter_deleted_at,
        }
      : null;

  return {
    id: row.id,
    type: row.type,
    trip_id: row.trip_id,
    trip_name: row.trip_name,
    invitation_id: row.invitation_id,
    inviter_user_id: row.inviter_user_id,
    inviter,
    role: row.role,
    item_id: row.item_id,
    item_title: row.item_title,
    start_at: row.start_at,
    lead_minutes: row.lead_minutes,
    status: row.status,
    created_at: row.created_at,
    read_at: row.read_at,
  };
}
