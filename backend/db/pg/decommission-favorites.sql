-- M12 decommission: favorites moved to the users service.
-- Data must be copied with backend/users-service/scripts/migrate-favorites.ts
-- and verified before this runs. Idempotent.
DROP TABLE IF EXISTS user_favorites;
