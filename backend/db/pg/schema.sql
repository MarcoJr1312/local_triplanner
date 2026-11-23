-- Triplanner platform Postgres schema.
-- Canonical DDL for the relational store. Idempotent: re-runnable.
--
-- ARCHITECTURE:
--   * MongoDB (locations service) owns the catalogue; no FKs point at it.
--   * The users service owns accounts and notifications, each in its own
--     PostgreSQL database. Postgres here owns favorites, interests, chats and
--     attachment metadata; the agent owns its own pgvector database.
--   * Run decommission-trips.sql, decommission-users.sql and
--     decommission-agent-vectors.sql once on databases created before those
--     cutovers.

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

CREATE INDEX IF NOT EXISTS idx_attachment_viewers_user ON attachment_viewers(user_id);

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
