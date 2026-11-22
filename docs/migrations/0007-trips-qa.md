# 0007 — Trips migration QA and Gate 2

| Field | Value |
|---|---|
| Status | **Gate 2 approved 2026-11-21 — M9.11 and M9.12 complete** |
| Date | 2026-11-21 |
| Environment | Windows 11, Docker Desktop, Compose stack, Kubernetes `docker-desktop` |
| Branch | `refactor/helm-trips-service` |
| Image under test | `marcojr13/triplanner-trips:0.1.0` (local build; publication is M9.12) |
| Postgres | 17.12 (trips) / pgvector 17 (platform) |
| Chart | `helm-triplanner` 0.6.0 |

## 1. Scope

Verified the M9 delivery: trips service ownership of trips/members/items/
invitations, the API cutover behind `TRIPS_MODE`, the transactional outbox,
Compose integration, the legacy data import and the Helm workload.

Out of scope: macOS clean-clone QA (pre-existing) and the agent-owned
recommendation microservice. M9.11 decommission and M9.12 release are complete
(sections 8 and 9).

## 2. Automated suites

| Suite | Command | Result |
|---|---|---|
| Trips service | `cd backend/trips-service && bunx tsc --noEmit && bun test` | 58 pass, 0 fail |
| API | `cd backend/server && bunx tsc --noEmit && bun test` | 82 pass, 0 fail |
| Email service | `cd backend/email-service && bunx tsc --noEmit && bun test` | 67 pass, 0 fail |
| Locations regression | `cd backend/locations-service && bun test` | 35 pass, 0 fail |
| Frontend regression | `cd frontend-next && bun test` | 16 pass, 0 fail |

The API suite includes the remote adapter tests (aggregate mapping, `app_url`
notify shape, `TRIPS_UNAVAILABLE` on 503/network) and the local resolver smoke.

## 3. Functional matrix

| Area | Result | Evidence |
|---|---|---|
| Create trip, owner membership, invite code | PASS | Service tests; live Compose `createTrip` |
| List/get by actor; 404 vs 403 | PASS | Service tests; live remote smoke |
| Settings/budget authz; cover owner-only | PASS | Service tests; API resolver smoke |
| Roles, owner protection, transfer/leave | PASS | Service tests |
| Items CRUD, move, cost, reminders | PASS | Service tests; API smoke |
| Stats `spent` / `spentByCategory` | PASS | Demo trip: 9 items, `spent=413` |
| Invitation create, preview, atomic join | PASS | Service tests; live Compose invite/join |
| Duplicate join does not double-send | PASS | Service tests |
| Outbox relay, retry, offset, replay | PASS | Service tests; live broker stub |
| Owner notification event | PASS | Service + email tests |
| Members enriched from API users | PASS | Live remote smoke: `displayName=Demo` |
| Locations snapshot + degradation | PASS | Live: trip created with `destinationLat=null` while locations down |
| Attachment metadata, ACL, HMAC URLs | PASS | API attachment tests |
| Item/trip delete ordering | PASS | API attachment tests; schema `trip_id` |
| Demo seed split | PASS | API seeds users; trips seeds 9 items |
| Legacy data import | PASS | 1 trip + 1 member copied; second run no-op and checksums equal |

## 4. Compose end-to-end

Stack: `docker compose -f deploy/docker-compose.yml up -d --build`.

```
local_triplanner-api              Up (healthy)
local_triplanner-trips            Up (healthy)
local_triplanner-trips-postgres   Up (healthy)
local_triplanner-locations        Up (healthy)
local_triplanner-web              Up (healthy)
local_triplanner-agent            Up (healthy)
local_triplanner-postgres         Up (healthy)
local_triplanner-mongo            Up (healthy)
```

Demo path through the web GraphQL proxy (`http://localhost:3000/api/graphql`):

- `listMyTrips` returns `demo-trip` with role `owner`.
- `getTrip("demo-trip")`: 9 items, `spent=413`, 1 member, no errors.
- Create a new trip with destination `toronto`; destination resolves.
- `sendTripInvite` returns a 12-char code and a copyable join URL.
- `getTripByCode` returns the preview; `joinTripWithCode` adds `demo-friend` as
  `viewer`.
- Trips DB: 2 trips, 3 members, 9 items, 2 pending outbox rows (base Compose has
  no broker). The copyable link works; the local-cluster overlay points the
  service at the cluster broker.

Failure injection:

| Injection | Result |
|---|---|
| `docker compose stop locations` then create a trip | PASS — trip created, `destinationName` kept, `destinationLat=null`, no GraphQL error |
| `docker compose stop trips` then `getTrip` | PASS — `TRIPS_UNAVAILABLE`, `data.getTrip=null` |
| Restart trips then `getTrip` | PASS — data returns |

The API trips timeout was raised to 5 s because the service itself waits up to
2 s for locations; at 2 s the API timed out first.

## 5. Kubernetes acceptance

- `helm lint`: 1 chart linted, 0 failed.
- `helm template` + `kubectl apply --dry-run=server`: all objects valid.
- `--set networkPolicy.enabled=true`: `triplanner-trips` and
  `triplanner-trips-postgres` NetworkPolicies render and validate.
- `helm upgrade --install triplanner ...`: revision 18, chart 0.6.0 deployed.
- Pods: `triplanner-trips` 2/2 Running (service + rbac-proxy),
  `triplanner-trips-postgres-0` 1/1 Running.
