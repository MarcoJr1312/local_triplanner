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
  language        text NOT NULL DEFAULT 'en',
  created_at      timestamptz NOT NULL DEFAULT now()
);

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

-- Preserve the address the recruiter typed, even if the demo user later edits
-- their profile email. Nullable for owners/direct members.
ALTER TABLE trip_members ADD COLUMN IF NOT EXISTS invited_email text;

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
-- Attachments belong to a trip item, but the item may live in the trips
-- service. Keep trip_id here and do NOT use a foreign key to trip_items: the
-- trips service owns that table after the M9 cutover.
CREATE TABLE IF NOT EXISTS item_attachments (
  id         text PRIMARY KEY,
  trip_id    text,
  item_id    text NOT NULL,
  file_name  text NOT NULL,
  mime_type  text NOT NULL,
  size_bytes integer NOT NULL,
  path       text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  visibility text NOT NULL DEFAULT 'legacy'
);

-- Existing databases: add trip_id, drop the old FK and backfill from the
-- legacy trip_items table while it still exists.
ALTER TABLE item_attachments ADD COLUMN IF NOT EXISTS trip_id text;
ALTER TABLE item_attachments DROP CONSTRAINT IF EXISTS item_attachments_item_id_fkey;

DO $$
BEGIN
  IF to_regclass('public.trip_items') IS NOT NULL THEN
    UPDATE item_attachments a
       SET trip_id = i.trip_id
      FROM trip_items i
     WHERE a.item_id = i.id
       AND a.trip_id IS NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_item_attachments_item ON item_attachments(item_id);
CREATE INDEX IF NOT EXISTS idx_item_attachments_trip ON item_attachments(trip_id);

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

-- ==================== AGENT VECTOR INDEX (pgvector) ====================
-- Replaces ChromaDB. One row per place, interest term or transient query.
-- Embeddings are 384-dim (all-MiniLM-L6-v2 through Chroma's ONNX EF).
CREATE TABLE IF NOT EXISTS agent_embeddings (
  id             text PRIMARY KEY,
  kind           text NOT NULL CHECK (kind IN ('place', 'interest', 'query')),
  destination_id text,
  user_id        text,
  session_id     text,
  document       text NOT NULL,
  metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,
  embedding      vector(384) NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_embeddings_destination
  ON agent_embeddings(destination_id, kind);
CREATE INDEX IF NOT EXISTS idx_agent_embeddings_user
  ON agent_embeddings(user_id, kind);
CREATE INDEX IF NOT EXISTS idx_agent_embeddings_session
  ON agent_embeddings(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_embeddings_vector
  ON agent_embeddings USING hnsw (embedding vector_cosine_ops);

-- Content hash per destination so re-indexing only happens when data changes.
CREATE TABLE IF NOT EXISTS agent_index_state (
  destination_id text PRIMARY KEY,
  content_hash   text NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
