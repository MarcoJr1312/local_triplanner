# 0014 — Activity reminders (trips config, users inbox)

| Field | Value |
|---|---|
| Status | **Approved — Gate 1 (2026-11-22), human instruction: “ok perfect lets execute it”** |
| Cycle | Microservice Code Migration (`19455fa3-28ea-4f03-b195-973c5ddf595e`) |
| Integration branch | `refactor/helm` |
| Work branch | `feature/activity-reminders` |
| Owner service | `backend/trips-service` (schedule, recipients, roles) |
| Inbox | `backend/users-service` (notification row) |
| Dispatch | `backend/server` (API facade + live pubsub) |
| Client | `frontend-next` (bell dialog and notification card) |
| Depends on | M12 favorites; M9 trips; M10 users notifications |

## 1. Summary

Turn the current bell flag into a real in-app reminder. An owner or editor
selects one or more trip members, a mandatory activity start time and a lead
time. At `start - lead`, each selected member receives an in-app notification
through the users service; the API publishes `onNotification` so the bell
updates live. The trips service owns the reminder configuration and due time;
the users service owns the inbox; the API orchestrates dispatch.

The current implementation stores a single `reminder_enabled` column on
`trip_items`, the UI disables the bell when the item has no time, every demo
item lacks a time, and nothing ever sends a reminder. This contract replaces
that flag with a per-activity configuration and recipient list.

## 2. Decisions (2026-11-22)

1. **One reminder per activity.** One lead time and one recipient list; no
   multiple reminders per item.
2. **Owner/editor only.** Only owner or editor can enable, edit or disable a
   reminder. Viewers can receive it but cannot configure it.
3. **Any current member as recipient.** The configurer selects one or more
   members; viewers are valid recipients.
4. **Activity start time is mandatory.** If missing, the reminder dialog
   includes a required time field and saves it to the activity in the same
   transaction.
5. **Lead time** is one of 15, 30, 60, 120 minutes; default 60.
6. **In-app only.** No email for v1; the existing `email.reminder.v1` template
   stays unused.
7. **Default off.** New items have no reminder row; the bell is off.
8. **Late delivery grace** is 15 minutes. A reminder more than 15 minutes late
   is marked expired without notifying.
9. **Any owner/editor can edit or disable** an existing reminder, not only its
   creator.

## 3. Trips data model

```sql
CREATE TABLE IF NOT EXISTS trip_item_reminders (
  item_id      uuid PRIMARY KEY REFERENCES trip_items(id) ON DELETE CASCADE,
  trip_id      uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  enabled      boolean NOT NULL DEFAULT false,
  lead_minutes integer NOT NULL CHECK (lead_minutes IN (15, 30, 60, 120)),
  updated_by   uuid NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trip_item_reminder_recipients (
  item_id  uuid NOT NULL REFERENCES trip_item_reminders(item_id) ON DELETE CASCADE,
  user_id  uuid NOT NULL,
  sent_at  timestamptz,
  PRIMARY KEY (item_id, user_id)
);
```

- `trip_items.reminder_enabled` / `reminder_due_at` / `reminder_sent` are
  replaced by the config and per-recipient `sent_at`. Existing rows migrate to
  disabled; the old columns are dropped after the cutover.
- Due time is computed from `trip_items.day`, `trip_items.start_time` and
  `trips.timezone` minus `lead_minutes`. It is not stored; the due query
  computes it so edits cannot leave a stale timestamp.
- If the activity time is missing, the reminder cannot be enabled.
- If the computed due time is `<= now`, the mutation returns
  `REMINDER_TIME_PASSED` (English message) and writes nothing.
- Removing a member removes their recipient rows; if none remain, the config is
  disabled.
- Deleting the item or trip cascades.

## 4. Trips internal REST

| Method | Path | Access | Purpose |
|---|---|---|---|
| `PUT` | `/internal/v1/trips/{tripId}/items/{itemId}/reminder` | owner/editor | Upsert/disable config + recipients; optional `start_time` |
| `GET` | `/internal/v1/trips/{tripId}/items/{itemId}/reminder` | member | Read config + recipients + can_edit |
| `GET` | `/internal/v1/reminders/due?now=ISO` | internal token | Due configs for the dispatcher |
| `POST` | `/internal/v1/reminders/{itemId}/sent` | internal token | Mark recipients sent |

`PUT` body:

```json
{
  "enabled": true,
  "lead_minutes": 60,
  "recipient_ids": ["uuid-1", "uuid-2"],
  "start_time": "19:00"
}
```

Validation:

- `enabled=false`: delete the config and recipients; `lead`/recipients ignored.
- `lead_minutes` must be one of the four values.
- `recipient_ids` must be a non-empty unique list of current trip members.
- `start_time` is optional; if present it must be `HH:MM` and is written to the
  item in the same transaction. If the item has no time and the field is
  absent, return `REMINDER_TIME_REQUIRED`.
- Only owner/editor; viewers get `FORBIDDEN_EDIT`.
- The actor must be a member.

Item aggregate additions:

```text
reminder {
  enabled
  leadMinutes
  startTime
  recipientIds
  canEdit
}
```

`canEdit` is true for owner/editor; `recipientIds` is visible to members.

Due response:

