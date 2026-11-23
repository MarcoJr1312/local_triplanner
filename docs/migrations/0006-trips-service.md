# 0006 — Trips service (PostgreSQL)

| Field | Value |
|---|---|
| Status | **M9 complete — decommissioned (M9.11) and released (M9.12)** |
| Integration branch | `refactor/helm` |
| Work branch | `refactor/helm-trips-service` |
| Runtime | Bun + TypeScript |
| Transport | Internal HTTP/JSON, `x-internal-token`, `x-actor-id` |
| Data store | PostgreSQL 17, owned by the service |
| Talks to | locations (read), Go broker (produce) |
| Helm | Postgres StatefulSet + credentials Secret + trips Deployment |
| Planned milestone | **M9 — Trips service (Postgres)** under `Helm Microservices Migration — v1` |

## 1. Summary

Extract the trip aggregate out of the Bun/graphql-yoga API into an
independently deployable `triplanner-trips` service that owns its own
PostgreSQL database and credentials.

The service owns trips, memberships, itinerary items and invitations. It calls
the locations service for destination/place snapshots and publishes
`email.invite.v1` to the Go broker. The email service remains the consumer. The
API keeps the GraphQL contract, identity, attachments, presence, chats,
favorites and the AI facade.

The target topology:

```
web --GraphQL--> api --HTTP/JSON--> trips --HTTP/JSON--> locations --> mongo
                  |                    |
                  |                    +--> postgres (trips, own PVC)
                  |                    +--> broker --> email
                  +--> postgres (users, favorites, chats, agent vectors)
agent --/internal/*--> api
```

## 2. Decisions taken (2026-11-21)

1. **Scope**: trip core + invitations. AI recommendations stay with the agent
   (not implemented yet); the API keeps the deterministic suggestion stub until
   the agent owns it. Attachments, chats, presence and favorites stay in the
   API.
2. **Database**: dedicated `triplanner-trips-postgres` StatefulSet with its own
   credentials Secret, mirroring the MongoDB pattern from `0005`.
3. **Broker**: trips is the producer of `email.invite.v1`; the email service is
   the consumer. Topic, envelope and DLQ stay unchanged. The event is written to
   a transactional outbox in the same transaction as the invitation and a relay
   publishes it, satisfying playbook gate 3 (no dual writes).
4. **Locations**: trips calls locations directly for destination and place
   snapshots. A locations outage degrades to the text supplied by the client; it
   never blocks a trip write.
5. **Cutover**: completed. The `TripsStore` port ran behind
   `TRIPS_MODE=remote|local`; M9.11 removed the local adapter and the legacy
   tables, so the API is remote-only.
6. **Join**: `POST /internal/v1/trips/{id}/join`. The invite email keeps the web
   join link (`APP_URL/join?...`); the web calls the API, the API calls trips.
   A successful join queues `email.member.joined.v1` to the trip owner through
   the same outbox. The API supplies the owner recipient context because trips
   does not own identity.

## 3. Current state

This is the pre-migration inventory. The four tables and the direct SQL were
removed in M9.11.

- `backend/db/pg/schema.sql` owns `trips`, `trip_members`, `trip_items` and
  `invitations` in the platform Postgres, with foreign keys to `users`.
- `backend/server/src/pg/trips.ts` and `pg/invitations.ts` hold the SQL;
  `resolvers.ts` and `internal.ts` contain direct SQL against the same tables.
- `joinTripWithCode` writes the membership and the invitation status in two
  separate statements.
- `updateTripSettings`, `setBudget` and `inviteMember` have no authorization
  check. `listPresence` has no membership check.
- `item_attachments.item_id` has no `ON DELETE CASCADE`, so removing an item
  with attachments raises a foreign-key error.
- `trips.invite_code` is an 8-char code; invitation codes are 12-char
  base64url and globally unique.
- `seed.ts` seeds the demo trip, owner membership and 9 items into the same
  database as `users`.

## 4. Scope

### In scope

