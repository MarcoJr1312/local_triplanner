# Triplanner Local Recruiter Demo — v1.3.0

**Tag:** `v1.3.0`
**Date:** 2026-11-21
**Chart:** `helm-triplanner` 0.6.0

## Highlights

- New **trips microservice** (Bun/TypeScript) owning trips, memberships,
  itinerary items and invitations in its own PostgreSQL 17 database.
- **Transactional outbox** for `email.invite.v1` and
  `email.member.joined.v1`; the email service renders the owner notification.
- **API is remote-only**: `TRIPS_MODE`, the local adapter and the legacy trip
  tables were removed after Gate 2.
- **Compose and Helm**: `trips` + `trips-postgres`, credentials Secret, probes,
  NetworkPolicies, RBAC proxy, Helm test and port-forward helpers.
- **Idempotent legacy import** with key-checksum verification.

## Breaking change

The platform database no longer contains `trips`, `trip_members`, `trip_items`
or `invitations`. The API requires the trips service. Existing deployments must
deploy `trips-postgres`/`trips`, run
`backend/trips-service/scripts/import-legacy.ts`, and point the API at
`TRIPS_URL` before upgrading.

## Images

| Image | Tags | Manifest |
|---|---|---|
| `marcojr13/triplanner-trips` | `0.1.0`, `latest` | `sha256:dab280313429f081aeda2f9a71913476a8b580112c6585d779a2b1ad64a419a4` (amd64 + arm64) |
| `marcojr13/triplanner-api` | `1.2.0`, `latest` | `sha256:783b54c2033e85d594c19c2e01e3bb83a9156404ac06cada5e516b6195648ac1` (amd64 + arm64) |

Hub compose: `IMAGE_TAG=latest`, `LOCATIONS_IMAGE_TAG=0.2.1`.
Helm: chart 0.6.0 with `images.trips.tag=0.1.0`.

## Verification

- API 59, trips 58, email 67, locations 35, frontend 16 tests; typechecks clean.
- Compose demo: seeded trip with 9 items / `spent=413`, invite → preview →
  join, locations-down write succeeds with null coords, trips-down returns
  `TRIPS_UNAVAILABLE` and recovers.
- Helm on Docker Desktop: trips 2/2, trips-postgres 1/1, PVC bound, `helm test`
  passes.
- Published Hub stack: all eight services healthy; demo trip still 9 items /
  `spent=413`; no legacy `trips` table in the platform DB.
- Backups recorded in `docs/migrations/0007-trips-qa.md`.

## Upgrade

1. Back up the platform trip tables and the trips database.
2. Deploy `trips-postgres` and `trips`.
3. Run `backend/trips-service/scripts/import-legacy.ts` with a write freeze.
4. Start the API with `TRIPS_URL` (timeout at least 5 s).
5. After Gate 2, apply `backend/db/pg/decommission-trips.sql`.

See `docs/migrations/0006-trips-service.md` and `0007-trips-qa.md`.
