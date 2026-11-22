-- Triplanner platform Postgres schema.
-- Canonical DDL for the relational store. Idempotent: re-runnable.
--
-- ARCHITECTURE:
--   * MongoDB (locations service) owns the catalogue; no FKs point at it.
--   * The trips service owns trips, members, items and invitations in its own
--     PostgreSQL database (backend/trips-service).
--   * Postgres here owns users, favorites, interests, chats, attachment
--     metadata and agent vectors. SQLite is no longer the local engine.

CREATE EXTENSION IF NOT EXISTS vector;

-- ============================= USERS =============================
-- During the M10 cutover this table backs the local users adapter only. The
-- users service owns accounts after the fixed-UUID migration; M10.13 drops it.
-- Email is optional (accounts are created with username + password).
CREATE TABLE IF NOT EXISTS users (
  id              text PRIMARY KEY,
  username        text,
  email           text UNIQUE,
  password_hash   text,
  display_name    text NOT NULL,
  color           text,
  avatar_url      text,
  language        text NOT NULL DEFAULT 'en',
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS username text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_active
  ON users (lower(username)) WHERE deleted_at IS NULL AND username IS NOT NULL;

-- ========================== NOTIFICATIONS ========================
-- Local invite inbox for USERS_MODE=local only. The users service owns this
-- table after the cutover; user ids stay opaque (no FK) because the service is
-- the authority. M10.13 drops it.
CREATE TABLE IF NOT EXISTS notifications (
  id              text PRIMARY KEY,
  user_id         text NOT NULL,
  type            text NOT NULL CHECK (type IN ('trip_invite')),
  trip_id         text NOT NULL,
  trip_name       text NOT NULL,
  invitation_id   text NOT NULL,
  inviter_user_id text,
  role            text NOT NULL CHECK (role IN ('editor', 'viewer')),
  status          text NOT NULL DEFAULT 'unread'
                    CHECK (status IN ('unread', 'read', 'accepted', 'declined')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  read_at         timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_invitation
  ON notifications(user_id, invitation_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user
  ON notifications(user_id, created_at DESC);

-- ============================ TRIPS =============================
-- Trips, memberships, items and invitations are owned by the trips service
-- (backend/trips-service) in its own PostgreSQL database. They are no longer
-- created here. Run decommission-trips.sql once on an existing database.

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
-- user_id is an opaque users-service id: no cross-database FK.
CREATE TABLE IF NOT EXISTS attachment_viewers (
  attachment_id text NOT NULL REFERENCES item_attachments(id) ON DELETE CASCADE,
  user_id       text NOT NULL,
  PRIMARY KEY (attachment_id, user_id)
);

ALTER TABLE attachment_viewers
  DROP CONSTRAINT IF EXISTS attachment_viewers_user_id_fkey;

CREATE INDEX IF NOT EXISTS idx_attachment_viewers_user ON attachment_viewers(user_id);

-- =========================== USER FAVORITES ==========================
-- location_id references the locations catalogue; user_id is opaque:
-- deliberately no foreign keys.
CREATE TABLE IF NOT EXISTS user_favorites (
  user_id     text NOT NULL,
  location_id text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, location_id)
);

ALTER TABLE user_favorites
  DROP CONSTRAINT IF EXISTS user_favorites_user_id_fkey;

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