```json
{
  "items": [
    {
      "itemId": "uuid",
      "tripId": "uuid",
      "tripName": "Toronto",
      "itemTitle": "CN Tower",
      "day": "2026-12-04",
      "startAt": "2026-12-04T19:00:00.000Z",
      "dueAt": "2026-12-04T18:00:00.000Z",
      "leadMinutes": 60,
      "recipientIds": ["uuid-1"]
    }
  ]
}
```

## 5. Users notification model

Extend `notifications`:

- `type` check becomes `('trip_invite', 'activity_reminder')`.
- `invitation_id`, `role` become nullable.
- New nullable columns: `item_id text`, `item_title text`, `start_at
  timestamptz`, `lead_minutes integer`, `dedupe_key text`.
- Unique index `(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL`.
- Invite rows keep their current fields and indexes.

`POST /internal/v1/notifications` branches by `type`:

- `trip_invite`: existing validation.
- `activity_reminder`: requires `item_id`, `item_title`, `start_at`,
  `lead_minutes`, `dedupe_key`; no invitation/role. Returns `created=false`
  when the dedupe key already exists.

GraphQL `Notification` additions: `itemId`, `itemTitle`, `startAt`,
`leadMinutes` (nullable). `onNotification` carries them automatically.

## 6. Dispatch

- API background loop every 30 s (`REMINDER_SWEEP_MS`, default 30000).
- Calls trips `GET /internal/v1/reminders/due`.
- For each item, for each recipient without `sent_at`:
  - Create an `activity_reminder` notification with
    `dedupe_key = activity_reminder:{itemId}:{userId}:{dueAt}`.
  - Publish `onNotification` only when `created=true`.
  - On success, collect the recipient for `POST .../sent`.
- If the users service is down, leave the recipient unsent and retry next tick;
  dedupe prevents duplicates.
- If `now - dueAt > 15 min`, mark the recipient expired without a notification.
- One API replica runs the scheduler. Multi-replica leader election is out of
  scope; document it.
- The sweep is best-effort and never blocks HTTP or health probes.

## 7. UI

- Bell on an item:
  - `canEdit=false` and the user is a recipient: filled bell, read-only
    tooltip “Reminder set for {time} ({lead} before)”.
  - `canEdit=false` and not a recipient: muted/disabled bell with “Only the
    owner or an editor can set reminders.”
  - `canEdit=true`: click opens the reminder dialog.
- Dialog:
  - Activity time (required, prefilled; if missing the user must set it).
  - Lead select: 15 / 30 / 60 / 120 minutes, default 60.
  - Member checkboxes (any current member, at least one).
  - Save / Turn off.
  - Errors are localized by stable code (`REMINDER_TIME_REQUIRED`,
    `REMINDER_TIME_PASSED`, `REMINDER_RECIPIENTS_REQUIRED`, `FORBIDDEN_EDIT`).
- Notification card:
  - Type `activity_reminder`: title, “{item} starts at {time}”, trip name,
    “Open trip” button linking to `/trip/{tripId}?day={day}`.
  - Mark read on open; no accept/decline.
- Demo items get plausible start times in the seed (10:00, 14:00, 19:00) so the
  bell is usable; editors can still change them.

## 8. Tests and acceptance

- Trips: config upsert/disable, role enforcement (owner/editor vs viewer),
  recipient membership, mandatory time, past due rejection, lead validation,
  cascades, due query, per-recipient sent.
- Users: reminder notification create/dedupe, nullable invite fields, notification
  listing and GraphQL mapping.
- API: scheduler with a fake clock and fake stores, dedupe, 15-minute grace,
  `onNotification` publish, retry when users service fails.
- Frontend: editor dialog, recipient selection, viewer read-only, live bell
  update, notification card, English/Spanish strings.
- Live: Compose and Helm ingress; set a reminder a few minutes ahead, receive
  the in-app notification at due time; restart API and confirm no duplicates.
- Regression: invite notifications still work; `helm test` stays green.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Scheduler runs twice (two API replicas) | Single replica documented; dedupe key protects delivery |
| API down at due time | 15-minute grace; then expired, no stale notifications |
| Time zone mistakes | Reuse the existing `computeReminderDueAt` with the trip timezone |
| Recipient leaves the trip | Trips removes the recipient row on member removal |
| Notification schema breaks invites | Nullable columns + type branch; invite regression tests |
| Item time edited after send | Sent recipients are not re-notified; unsent recipients recompute |
| Legacy `reminder_enabled` data | Migration sets all existing items to disabled; old columns dropped after QA |

## 10. Rollout

| Stage | Name | Owner |
|---|---|---|
| M13.1 | Contract, ADR and Gate 1 — **done** | PM |
| M13.2 | Trips schema, reminder/recipient domain and REST | Backend |
| M13.3 | Users notification extension and tests | Backend |
| M13.4 | API reminder store, scheduler and pubsub | Backend |
| M13.5 | Frontend bell dialog, notification card and seed times | Backend |
| M13.6 | Compose/Helm acceptance, failure injection and QA | QA |
| M13.7 | Gate 2 and release | PM/SRE |

## 11. Exit criteria

- Owner/editor can configure one reminder per activity with recipients, time
  and lead; viewers cannot edit.
- Due reminders create one in-app notification per recipient, live through
  `onNotification`, with no duplicates.
- Late reminders expire after 15 minutes; users-service failures retry.
- Invite notifications and `helm test` are unaffected.
- Gate 2 recorded before release.
