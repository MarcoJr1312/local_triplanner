# 0013 — User favorites (users service)

| Field | Value |
|---|---|
| Status | **Approved — Gate 1 (2026-11-22), human instruction: “ok perfect lets execute it”** |
| Cycle | Microservice Code Migration (`19455fa3-28ea-4f03-b195-973c5ddf595e`) |
| Integration branch | `refactor/helm` |
| Work branch | `feature/user-favorites` |
| Owner service | `backend/users-service` (PostgreSQL) |
| API | `backend/server` (GraphQL facade) |
| Client | `frontend-next` (heart on places and trip items) |
| Depends on | M10 users service (fixed UUIDs, remote-only) |

## 1. Summary

Move the private “favorite place” preference out of the platform API
PostgreSQL (`user_favorites`) and into the users microservice. The heart stays a
private, per-user save of a catalogue place; it is not a social like and has no
count. The users service stores opaque location IDs and never calls MongoDB or
the locations service.

This also fixes the current failure: the API validated favorites against the
locations catalogue, so legacy demo IDs such as `tor-cn-tower` were rejected
(“Lugar no encontrado.”) and the trip page silently rolled the heart back.

## 2. Decisions

1. **Private favorite.** One row per `(user, location)`; no counts, no other
   members see it.
2. **Users service owns the data.** The platform `user_favorites` table is
   copied and then dropped.
3. **Opaque location IDs.** The users service does not validate against the
   locations service. The catalogue remains the owner of place data.
4. **One read per request.** The API fetches the caller’s favorite ID set once
   and caches it in the GraphQL context; search and trip-item `isFavorite`
   resolve from that set.
5. **No heart for manual activities.** Only items with an `activityId` can be
   favorited. Failures now surface a localized error instead of a silent
   rollback.
6. **Legacy IDs work.** A favorite of `tor-cn-tower` is stored and shown on the
   trip item even though the current catalogue uses different IDs. Catalogue
   search cannot match it; normalising the demo seed is a separate data task.

## 3. Data model (users service)

```sql
CREATE TABLE IF NOT EXISTS favorite_locations (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  location_id text NOT NULL CHECK (length(location_id) BETWEEN 1 AND 128),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, location_id)
);

CREATE INDEX IF NOT EXISTS idx_favorite_locations_user
  ON favorite_locations(user_id, created_at DESC);
```

- Soft-deleted users keep their favorites; the row is only removed by a hard
  delete (not exposed).
- No foreign key to locations; `location_id` is an opaque reference.

## 4. Users service internal REST

All routes use the existing `INTERNAL_TOKEN`; the API passes the acting user.

| Method | Path | Body | Result |
|---|---|---|---|
| `GET` | `/internal/v1/users/{id}/favorites` | — | `{ items: [{ location_id, created_at }] }` |
| `PUT` | `/internal/v1/users/{id}/favorites/{locationId}` | — | `{ location_id, favorite: true }` |
| `DELETE` | `/internal/v1/users/{id}/favorites/{locationId}` | — | `{ location_id, favorite: false }` |

- `id` must be a UUID and an existing user, otherwise `USER_NOT_FOUND`.
- `locationId` is URL-decoded, trimmed, 1–128 chars.
- Both add and remove are idempotent.
- Add uses `ON CONFLICT DO NOTHING`; remove returns false when nothing existed.
- No catalogue call, no event and no outbox.

## 5. API changes

- `UsersStore` gains:
  - `listFavoriteIds(userId): Promise<Set<string>>`
  - `setFavorite(userId, locationId, favorite): Promise<boolean>`
- `RemoteUsersStore` implements them with the routes above and maps failures to
  `USERS_UNAVAILABLE` / `FAVORITE_SAVE_FAILED`.
