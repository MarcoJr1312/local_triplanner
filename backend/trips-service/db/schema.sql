-- Trips service schema. Owned exclusively by backend/trips-service.
--
-- Ownership rules:
--   * No foreign keys to the platform `users` table. user_id / owner_id /
--     created_by are opaque ids resolved by the API.
--   * No cross-store reads. The platform database keeps users, attachments,
--     presence, chats and favorites.
--   * Invitations and outbox rows are written together; the relay publishes.
--
-- Idempotent: safe to re-run. The runner records applied versions in
-- schema_migrations under pg_advisory_xact_lock.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    integer PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trips (
  id               text PRIMARY KEY,
  name             text NOT NULL,
  destination_id   text,
  destination_name text,
  destination_lat  double precision,
  destination_lng  double precision,
  start_date       text NOT NULL,
  end_date         text NOT NULL,
  total_budget     double precision NOT NULL DEFAULT 0,
  cover_preset     text,
  cover_photo_url  text,
  timezone         text NOT NULL DEFAULT 'UTC',
  owner_id         text NOT NULL,
  invite_code      text NOT NULL UNIQUE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trips_owner ON trips(owner_id);

CREATE TABLE IF NOT EXISTS trip_members (
  trip_id       text NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id       text NOT NULL,
  role          text NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  joined_at     timestamptz NOT NULL DEFAULT now(),
  invited_email text,
  PRIMARY KEY (trip_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_trip_members_user ON trip_members(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_trip_members_one_owner
  ON trip_members(trip_id) WHERE role = 'owner';

CREATE TABLE IF NOT EXISTS trip_items (
  id               text PRIMARY KEY,
  trip_id          text NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  location_id      text,
  location_text    text,
  location_name    text,
  location_address text,
  lat              double precision,
  lng              double precision,
  title            text NOT NULL,
  category         text,
  cost             double precision NOT NULL DEFAULT 0,
  day              text NOT NULL,
  "order"          integer NOT NULL DEFAULT 0,
  start_time       text,
  notes            text,
  image_url        text,
  created_by       text,
  reminder_enabled integer NOT NULL DEFAULT 1,
  reminder_sent    integer NOT NULL DEFAULT 0,
  reminder_due_at  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trip_items_trip ON trip_items(trip_id);

CREATE TABLE IF NOT EXISTS invitations (
  id          text PRIMARY KEY,
  trip_id     text NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  email       text NOT NULL,
  code        text NOT NULL UNIQUE,
  role        text NOT NULL DEFAULT 'viewer' CHECK (role IN ('editor', 'viewer')),
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_invitations_trip ON invitations(trip_id);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(email);

-- Transactional outbox for email.invite.v1 and email.member.joined.v1.
CREATE TABLE IF NOT EXISTS outbox (
  id            text PRIMARY KEY,
  topic         text NOT NULL,
  event_key     text NOT NULL,
  payload       jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  published_at  timestamptz,
  broker_offset integer,
  attempts      integer NOT NULL DEFAULT 0,
  last_error    text
);

CREATE INDEX IF NOT EXISTS idx_outbox_pending
  ON outbox(created_at) WHERE published_at IS NULL;
