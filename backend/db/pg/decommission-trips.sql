-- One-time trips decommission (M9.11). Apply only after Gate 2 approval and a
-- verified pg_dump of these four tables:
--
--   pg_dump -U triplanner -d triplanner \
--     -t trips -t trip_members -t trip_items -t invitations > legacy-trips.sql
--
-- The trips service owns these tables in its own database. The platform keeps
-- users, attachments, favorites, chats and agent vectors.
--
-- The item_attachments.trip_id column is already populated and its legacy FK
-- was dropped by schema.sql, so dropping trip_items does not affect attachments.

BEGIN;

ALTER TABLE IF EXISTS item_attachments
  DROP CONSTRAINT IF EXISTS item_attachments_item_id_fkey;

DROP TABLE IF EXISTS invitations;
DROP TABLE IF EXISTS trip_items;
DROP TABLE IF EXISTS trip_members;
DROP TABLE IF EXISTS trips;

COMMIT;