- `Resolvers`:
  - `favoriteLocation` calls `ctx.users.setFavorite`; it no longer calls the
    catalogue and no longer throws “Lugar no encontrado.”.
  - A request-scoped `favoriteIds(ctx)` promise fetches the caller’s set once.
  - Catalogue search/activities use the set for `isFavorite`.
  - `TripItem.isFavorite` uses the same set; no per-item database query.
- Delete `backend/server/src/pg/favorites.ts` and `test/pg-favorites.test.ts`.
- Keep the GraphQL contract `favoriteLocation(locationId, favorite)` and
  `isFavorite` unchanged.

## 6. Client changes

- Trip page: when `activityId` is null, do not render an active heart; show a
  disabled heart with the “manual activity” tooltip.
- On a failed mutation, show `toast.error(localizeApiError(...))`; keep the
  optimistic rollback.
- Add `errors.FAVORITE_SAVE_FAILED` (already exists) and an English/Spanish
  message if missing.
- No layout change; the heart keeps its current visual state.

## 7. Cutover and data migration

1. Add the users table and endpoints; deploy users service first.
2. Copy rows from platform `user_favorites` to `favorite_locations` with a
   script that validates UUIDs and reports skipped rows.
3. Switch the API adapter (remote-only; no `FAVORITES_MODE` flag needed).
4. Run the API/user tests and a live heart flow on Compose and Helm.
5. Drop `user_favorites` from the platform schema and remove the migration
   reference from `migrate-users.ts` only after the cutover is accepted.
6. Rollback: revert the API image and keep the platform table until the drop is
   approved; the copy is additive.

The one-time script:
`backend/users-service/scripts/migrate-favorites.ts`.
Inputs: platform Postgres URL, users Postgres URL. It is idempotent
(`ON CONFLICT DO NOTHING`) and prints `copied`, `skipped_missing_user`,
`skipped_invalid_id`.

## 8. Tests and acceptance

- Users service: add/remove idempotency, list, user not found, cascade on hard
  delete, invalid location id, HTTP token enforcement.
- API: remote store paths/headers, resolver uses the users store, no catalogue
  call, favorite set cached once per request, `favoriteLocation` success and
  failure mapping.
- Frontend: heart on a catalogue place; heart on a legacy trip item; manual
  item disabled; failed mutation toast.
- Migration: copy count equals platform count minus invalid rows; re-run is
  idempotent.
- Live: Compose and Helm ingress, demo user favorites `tor-cn-tower`, reloads,
  the heart stays filled; `isFavorite` is true for the trip item.
- Decommission: platform `user_favorites` absent from a fresh schema after the
  cutover; no API code references it.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Legacy IDs do not match catalogue IDs | Store opaque IDs; heart works on the trip item; normalise demo data separately |
| Users service down breaks favorites | `USERS_UNAVAILABLE` surfaced; search still returns places with `isFavorite: false` only if the call is best-effort; trip reads fail clearly |
| Favorite set grows large | One fetch per request; demo scale is small; add a batch endpoint later |
| Data copy misses soft-deleted users | FK to users; skipped rows are reported, not silently dropped |
| Duplicate platform table | Drop only after QA and Gate 2 |

## 10. Rollout

| Stage | Name | Owner |
|---|---|---|
| M12.1 | Contract, ADR and Gate 1 — **done** | PM |
| M12.2 | Users schema, domain and REST favorites | Backend |
| M12.3 | API UsersStore/resolver cutover | Backend |
| M12.4 | Migration script and platform decommission | Backend |
| M12.5 | Frontend heart behavior and errors | Backend |
| M12.6 | Compose/Helm acceptance and QA evidence | QA |
| M12.7 | Gate 2 and release | PM/SRE |

## 11. Exit criteria

- Favorites live only in the users service; the platform table is gone.
- The heart works for catalogue IDs and legacy trip-item IDs, persists across
  reloads and never silently fails.
- Manual activities do not offer a broken action.
- Users/API/frontend suites and live Compose + Helm checks pass.
- Gate 2 recorded before the platform table is dropped in a release.
