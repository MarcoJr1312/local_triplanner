-- M13: per-activity reminder configuration and selected recipients.
-- IDs are text to match trips/trip_items. The old single reminder columns are
-- superseded and removed; existing items start with no reminder.

CREATE TABLE IF NOT EXISTS trip_item_reminders (
  item_id      text PRIMARY KEY REFERENCES trip_items(id) ON DELETE CASCADE,
  trip_id      text NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  enabled      boolean NOT NULL DEFAULT false,
  lead_minutes integer NOT NULL CHECK (lead_minutes IN (15, 30, 60, 120)),
  updated_by   text NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trip_item_reminders_trip
  ON trip_item_reminders(trip_id);

CREATE TABLE IF NOT EXISTS trip_item_reminder_recipients (
  item_id text NOT NULL REFERENCES trip_item_reminders(item_id) ON DELETE CASCADE,
  user_id text NOT NULL,
  sent_at timestamptz,
  PRIMARY KEY (item_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_trip_item_reminder_recipients_user
  ON trip_item_reminder_recipients(user_id);

-- Data migration: the legacy flag is not carried over; reminders start off.
ALTER TABLE trip_items
  DROP COLUMN IF EXISTS reminder_enabled,
  DROP COLUMN IF EXISTS reminder_sent,
  DROP COLUMN IF EXISTS reminder_due_at;

-- Demo items need a usable time so the bell can be configured. Only fills
-- missing values and never overwrites an editor's time.
UPDATE trip_items SET start_time = '10:00'
 WHERE trip_id = 'demo-trip' AND id = 'demo-item-1' AND start_time IS NULL;
UPDATE trip_items SET start_time = '14:00'
 WHERE trip_id = 'demo-trip' AND id = 'demo-item-2' AND start_time IS NULL;
UPDATE trip_items SET start_time = '19:00'
 WHERE trip_id = 'demo-trip' AND id = 'demo-item-3' AND start_time IS NULL;
UPDATE trip_items SET start_time = '09:30'
 WHERE trip_id = 'demo-trip' AND id = 'demo-item-4' AND start_time IS NULL;
UPDATE trip_items SET start_time = '13:00'
 WHERE trip_id = 'demo-trip' AND id = 'demo-item-5' AND start_time IS NULL;
UPDATE trip_items SET start_time = '20:00'
 WHERE trip_id = 'demo-trip' AND id = 'demo-item-6' AND start_time IS NULL;
UPDATE trip_items SET start_time = '11:00'
 WHERE trip_id = 'demo-trip' AND id = 'demo-item-7' AND start_time IS NULL;
UPDATE trip_items SET start_time = '15:30'
 WHERE trip_id = 'demo-trip' AND id = 'demo-item-8' AND start_time IS NULL;
UPDATE trip_items SET start_time = '21:00'
 WHERE trip_id = 'demo-trip' AND id = 'demo-item-9' AND start_time IS NULL;
