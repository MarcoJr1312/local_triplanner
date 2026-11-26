-- Users service schema. Owned exclusively by backend/users-service.
--
-- Ownership rules:
--   * No foreign keys to the platform or trips databases. trip_id /
--     invitation_id in notifications are opaque references resolved by the API.
--   * The service never reads another store; the API composes trips + users.
--   * Passwords are Argon2id hashes; plain text is never stored.
--
-- Idempotent: safe to re-run. The runner records applied versions in
-- schema_migrations under pg_advisory_xact_lock.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    integer PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

-- ============================= USERS =============================
-- Usernames are lowercase and unique among active accounts. Soft-deleted
-- accounts keep their rows (and memberships elsewhere) but free the username.
CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY,
  username      text NOT NULL CHECK (username = lower(username)),
  email         text,
  password_hash text NOT NULL,
  display_name  text NOT NULL,
  color         text,
  avatar_url    text,
  language      text NOT NULL DEFAULT 'en' CHECK (language IN ('es', 'en')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower
  ON users (lower(username)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower
  ON users (lower(email)) WHERE email IS NOT NULL AND deleted_at IS NULL;

-- ========================== FAVORITE PLACES ======================
-- Private per-user favorites. location_id is an opaque reference to the
-- locations service catalogue: no foreign key and no catalogue validation.
CREATE TABLE IF NOT EXISTS favorite_locations (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  location_id text NOT NULL CHECK (length(location_id) BETWEEN 1 AND 128),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, location_id)
);

CREATE INDEX IF NOT EXISTS idx_favorite_locations_user
  ON favorite_locations(user_id, created_at DESC);

-- ========================== NOTIFICATIONS ========================
-- Local trip invites. There is no outbox: the API publishes onNotification
-- after this row is created and no email is ever sent.
CREATE TABLE IF NOT EXISTS notifications (
  id              uuid PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            text NOT NULL CHECK (type IN ('trip_invite', 'activity_reminder')),
  trip_id         text NOT NULL,
  trip_name       text NOT NULL,
  invitation_id   text,
  inviter_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  role            text CHECK (role IN ('editor', 'viewer')),
  item_id         text,
  item_title      text,
  start_at        timestamptz,
  lead_minutes    integer,
  dedupe_key      text,
  status          text NOT NULL DEFAULT 'unread'
                    CHECK (status IN ('unread', 'read', 'accepted', 'declined')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  read_at         timestamptz
);

-- Existing v2 databases: make invite-only columns optional and add reminder
-- fields. Every statement is idempotent and runs when schema v3 is applied.
ALTER TABLE notifications ALTER COLUMN invitation_id DROP NOT NULL;
ALTER TABLE notifications ALTER COLUMN role DROP NOT NULL;
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('trip_invite', 'activity_reminder'));
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS item_id text;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS item_title text;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS start_at timestamptz;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS lead_minutes integer;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS dedupe_key text;

CREATE INDEX IF NOT EXISTS idx_notifications_user
  ON notifications(user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_invitation
  ON notifications(user_id, invitation_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe
  ON notifications(user_id, dedupe_key);
