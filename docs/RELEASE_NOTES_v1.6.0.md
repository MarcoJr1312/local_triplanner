# Release notes — v1.6.0 (favorites + activity reminders)

| Field | Value |
|---|---|
| Status | Release candidate; Docker Hub publish and published-stack smoke pending |
| Chart | `helm-triplanner` 0.10.0 (`appVersion` 1.6.0) |
| Images | web, API, users and trips `1.6.0`; locations `0.2.1`, email `0.1.1`, broker `0.1.0` unchanged |
| Contracts | `docs/migrations/0013-user-favorites.md`, `docs/migrations/0014-activity-reminders.md` |
| QA | `docs/migrations/0015-favorites-qa.md`, `docs/migrations/0016-reminders-qa.md` (both Gate 2 approved) |
| Supersedes | `v1.5.0` and `v1.4.0`, which were tagged locally but never published |

## Highlights

### Private favorites in the users service (M12)

- Favorite places now live in the users service
  (`favorite_locations`), not the platform API database.
- The heart works for catalogue IDs and legacy trip-item IDs; the API keeps one
  request-scoped favorite set, so search and itinerary reads do not query per
  item.
- Manual activities have no heart. A failed favorite shows a localized error
  instead of silently rolling back.
- The platform `user_favorites` table is decommissioned; the copy script is
  idempotent (`backend/users-service/scripts/migrate-favorites.ts`).

### Activity reminders (M13)

- One reminder per activity, configured by an owner or editor: required
  activity time, lead of 15/30/60/120 minutes, and any current trip members as
  recipients.
- The trips service owns the configuration and recipients; the users service
  owns the in-app notifications; the API sweeps due reminders every 30 s,
  applies a 15-minute grace, publishes `onNotification` live and marks each
  recipient sent.
- The bell opens a dialog for owner/editor. Viewers see a read-only state:
  recipients see a configured reminder, non-recipients see that only an
  owner/editor can configure it.
- Reminder cards show the activity time in the trip timezone; the demo trip is
  now `America/Toronto`.
- Invite notifications are unchanged.

### Helm configuration

- Every application workload now reads its non-secret environment from a
  per-service ConfigMap (`triplanner-<service>-config`) via
  `envFrom.configMapRef`; secrets stay as `secretKeyRef` entries.
- The pod templates carry a `checksum/config` annotation, so changing a value
  rolls the affected deployment.

## Upgrade

Compose (published images):

```bash
cd local_triplanner
DOCKERHUB_USERNAME=marcojr13 IMAGE_TAG=1.6.0 USERS_IMAGE_TAG=1.6.0 \
  docker compose -f deploy/docker-compose.hub.yml up -d
```

Helm:

```bash
helm upgrade triplanner ./helm/helm-triplanner \
  --namespace triplanner \
  --set images.web.tag=1.6.0 \
  --set images.users.tag=1.6.0 \
  --set images.trips.tag=1.6.0 \
  --wait
```

The users service migrates to schema v3, the trips service to schema v4 and
the API applies its schema on boot. Back up both PostgreSQL volumes before a
real upgrade. The platform favorites table is already dropped by M12; a new
environment never creates it.

## Behavior changes

- **Reminder bell is a dialog, not a toggle.** Enabling requires an activity
  time and at least one recipient. Existing activity reminder flags are not
  carried over; every item starts with reminders off.
- **The API runs the reminder sweep.** In the local demo, run one API replica.
  Multiple replicas would need leader election; the notification dedupe key
  prevents duplicate inbox rows but not duplicate work.
- **Demo trip timezone is Toronto.** Other trips keep their stored timezone.
- **Favorites are private.** No counts or social likes.
- **`REMINDER_SWEEP_MS`** defaults to `30000`; Compose acceptance used `3000`
  for faster tests.

## Verification

- Suites: trips 67/67, users 67/67, API 73/73, frontend 33/33; `tsc` clean in
  all four.
- `helm test` 5/5; chart renders, server dry-run clean, non-root/read-only web
  unchanged.
- Live favorites on Compose and ingress: legacy and catalogue IDs, reload
  persistence, user isolation, manual activity hidden, users-down error.
- Live reminders on Compose and ingress: owner save/disable, viewer read-only,
  mandatory time, past-due English error, two-recipient live `onNotification`,
  correct Toronto card time, dedupe on re-sweep/API restart, 15-minute expiry,
  users-service-down retry.
- Regression: local invites, add activity, uploads, English default and
  Spanish switch.
- Test isolation: users use `users_test`, trips use `trips_test`; the suites no
  longer reset the Helm demo databases.

## Publication checklist

1. Push `refactor/helm` (or merge to `main`) and tag `v1.6.0`; CI publishes
   `marcojr13/triplanner-{web,api,users,trips}:1.6.0` plus `1.6` and
   `sha-…` (amd64 + arm64).
2. Run the published-stack smoke: login `demo` / `demo123`, heart a place,
   configure a reminder minutes ahead, receive the in-app notification,
   username invite → bell/SSE → accept.
3. Record the published digests below and confirm the Helm release runs the
   `1.6.0` tags.
4. macOS clean-clone QA remains pending.

| Image | Digest |
|---|---|
| `marcojr13/triplanner-web:1.6.0` | TBD (CI) |
| `marcojr13/triplanner-api:1.6.0` | TBD (CI) |
| `marcojr13/triplanner-users:1.6.0` | TBD (CI) |
| `marcojr13/triplanner-trips:1.6.0` | TBD (CI) |