- PVC `data-triplanner-trips-postgres-0` Bound (2Gi).
- `helm test triplanner -n triplanner`: email, locations and trips suites
  Succeeded.
- Trips `/ready`: `{"status":"ready","postgres":"ok","migrated":true,"outbox_pending":0}`.
- Trips DB: 1 trip, 1 member, 9 items, 0 pending outbox.
- `existingSecret` path: `helm template --set tripsService.postgres.auth.existingSecret=trips-db`
  renders no `triplanner-trips-postgres-credentials` Secret.

## 6. Security checks

| Check | Result |
|---|---|
| No published data-store port | PASS — Compose `trips`/`trips-postgres` have no ports; Helm Services are ClusterIP |
| Non-root containers | PASS — trips UID 100; Postgres UID 999; `runAsNonRoot: true` |
| Read-only root filesystem | PASS — both containers; `/tmp` and `/var/run/postgresql` emptyDirs |
| Dropped capabilities / no escalation | PASS — `drop: ALL`, `allowPrivilegeEscalation: false` |
| Internal token by reference | PASS — `triplanner-internal/INTERNAL_TOKEN` |
| Postgres credentials by reference | PASS — `POSTGRES_USER/PASSWORD/DB` secretKeyRefs; no literal in the Deployment |
| Production secret path | PASS — `existingSecret` renders no Secret |
| No secret in logs | PASS — service/Postgres logs contain no credentials |
| Membership checks | PASS — service matrix; `GET /items/{id}` and attachments require membership |
| Attachment HMAC / per-file visibility | PASS — API attachment tests |
| Spanish default / es-en keys | PASS — frontend suite; UI unchanged |
| No preloaded Uber pickup | Not changed by this migration |

Demo-only credentials remain in `values.yaml` and Compose defaults, as
documented in the chart README.

## 7. Defects and known gaps

No P1/P2 defects found.

| Item | Severity | Note |
|---|---|---|
| Base Compose has no broker/email; invites queue in the outbox | P3 | Copyable link works; the local-cluster overlay covers the cluster broker/email |
| Legacy platform trip tables | Resolved | Dropped in M9.11 after the Gate 2 backup; see section 8.1 |
| API is not deployed by the Helm chart | P3 | Pre-existing; the trips workload is verified via probes and `helm test` |
| `networkPolicy.enabled` defaults to false | P3 | Policies render and validate with the flag on |
| macOS clean-clone QA | P3 | Pre-existing limitation |
| Trips image is locally tagged, not published | Resolved | Published as `0.1.0` + `latest`, amd64 + arm64 (section 9) |

## 8. Gate 2 decision and decommission

**Approved 2026-11-21. M9.11 executed.**

Before decommission the rollback path was `TRIPS_MODE=local` plus the untouched
legacy tables. After M9.11 rollback is the previous image/tag plus a database
restore.

### 8.1 Decommission evidence

- Backups:
  - `legacy-trips-20261121-214500.sql` — 21,828 bytes, SHA256
    `CEBE6636...C7798E`.
  - `trips-full-20261121-214500.sql` — 26,848 bytes, SHA256
    `B09F8CCC...C8D58`.
- `backend/db/pg/decommission-trips.sql` applied to the Compose platform DB and
  the test DB. All four `to_regclass` checks return `null`.
- `TRIPS_MODE`, `trips/local.ts`, `pg/trips.ts`, `pg/invitations.ts`,
  `pg/reminders.ts`, the API broker publisher and the local-only tests were
  removed.
- `schema.sql` no longer creates the four tables.
- API suite after decommission: 59 pass, 0 fail (the removed local-only tests
  account for the difference from 82).
- Compose API restarted remote-only; the demo trip still returns 9 items and
  `spent=413`; API logs show only the platform tables.

## 9. Release (M9.12)

| Item | Value |
|---|---|
| Git tag | `v1.3.0` |
| Chart | `helm-triplanner` 0.6.0 (trips image `0.1.0`) |
| Trips image | `marcojr13/triplanner-trips:0.1.0` + `latest`, manifest `sha256:dab280313429f081aeda2f9a71913476a8b580112c6585d779a2b1ad64a419a4`, `linux/amd64` + `linux/arm64` |
| API image | `marcojr13/triplanner-api:1.2.0` + `latest`, manifest `sha256:783b54c2033e85d594c19c2e01e3bb83a9156404ac06cada5e516b6195648ac1`, `linux/amd64` + `linux/arm64` |
| CI | `.github/workflows/trips.yml` (test + multi-arch publish) |
| Hub compose | `trips` + `trips-postgres`; locations pinned to `0.2.1` |

Published-stack smoke with `docker compose -f deploy/docker-compose.hub.yml up
-d --pull always`:

- All eight services healthy.
- API image `marcojr13/triplanner-api:latest`, trips image
  `marcojr13/triplanner-trips:latest`.
- API logs show only platform tables and `trips url=http://trips:4400`.
- `getTrip("demo-trip")` returns 9 items, `spent=413`, no errors.
- Platform `to_regclass('public.trips')` is `null`.

The `marcojr13/triplanner-locations:latest` tag did not exist; it was created
from the published `0.2.1` manifest, and the Hub compose now pins
`LOCATIONS_IMAGE_TAG=0.2.1` so it does not depend on that mutable tag.
