// Port between the public GraphQL API and user persistence. The local adapter
// wraps the platform users table during the cutover; the remote adapter calls
// the users service. Resolvers only see this interface.

export type NotificationStatus = 'unread' | 'read' | 'accepted' | 'declined';

export interface UserRecord {
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

export interface NotificationRecord {
  id: string;
  user_id: string;
  type: string;
  trip_id: string;
  trip_name: string;
  invitation_id: string;
  inviter_user_id: string | null;
  role: string;
  status: NotificationStatus;
  created_at: string;
  read_at: string | null;
}

export interface CreateUserData {
  username: string;
  password: string;
  displayName: string;
  language?: string;
}

export interface UpdateUserData {
  displayName?: string;
  language?: string;
  avatarUrl?: string | null;
  color?: string | null;
}

export interface CreateNotificationData {
  userId: string;
  type: 'trip_invite';
  tripId: string;
  tripName: string;
  invitationId: string;
  inviterUserId: string;
  role: 'editor' | 'viewer';
}

export interface CreateNotificationResult {
  notification: NotificationRecord;
  created: boolean;
}

export interface UsersStore {
  /** Includes soft-deleted accounts for member/attachment enrichment. */
  getUser(id: string): Promise<UserRecord | null>;
  /** Active accounts only. */
  getByUsername(username: string): Promise<UserRecord | null>;
  /** Active accounts only; legacy demo emails resolve the agent identity. */
  getByEmail(email: string): Promise<UserRecord | null>;
  listUsers(query?: string): Promise<UserRecord[]>;
  batchUsers(ids: readonly string[]): Promise<UserRecord[]>;
  /** Throws INVALID_CREDENTIALS; never returns the hash. */
  login(username: string, password: string): Promise<UserRecord>;
  createUser(input: CreateUserData): Promise<UserRecord>;
  updateUser(id: string, patch: UpdateUserData): Promise<UserRecord>;
  deleteUser(id: string): Promise<void>;
  createNotification(input: CreateNotificationData): Promise<CreateNotificationResult>;
  listNotifications(userId: string, status?: NotificationStatus | null): Promise<NotificationRecord[]>;
  getNotification(userId: string, id: string): Promise<NotificationRecord>;
  updateNotification(
    userId: string,
    id: string,
    status: 'read' | 'accepted' | 'declined',
  ): Promise<NotificationRecord>;
  /** Private favorites; location IDs are opaque catalogue references. */
  listFavoriteIds(userId: string): Promise<Set<string>>;
  setFavorite(userId: string, locationId: string, favorite: boolean): Promise<boolean>;
}