- Trip CRUD, settings, budget, cover metadata, timezone, invite code.
- Memberships, roles, ownership transfer, leave, delete.
- Itinerary items: add, update, move, cost, reminder fields, remove.
- Invitations: create, preview by code, join/accept.
- Derived stats: `spent`, `spentByCategory`.
- Internal REST v1 contract and its contract tests.
- Compose + Helm deployment, including the Postgres StatefulSet and Secret.
- Legacy data copy and cutover (completed; the local adapter and legacy tables
  were removed in M9.11).
- Decommission of the legacy tables and code path.

### Out of scope

- Users, profiles, avatars, language, identity. The API remains the authority.
- Attachment bytes, metadata, per-file ACL and HMAC URLs. They stay in the API.
- Presence and GraphQL subscriptions.
- `suggestion_chats`, AI recommendations, pgvector tables.
- Favorites and catalogue search.
- Broker events other than invite and member-joined notifications.
- gRPC. HTTP/JSON in this migration.
- Multi-node Postgres, TLS between services, per-service internal tokens.

## 5. Data ownership

Trips owns exactly four tables plus a schema marker. It never reads or writes
the platform database.

### 5.1 Tables

| Table | Purpose | Key invariants |
|---|---|---|
| `trips` | Aggregate root | unique `invite_code`; one owner membership |
| `trip_members` | Membership + role | PK `(trip_id, user_id)`; one `owner` per trip |
| `trip_items` | Itinerary | FK `trip_id` with `ON DELETE CASCADE` |
| `invitations` | Invite codes | unique `code`; role is `editor` or `viewer` only |
| `outbox` | Invite and member-joined email events | pending until published; at-least-once |
| `schema_migrations` | Applied version | one row per applied version |

`user_id`, `owner_id`, `created_by` are **opaque text with no foreign key**. The
API validates identity before calling; trips validates membership and role.

