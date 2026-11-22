-- Schema v2: local invitations (no email, no code, no outbox).
--
-- Two channels share the table:
--   * email: email + code required (the existing behaviour).
--   * local: invitee_user_id required; the invitee is notified by the API.
--
-- Idempotent-friendly ALTERs: this file runs once per database, inside the
-- migration runner transaction.

ALTER TABLE invitations
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'email';

ALTER TABLE invitations
  ADD COLUMN IF NOT EXISTS invitee_user_id text;

ALTER TABLE invitations ALTER COLUMN email DROP NOT NULL;
ALTER TABLE invitations ALTER COLUMN code DROP NOT NULL;

ALTER TABLE invitations DROP CONSTRAINT IF EXISTS invitations_channel_check;
ALTER TABLE invitations ADD CONSTRAINT invitations_channel_check
  CHECK (channel IN ('email', 'local'));

ALTER TABLE invitations DROP CONSTRAINT IF EXISTS invitations_status_check;
ALTER TABLE invitations ADD CONSTRAINT invitations_status_check
  CHECK (status IN ('pending', 'accepted', 'declined', 'revoked'));

ALTER TABLE invitations DROP CONSTRAINT IF EXISTS invitations_channel_fields;
ALTER TABLE invitations ADD CONSTRAINT invitations_channel_fields CHECK (
  (channel = 'email' AND email IS NOT NULL AND code IS NOT NULL)
  OR (channel = 'local' AND invitee_user_id IS NOT NULL)
);

-- One pending local invite per trip and user; declined/accepted rows free it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_invitations_local_pending
  ON invitations(trip_id, invitee_user_id)
  WHERE channel = 'local' AND status = 'pending';
