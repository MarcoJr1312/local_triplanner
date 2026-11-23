-- One-time decommission of the platform user/notification tables (M10.13).
-- The users service owns accounts and notifications in its own database.
--
-- Run after the fixed-UUID migration and Gate 2, with the API stopped:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/db/pg/decommission-users.sql
--
-- attachment_viewers.user_id and the other user ids are opaque text references;
-- they keep working after the tables are dropped.

DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS users CASCADE;
