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
