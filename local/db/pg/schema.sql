-- Triplanner Postgres schema (local + AWS RDS).
-- Canonical DDL for the relational store. Idempotent: re-runnable.
--
-- ARCHITECTURE (decided 2026-11-12):
--   * DynamoDB owns the `locations` catalogue (HasData results, TTL, source of truth).
--   * Postgres owns everything relational and keeps a denormalized snapshot of the
--     place fields it needs for reads (name/address/lat/lng on trips and items).
--   * No foreign keys point at locations; location_id columns are plain references.
--   * SQLite is no longer the local engine.

CREATE EXTENSION IF NOT EXISTS vector;

-- ============================= USERS =============================
CREATE TABLE IF NOT EXISTS users (
  id              text PRIMARY KEY,
  email           text NOT NULL UNIQUE,
  display_name    text NOT NULL,
  color           text,
  avatar_url      text,
  language        text NOT NULL DEFAULT 'es',
  firebase_uid    text,
  email_verified  integer NOT NULL DEFAULT 0,
  welcome_sent_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Two users never share a firebase_uid; partial so multiple NULLs are allowed.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_firebase_uid
  ON users(firebase_uid) WHERE firebase_uid IS NOT NULL;

-- ============================= TRIPS =============================
CREATE TABLE IF NOT EXISTS trips (
  id               text PRIMARY KEY,
  name             text NOT NULL,
  -- DynamoDB location id. No FK: the catalogue lives outside Postgres.
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
  owner_id         text NOT NULL REFERENCES users(id),
  invite_code      text NOT NULL UNIQUE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trips_owner ON trips(owner_id);

-- ========================== TRIP MEMBERS ==========================
CREATE TABLE IF NOT EXISTS trip_members (
  trip_id   text NOT NULL REFERENCES trips(id),
  user_id   text NOT NULL REFERENCES users(id),
  role      text NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trip_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_trip_members_user ON trip_members(user_id);

-- =========================== TRIP ITEMS ===========================
-- location_name/address/lat/lng are a snapshot taken when the item is added, so
-- rendering a trip never fans out to DynamoDB.
CREATE TABLE IF NOT EXISTS trip_items (
  id               text PRIMARY KEY,
  trip_id          text NOT NULL REFERENCES trips(id),
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

-- =========================== INVITATIONS ==========================
CREATE TABLE IF NOT EXISTS invitations (
  id          text PRIMARY KEY,
  trip_id     text NOT NULL REFERENCES trips(id),
  email       text NOT NULL,
  code        text NOT NULL UNIQUE,
  role        text NOT NULL DEFAULT 'viewer' CHECK (role IN ('owner', 'editor', 'viewer')),
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_invitations_trip ON invitations(trip_id);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(email);

-- ======================== ITEM ATTACHMENTS ========================
CREATE TABLE IF NOT EXISTS item_attachments (
  id         text PRIMARY KEY,
  item_id    text NOT NULL REFERENCES trip_items(id),
  file_name  text NOT NULL,
  mime_type  text NOT NULL,
  size_bytes integer NOT NULL,
  path       text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  visibility text NOT NULL DEFAULT 'legacy'
);

CREATE INDEX IF NOT EXISTS idx_item_attachments_item ON item_attachments(item_id);

-- ======================= ATTACHMENT VIEWERS ========================
CREATE TABLE IF NOT EXISTS attachment_viewers (
  attachment_id text NOT NULL REFERENCES item_attachments(id) ON DELETE CASCADE,
  user_id       text NOT NULL REFERENCES users(id),
  PRIMARY KEY (attachment_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_attachment_viewers_user ON attachment_viewers(user_id);

-- =========================== USER FAVORITES ==========================
-- location_id references the DynamoDB catalogue; deliberately no FK.
CREATE TABLE IF NOT EXISTS user_favorites (
  user_id     text NOT NULL REFERENCES users(id),
  location_id text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, location_id)
);

-- ========================== USER INTERESTS ==========================
CREATE TABLE IF NOT EXISTS user_interests (
  id         text PRIMARY KEY,
  user_id    text NOT NULL,
  term       text NOT NULL,
  source     text NOT NULL DEFAULT 'custom' CHECK (source IN ('picked', 'custom')),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Monotonic insertion order: created_at is the transaction timestamp, so it
  -- cannot break ties inside a single replace-all write.
  seq        bigint GENERATED ALWAYS AS IDENTITY,
  UNIQUE (user_id, term)
);

-- Existing databases created before `seq` existed.
ALTER TABLE user_interests ADD COLUMN IF NOT EXISTS seq bigint GENERATED ALWAYS AS IDENTITY;

CREATE INDEX IF NOT EXISTS idx_user_interests_user ON user_interests(user_id);

-- ========================= SUGGESTION CHATS ==========================
CREATE TABLE IF NOT EXISTS suggestion_chats (
  id         text PRIMARY KEY,
  trip_id    text NOT NULL,
  user_id    text NOT NULL,
  day        text NOT NULL,
  messages   text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_suggestion_chats_trip_user_day
  ON suggestion_chats(trip_id, user_id, day);