### 5.2 DDL

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    integer PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trips (
  id               text PRIMARY KEY,
  name             text NOT NULL,
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
  owner_id         text NOT NULL,
  invite_code      text NOT NULL UNIQUE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trips_owner ON trips(owner_id);

CREATE TABLE IF NOT EXISTS trip_members (
  trip_id       text NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id       text NOT NULL,
  role          text NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  joined_at     timestamptz NOT NULL DEFAULT now(),
  invited_email text,
  PRIMARY KEY (trip_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_trip_members_user ON trip_members(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_trip_members_one_owner
  ON trip_members(trip_id) WHERE role = 'owner';

CREATE TABLE IF NOT EXISTS trip_items (
  id               text PRIMARY KEY,
  trip_id          text NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
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

CREATE TABLE IF NOT EXISTS invitations (
  id          text PRIMARY KEY,
  trip_id     text NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  email       text NOT NULL,
  code        text NOT NULL UNIQUE,
  role        text NOT NULL DEFAULT 'viewer' CHECK (role IN ('editor', 'viewer')),
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_invitations_trip ON invitations(trip_id);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(email);

-- Produced in the same transaction as the invitation row.
CREATE TABLE IF NOT EXISTS outbox (
  id            text PRIMARY KEY,
  topic         text NOT NULL,
  event_key     text NOT NULL,
  payload       jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  published_at  timestamptz,
  broker_offset integer,
  attempts      integer NOT NULL DEFAULT 0,
  last_error    text
);
CREATE INDEX IF NOT EXISTS idx_outbox_pending
  ON outbox(created_at) WHERE published_at IS NULL;
```

### 5.3 Changes vs today

- `ON DELETE CASCADE` replaces the manual cascade delete.
- Partial unique index enforces one owner per trip.
- `invitations.role` cannot be `owner` (today the column allows it).
- No foreign keys to `users`.
- `schema_migrations` + `pg_advisory_lock` replace the ad-hoc idempotent DDL.

## 6. Internal REST v1

### 6.1 Conventions

- Base URL: `http://triplanner-trips:4400` (Helm), `http://trips:4400` (Compose).
- `x-internal-token` on every request except `/health` and `/ready`;
  timing-safe comparison.
- `x-actor-id` on every actor-scoped route. The API resolves the browser
  identity and forwards it; the service never reads the browser.
- JSON, `snake_case`, max body 1 MiB, ISO-8601 timestamps.
- Flat error envelope: `{"error":"CODE","message":"..."}`.
- `GET /health` → `{"status":"ok"}`.
- `GET /ready` → `{"status":"ready","postgres":"ok","migrated":true}` or
  `503 {"status":"not_ready","postgres":"down"}`.

### 6.2 Endpoints

| Method | Path | Actor | Purpose |
|---|---|---|---|
| POST | `/internal/v1/trips` | any | Create; actor becomes owner in the same transaction |
| GET | `/internal/v1/trips` | any | Summaries for the actor |
| GET | `/internal/v1/trips/{id}` | member | Aggregate + `my_role` + stats |
| PATCH | `/internal/v1/trips/{id}` | owner/editor | Settings, budget, cover metadata |
| DELETE | `/internal/v1/trips/{id}` | owner | Delete trip |
| GET | `/internal/v1/trips/{id}/members` | member | Member list |
| POST | `/internal/v1/trips/{id}/members` | owner/editor | Add a member directly |
| PATCH | `/internal/v1/trips/{id}/members/{userId}` | owner | Change role |
| DELETE | `/internal/v1/trips/{id}/members/{userId}` | owner | Remove member |
| POST | `/internal/v1/trips/{id}/leave` | member | Leave; owner must transfer |
| GET | `/internal/v1/trips/{id}/items` | member | List items |
| POST | `/internal/v1/trips/{id}/items` | owner/editor | Add item |
| PATCH | `/internal/v1/trips/{id}/items/{itemId}` | owner/editor | Update item |
| DELETE | `/internal/v1/trips/{id}/items/{itemId}` | owner/editor | Remove item; returns its snapshot |
| POST | `/internal/v1/trips/{id}/items/{itemId}/move` | owner/editor | Day + order |
| POST | `/internal/v1/trips/{id}/items/{itemId}/reminder` | owner/editor | Toggle reminder |
| GET | `/internal/v1/items/{itemId}` | member | Resolve item → trip (attachments) |
| POST | `/internal/v1/trips/{id}/invitations` | owner/editor | Create invitation + publish email event |
| GET | `/internal/v1/invitations/by-code/{code}` | — | Preview by secret code |
| POST | `/internal/v1/trips/{id}/join` | any | Atomic membership + accept + owner notification |
| GET | `/internal/v1/trips/{id}/context` | member | Agent context (trip + days + member ids) |

`POST /items` accepts `order: -1` as an append marker: the service resolves it
to `MAX("order") + 1` for that day inside the insert transaction. Explicit
orders must be integers in `0..1000000`.

### 6.3 Authorization matrix

| Operation | owner | editor | viewer |
|---|---|---|---|
| Read trip, items, members | yes | yes | yes |
| Create/update/delete item | yes | yes | no |
| Update settings, budget | yes | yes | no |
| Update cover | yes | no | no |
| Invite / add member | yes | yes | no |
| Change role / remove member | yes | no | no |
| Delete trip | yes | no | no |
| Leave | yes (with transfer) | yes | yes |

Every route enforces the matrix inside the service. The API may check earlier
for UX, but the service is the authority.

### 6.4 Stable error codes

`UNAUTHORIZED`, `ACTOR_REQUIRED`, `INVALID_ARGUMENT`, `TRIP_NOT_FOUND`,
`NOT_TRIP_MEMBER`, `FORBIDDEN_EDIT`, `NOT_TRIP_OWNER`, `ITEM_NOT_FOUND`,
`MEMBER_NOT_FOUND`, `OWNER_ROLE_PROTECTED`, `OWNER_CANNOT_BE_REMOVED`,
`OWNER_MUST_TRANSFER`, `INVALID_TRANSFER_TARGET`, `INVALID_MEMBER_ROLE`,
`INVITE_CODE_NOT_FOUND`, `INVITE_ALREADY_USED`, `INVITE_EMAIL_MISMATCH`,
`INVALID_INVITE_ROLE`, `LOCATIONS_UNAVAILABLE`, `UNAVAILABLE`,
`INTERNAL_ERROR`.

### 6.5 Selected payloads

`POST /internal/v1/trips`

```json
{
  "id": "optional client-supplied uuid (idempotent retry)",
  "name": "Fin de semana en Toronto",
  "destination_id": "toronto",
  "destination_name": "Toronto",
  "start_date": "2026-12-04",
  "end_date": "2026-12-06",
  "total_budget": 1200,
  "timezone": "America/Toronto"
}
```

The service resolves `destination_id` through locations and fills
`destination_lat/lng`; if locations is unavailable it keeps the supplied name
and null coordinates.

`GET /internal/v1/trips/{id}` returns the trip row, `my_role`, `members`,
`items`, `spent` and `spent_by_category`.

`POST /internal/v1/trips/{id}/invitations`

```json
{
  "email": "friend@example.com",
  "role": "editor",
  "notify": {
    "inviter_name": "Marco",
    "language": "es",
    "app_url": "http://localhost:3000",
    "demo": true
  }
}
```

The service builds the email join URL from `app_url`, the trip id and the
generated code: `${app_url}/join?trip=...&code=...&auto=1`.

Returns:

```json
{
  "invitation": { "id": "...", "email": "...", "code": "...", "role": "editor", "status": "pending" },
  "email": { "queued": true }
}
```

The email is queued in the same transaction; the relay owns delivery. The
invitation and the copyable join link work even if the broker is down.

`POST /internal/v1/trips/{id}/join`

```json
{
  "user_id": "demo-friend",
  "email": "friend@example.com",
  "code": "AB12CD34EF56",
  "notify": {
    "owner_email": "demo@triplanner.local",
    "owner_name": "Demo",
    "member_name": "Demo Friend",
    "language": "es"
  }
}
```

One transaction: validate the code belongs to `{id}`, `status = 'pending'`, the
email matches case-insensitively, insert/update the membership with the
invitation role and `invited_email`, set `accepted_at`, and — when `notify` is
present — insert the `email.member.joined.v1` outbox row. The demo policy
(caller or `demo-friend`) stays in the API.

`notify` is optional. If the API cannot resolve the owner's email, the join
still succeeds and the response reports `"member_email": {"queued": false,
"reason": "NO_OWNER_EMAIL"}`. A duplicate join does not write a second event.

## 7. Locations integration

Trips is a locations client; locations never calls trips.

- Env: `LOCATIONS_URL` (default `http://127.0.0.1:4300`),
  `LOCATIONS_TIMEOUT_MS=2000`, same `INTERNAL_TOKEN`.
- `POST /trips` resolves `GET /internal/v1/locations/{destination_id}` and
  snapshots `name`, `lat`, `lng`.
- `POST/PATCH /items` resolves `GET /internal/v1/locations/{location_id}` and
  snapshots `location_name`, `location_address`, `lat`, `lng`.
- Failure policy: on timeout, 404 or 5xx, keep the client-supplied fields and
  continue. A trip write never fails because locations is down. The response
  includes `"place_resolved": false` for that write.
- No cache in v1. The locations service already caches HasData in MongoDB.
- NetworkPolicy allows egress from trips to locations on 4300.

`TripItem.isFavorite` and catalogue search stay in the API.

## 8. Broker integration

Trips is the producer; the email service remains the consumer.

- Env: `BROKER_URL` (default `http://127.0.0.1:8080`),
  `BROKER_TOPIC=TripInvitation`, `BROKER_TIMEOUT_MS=3000`.
- The invitation and the outbox row are inserted in one transaction. A broker
  outage never rolls back the invitation.
- Event id = invitation id = outbox id, so a retry is deduplicated by the email
  service.
- Envelope is unchanged:

```json
{
  "id": "<invitation id>",
  "type": "email.invite.v1",
  "version": 1,
  "occurredAt": "2026-11-21T12:00:00.000Z",
  "source": "triplanner-trips",
  "payload": {
    "to": "friend@example.com",
    "tripName": "Fin de semana en Toronto",
    "ownerName": "Marco",
    "code": "AB12CD34EF56",
    "joinUrl": "http://localhost:3000/join?trip=demo-trip&code=...&auto=1",
    "role": "editor",
    "language": "es",
    "demo": true
  }
}
```

`ownerName` carries the **inviter's** display name, matching current behaviour.
The email service validates `source` as a string, so `triplanner-trips` is
accepted. Topic `TripInvitation.dlq` remains the consumer's responsibility.

### 8.1 Outbox relay

- The relay runs in the trips process (`OUTBOX_INTERVAL_MS=1000`,
  `OUTBOX_BATCH_SIZE=10`, `OUTBOX_MAX_ATTEMPTS=20`).
- It selects pending rows with `ORDER BY created_at FOR UPDATE SKIP LOCKED`,
  publishes to `BROKER_URL`, then stamps `published_at` and `broker_offset`.
- On failure it increments `attempts`, stores `last_error` and retries with
  backoff. After the max attempts the row stays pending for a manual replay.
- On boot it drains the backlog before reporting a healthy outbox. `/ready`
  returns `outbox_pending` as an informational field; it does not fail
  readiness unless the database is down.
- A replay script (`scripts/replay-outbox.ts`) can republish by id; the email
  service deduplicates by event id.

This removes the previous "row committed, publish crashed" gap and satisfies
`README.md` gate 3.

### 8.2 Member joined event

A successful join writes `email.member.joined.v1` to the outbox **in the same
transaction** as the membership:

```json
{
  "id": "<outbox id>",
  "type": "email.member.joined.v1",
  "version": 1,
  "occurredAt": "2026-11-21T12:00:00.000Z",
  "source": "triplanner-trips",
  "payload": {
    "to": "demo@triplanner.local",
    "ownerName": "Demo",
    "memberName": "Demo Friend",
    "tripName": "Fin de semana en Toronto",
    "language": "es"
  }
}
```

- Recipient is the owner; the API supplies `owner_email`, `owner_name`,
  `member_name` and `language` in `notify`.
- Event id = outbox id; a duplicate join is rejected before the outbox insert,
  so the owner is not notified twice.
- The email service adds the event type, a Spanish/English template and DLQ
  handling. This is task M9.5b.

## 9. PostgreSQL deployment

### 9.1 Credentials

Mirror `0005`:

- Secret `triplanner-trips-postgres-credentials`, keys `POSTGRES_USER`,
  `POSTGRES_PASSWORD`, `POSTGRES_DB`.
- Rendered only when `tripsService.postgres.auth.existingSecret` is empty.
- Demo values: `trips` / `trips-demo` / `trips`. Compose uses `trips` /
  `trips` like the Mongo Compose/Helm split in `0005`.
- Production points `existingSecret` at Vault, External Secrets or Sealed
  Secrets. Never commit real credentials.
- Rotation: update the Secret, restart the StatefulSet and the trips Deployment,
  verify `/ready`. The chart has no checksum annotation, matching the current
  convention.

### 9.2 StatefulSet

- `triplanner-trips-postgres`, 1 replica, `serviceName` same as the Service.
- Image `postgres:17` (Debian, UID/GID 999 — the Alpine image uses 70 and would
  break `runAsUser: 999`).
- `PGDATA=/var/lib/postgresql/data/pgdata`.
- PVC `data`, 2Gi RWO, optional `storageClass`.
- Mounts: `data`, plus `emptyDir` at `/tmp` and `/var/run/postgresql` because
  the root filesystem is read-only.
- Probes: `tcpSocket: 5432` (no credentials in args); the trips `/ready` is the
  auth-aware signal.
- Security context: non-root 999, `RuntimeDefault`, no escalation, read-only
  root FS, drop ALL.
- Service `triplanner-trips-postgres:5432`, ClusterIP, never published.
- NetworkPolicy: ingress only from `app.kubernetes.io/name: triplanner-trips`
  on 5432.
- Resources: requests 100m/256Mi; limits 500m/512Mi.

### 9.3 Trips workload

- `triplanner-trips`, 1 replica, port 4400, image
  `marcojr13/triplanner-trips`.
- Env: `PORT`, `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`,
  `POSTGRES_USER`, `POSTGRES_PASSWORD` (secretKeyRef), `INTERNAL_TOKEN`
  (`required` from `triplanner-internal`), `LOCATIONS_URL`, `BROKER_URL`,
  `BROKER_TOPIC`, `LOCATIONS_TIMEOUT_MS`, `BROKER_TIMEOUT_MS`,
  `OUTBOX_INTERVAL_MS`, `OUTBOX_MAX_ATTEMPTS`, `SEED_DEMO`.
- Probes `/health` and `/ready`.
- Same hardening as locations (UID/GID 101, read-only root FS, `/tmp`
  emptyDir), ServiceAccount, optional kube-rbac-proxy sidecar.
- NetworkPolicy: ingress from `triplanner-api` on 4400; egress to Postgres
  5432, locations 4300, broker 8080 and DNS.
- HPA disabled, no PDB (single replica).
- Helm test pod: `wget /ready`.
- Chart version 0.6.1.

### 9.4 Compose

- `trips-postgres`: `postgres:17`, volume `tripspgdata`, healthcheck
  `pg_isready`, no published port.
- `trips`: build `backend/trips-service/Dockerfile`, depends on
  `trips-postgres` healthy and `locations` healthy, image healthcheck `/ready`.
- API: `TRIPS_URL=http://trips:4400`, `TRIPS_TIMEOUT_MS=5000` (the API must
  outlast the service's 2 s locations timeout).
- The base Compose still has no broker or email service; the trips broker URL
  falls back to `127.0.0.1:8080` and publishing fails soft. The local-cluster
  overlay points at the in-cluster broker.

## 10. API adapter and cutover

### 10.1 Store interface

`backend/server/src/trips/`:

- `types.ts` — `TripsStore` port, row types and the request/response shapes.
- `remote.ts` — calls the service with `TRIPS_URL`, `TRIPS_TIMEOUT_MS`,
  `x-internal-token`, `x-actor-id`; maps transport failures to
  `TRIPS_UNAVAILABLE`.
- `index.ts` — factory returning `RemoteTripsStore`. The local adapter existed
  during the cutover and was removed in M9.11.

`Ctx.trips` replaced the direct trip SQL in `resolvers.ts` / `internal.ts`.

### 10.2 GraphQL composition

The public schema does not change.

- `Trip.members`: user ids + roles from trips; `displayName`, `email`, `color`,
  `avatarUrl` from the API users table.
- `Trip.spent` / `spentByCategory` / `myRole`: from trips.
- `TripItem.attachments`: API.
- `TripItem.isFavorite`: API favorites.
- `TripItem.addedBy`: user id from trips; enriched where needed.
- `Trip.ownerId`, `inviteCode`, cover fields, timezone: trips.
- `getTripByCode`: trips preview + API owner name.
- `Presence`, `SuggestionChat`, `requestSuggestions`: unchanged in the API;
  suggestions read items through the store.
- `getTrip` returns `TRIP_NOT_FOUND` for a missing trip and
  `NOT_TRIP_MEMBER` for a non-member (today both return `NOT_TRIP_MEMBER`).

### 10.3 Attachments and covers ordering

- Add attachment: API resolves the item via `GET /items/{itemId}`, checks the
  item belongs to the trip and the actor is a member, then writes bytes and
  metadata.
- Remove item: API deletes attachment rows + bytes first, then calls trips
  `DELETE item`. If trips fails, the item remains without attachments and the
  user can retry. No orphan bytes.
- Delete trip: same order; attachments first, then the trip.
- Cover: API writes the new bytes, PATCHes the trips metadata, then deletes the
  old file. If the PATCH fails, delete the new bytes.

### 10.4 Data copy

`backend/trips-service/scripts/import-legacy.ts`:

- `LEGACY_DATABASE_URL` → `TRIPS_DATABASE_URL`.
- Copies `trips` → `trip_members` → `trip_items` → `invitations`.
- `ON CONFLICT DO NOTHING`; rerunnable.
- Verifies row counts and a per-table checksum; exits non-zero on mismatch.
- Requires a write freeze: stop the API, copy, then start the API pointed at the
  trips service.
- The legacy tables were retained until M9.11 for rollback and have now been
  dropped (see 10.6).

### 10.5 Implementation notes (M9.6)

- The API is remote-only after M9.11. It uses `TRIPS_URL` (:4400) and
  `TRIPS_TIMEOUT_MS`; outages map to `TRIPS_UNAVAILABLE`.
- The API still owns identity: members from trips are enriched from `users`
  before they reach GraphQL.
- `item_attachments` stores `trip_id` and no longer has a foreign key to
  `trip_items`. The migration backfilled existing rows while the legacy table
  existed. The API validates the item through the trips store and deletes
  attachments before the item or trip.
- `email.invite.v1` notify context passes `app_url`; the producer builds the
  final join URL from the trip id and the generated code.
- Seed split: the API seeds `demo-user`/`demo-friend`; the trips service seeds
  the demo trip (`SEED_DEMO=true`).
- Evidence: API suite 82 tests passed in local+remote mode before the
  decommission; the remote-only suite is 59. Live remote and Compose smokes
  created trips through the API and verified the rows in the trips database.

### 10.6 Decommission (M9.11)

Gate 2 was approved on 2026-11-21. Before dropping anything:

- `legacy-trips-20261121-214500.sql` (21,828 bytes, SHA256
  `CEBE6636...C7798E`) — pg_dump of the four legacy tables.
- `trips-full-20261121-214500.sql` (26,848 bytes, SHA256
  `B09F8CCC...C8D58`) — full pg_dump of the trips database.

Then:

- `backend/db/pg/decommission-trips.sql` drops `invitations`, `trip_items`,
  `trip_members` and `trips` from the platform database.
- `TRIPS_MODE`, `trips/local.ts`, `pg/trips.ts`, `pg/invitations.ts`,
  `pg/reminders.ts`, the API broker publisher and the local-only tests were
  removed.
- `schema.sql` no longer creates the four tables.
- Verified: platform and test databases return `null` for all four
  `to_regclass` checks; the API starts with `trips url=...`; the demo trip still
  serves 9 items and `spent=413` through the trips service.

Rollback after M9.11 is the previous image/tag plus a restore from the dumps.


## 11. Seeding

- API `db:seed` seeds only `demo-user`/`demo-friend`; it never inserts trips.
- The trips service seeds the demo trip, owner membership and 9 items when
  `SEED_DEMO=true`; idempotent on fixed ids (`demo-trip`, `demo-item-1..9`).
- The trips seed does not need `demo-user`/`demo-friend` to exist in its DB
  because there are no user foreign keys.

## 12. Invariants fixed by this migration

1. Settings and budget require owner/editor.
2. Invite requires owner/editor.
3. `listPresence` requires membership (API).
4. Join is one transaction inside trips.
5. One owner per trip is enforced by a partial unique index.
6. Invitation roles cannot be `owner`.
7. Item deletion no longer violates an attachment FK (attachments are removed
   first).
8. Trip delete is a single cascading `DELETE`.

## 13. Test matrix

### Service (real Postgres, `trips_test`)

- Create trip creates the owner membership atomically; retry with the same id is
  idempotent.
- List/get by actor; 404 vs 403; `my_role`.
- Settings/budget/cover authz; viewer and non-member rejection.
- Role change, remove, owner protection, transfer, leave.
- Item CRUD, move, cost, reminder, ordering; delete cascades.
- Invitation create, unique code, role validation, preview, join success,
  wrong email, used code, wrong trip, atomic failure injection.
- Join notification: one outbox row per successful join; duplicate join does
  not double-send; missing owner email returns `queued=false`; owner recipient
  comes from `notify`.
- Outbox: invitation + event committed atomically; relay publishes and stamps
  the offset; broker down leaves the row pending and retries; replay is
  idempotent.
- Stats sum and grouping.
- Cascade delete removes items, members and invitations.
- Locations client: success, timeout, 404, 5xx → degrade and succeed.
- Broker relay: success, timeout, 5xx → row stays pending; invitation still
  created; copyable link works.

### API in remote mode

- GraphQL shapes unchanged; members enriched from users.
- All mutations still enforce membership.
- Attachment add/remove and cover update ordering.
- `requestSuggestions` reads items through the store.
- `getTripByCode` and the web join flow (including the owner notification).
- The legacy local mode was removed in M9.11; the remote-only suite passes.

### Email service

- `email.member.joined.v1` parses, renders in es/en and delivers in sink mode.
- Invalid payload goes to `TripInvitation.dlq`; duplicate event id is ignored.

### Compose E2E

- Clean boot: `docker compose -f deploy/docker-compose.yml up --build`.
- Demo login, seeded trip, create trip, add/move/delete item, budget, invite as
  `demo-user`, join as `demo-friend`, attachment upload, AI suggestion stub,
  presence.
- Failure injection: stop locations (trip writes still succeed), stop broker
  (invite row + copyable link), stop trips (API returns `TRIPS_UNAVAILABLE`).

### Helm

- `helm lint`, `helm template`, `kubeconform`, server dry-run.
- Both pods ready; `/ready` reports Postgres ok.
- Postgres port not reachable from web; trips reachable from api only.
- Secret rendered from values; `existingSecret` path renders none.
- Rollback one revision and re-check.
- Runbook: install, upgrade, rollback, rotate credentials, restore with
  `pg_dump`.

## 14. Rollout stages

| Stage | Name | Owner |
|---|---|---|
| M9.1 | Contract, ADR and Gate 1 | PM |
| M9.2 | Service skeleton: config, token, health, errors, shutdown | Backend |
| M9.3 | Schema, migrations, advisory lock, demo seed | Backend |
| M9.4 | Trips, members, items + locations client + authz | Backend |
| M9.5 | Invitations, join, transactional outbox and broker relay | Backend |
| M9.5b | Email: `member.joined` event and template | Backend |
| M9.6 | API `TripsStore`, `TRIPS_MODE`, resolver/internal refactor, seed split | Backend |
| M9.7 | Legacy data copy and count verification | Backend |
| M9.8 | Compose integration and e2e | Backend |
| M9.9 | Helm Postgres StatefulSet, Secret, workload, NetworkPolicy | SRE |
| M9.10 | QA matrix, failure injection, Gate 2 | QA |
| M9.11 | Decommission local store and legacy tables | Backend |
| M9.12 | Image publish, Helm acceptance, docs, release | SRE |

## 15. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Trips now depends on locations | A locations outage could block writes | Best-effort lookup; client text fallback; timeout 2 s |
| Trips now depends on broker | Invite email can fail | Transactional outbox + relay; invitation and copyable link always work |
| Outbox backlog | Emails delayed after a long outage | Drained on boot, bounded retries, replay script, `outbox_pending` in `/ready` |
| Owner email missing | No join notification | `notify` optional; join still succeeds; response reports `queued=false` |
| Two Postgres instances | +256-512 MB on Docker Desktop | Single replica; small PVC; document the budget |
| Data copy needs a freeze | Writes during copy are lost | Stop API, copy, verify counts, then cut over |
| Opaque user ids | No referential integrity | API validates identity; membership enforced in trips |
| Attachments stay in the API | `item_id` has no FK | API validates via `GET /items/{itemId}`; delete order |
| Shared internal token | One token for every service | Existing limitation; per-service tokens as follow-up |
| Helm has no API/platform Postgres | Trips is only callable in-cluster | Documented; API runs outside the chart as today |
| Presence stays in-process | Breaks on multiple API replicas | Single replica; out of scope |

## 16. Acceptance evidence

- Contract tests and integration tests with pasted output.
- `bunx tsc --noEmit` for trips, API and any touched package.
- Compose E2E output including the failure injections.
- `helm lint`, `helm template`, `kubeconform`, pod readiness and rollback.
- Data copy counts and checksums before/after.
- Outbox drain: one invite event published, acked by the email consumer, no
  pending rows, no DLQ growth.
- Join notification: owner receives one email; duplicate join sends nothing.
- GraphQL regression evidence for the demo path.
- No secret in logs, images, rendered manifests or the browser.
- Gate 1 and Gate 2 decisions recorded in Orkai.
