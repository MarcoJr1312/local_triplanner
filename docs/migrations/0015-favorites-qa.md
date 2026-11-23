# 0015 - User favorites (M12) QA evidence

| Field | Value |
|---|---|
| Status | **QA complete - Gate 2 recommendation: APPROVE WITH CONDITIONS** |
| Cycle | Microservice Code Migration (`19455fa3-28ea-4f03-b195-973c5ddf595e`) |
| Slice | M12 - private favorites moved to the users service |
| Contract | `docs/migrations/0013-user-favorites.md` (Gate 1 approved 2026-11-22) |
| Branch / commit | `feature/user-favorites` / `74c40bc561407ad27aba4bd4bc314ad9e150b7d2` |
| QA owner | Independent QA (no production code, manifests or schema changed) |
| Date | 2026-11-22 local (2026-11-23 UTC) |

> Scope: evidence and defects only. No Orkai status was changed and no human
> decision was requested from this session.

## 1. Environment and revisions

### Compose

| Component | Image / container | Evidence |
|---|---|---|
| Web | `marcojr13/triplanner-web:1.3.0-dev4` (`340a7878487e`) at `http://localhost:3000` | `docker compose images` |
| API | `marcojr13/triplanner-api:1.3.1-dev1` (`5f13d413d406`) at `http://127.0.0.1:4000` | `docker inspect` |
| Users | `marcojr13/triplanner-users:0.1.1-dev1` (`5f5ffd22b5cd`), internal `users:4500` only | `docker ps` (`4500/tcp`, no host mapping) |
| Trips | `marcojr13/triplanner-trips:0.1.1-dev2` (`1c358e17bb3a`) | `docker compose images` |
| Locations | `local_triplanner-locations`, running image `d27cc4b0b844` (untagged; not an M12 artifact) | `docker inspect` |
| Platform DB | `postgres:17` + pgvector at `127.0.0.1:5432` | `docker ps` |
| Users DB | `postgres:17` container `local_triplanner-users-postgres`, internal only | `docker ps` |
| Mongo | `mongo:7` at `127.0.0.1:27017` | `docker ps` |

Compose users DB: `favorite_locations` exists, `schema_migrations` versions
`1` and `2`, two demo favorites (`tor-cn-tower`, `tor-rom`).

### Helm

| Item | Value |
|---|---|
| Release | `triplanner`, namespace `triplanner` |
| Revision | **31** (`deployed`, last deployed 2026-11-22 21:28:19 -05:00) |
| Chart | `helm-triplanner-0.8.0` (`appVersion: 0.5.0`) |
| Users image | `marcojr13/triplanner-users:0.1.1-dev1` |
| Trips image | `marcojr13/triplanner-trips:0.1.1-dev2` |
| Web image | `marcojr13/triplanner-web:1.3.0-dev4` |
| Web entry point | `http://triplanner.localhost` (points at the Compose API `host.docker.internal:4000`) |
| Pods | 9/9 Running; users `/ready` -> `{"status":"ready","postgres":"ok","migrated":true}` |
| Helm users DB | `favorite_locations` exists, `schema_migrations` version `2`; **0 users after the users test suite** (see residual risks) |

### Zero-key demo

    getLlmSettings       -> {"provider":"none"}
    getLocationsSettings -> {"provider":"preloaded"}
    DEEPSEEK_KEY=SET in the agent container (host env), LLM_PROVIDER=none -> unused

The host environment exports a DeepSeek key into the agent container, but the
running demo uses `LLM_PROVIDER=none`. The internal token was not found in the
web bundle or API logs (`grep` of `/app/.next` and `docker logs`); no
`DEEPSEEK_API_KEY` / `LLM_API_KEY` is baked into the agent image config or
committed in the repo (only `LLM_API_KEY=` placeholders in `.env.example`).

## 2. Verification matrix

Legend: **PASS** = observed as specified; **FAIL*** = fails the QA brief but is
explicitly accepted by contract 0013 section 9 (see P3-1); **N/A** = no M12 change.

### 2.1 Users service schema and internal REST

| # | Check | Result | Evidence |
|---|---|---|---|
| 1.1 | `favorite_locations` table, PK `(user_id, location_id)`, FK `users(id) ON DELETE CASCADE`, `idx_favorite_locations_user`, length check 1-128 | PASS | `docker exec local_triplanner-users-postgres psql -U users -d users -c "\d favorite_locations"` |
| 1.2 | `schema_migrations` contains version 2 | PASS | `select * from schema_migrations` -> `1`, `2` |
| 1.3 | No token -> 401; bad token -> 401 | PASS | `GET /internal/v1/users/<demo>/favorites` with no/`wrong` token |
| 1.4 | Missing `x-actor-id` -> `ACTOR_REQUIRED` (401) | PASS | direct route call |
| 1.5 | Other actor cannot GET/PUT/DELETE another user's favorites -> 403 `FORBIDDEN` | PASS | GET/PUT/DELETE with `x-actor-id: demo-friend` on demo path |
| 1.6 | Self GET returns `{items:[{location_id, created_at}]}` | PASS | direct route call returned both legacy IDs |
| 1.7 | Location ID 1-128; 129 chars -> 400 `INVALID_ARGUMENT` | PASS | direct PUT with 129 `x` chars |
| 1.8 | Missing user / bad UUID -> 404 `USER_NOT_FOUND` | PASS | direct GET on unknown UUID and `not-a-uuid` |
| 1.9 | Add/remove idempotent | PASS | Double PUT -> one row, double DELETE -> zero rows, both return success |
| 1.10 | Cascade on hard delete | PASS | SQL transaction: 1 favorite before delete -> 0 after `DELETE FROM users`, rollback |
| 1.11 | Soft-deleted users keep rows | PASS by schema/code | No row deletion on soft delete; FK only fires on hard delete. Not exercised as a live endpoint (hard delete is not exposed) |
| 1.12 | No orphan/duplicate rows | PASS | `total=2`, `distinct_pairs=2`, `orphans=0`, `null_created=0` |

### 2.2 API GraphQL contract

| # | Check | Result | Evidence |
|---|---|---|---|
| 2.1 | Legacy ID `tor-cn-tower` can be favorited; trip item `demo-item-1` `isFavorite: true` | PASS | `getTrip("demo-trip")` returns CN Tower true, ROM true |
| 2.2 | Real catalogue ID `tor-ChIJmzrzi9Y0K4gRgXUc3sTY7RU` (CN Tower) can be favorited; search result true and ranked first | PASS | `favoriteLocation` mutation + `searchLocations(q:"CN Tower")` |
| 2.3 | Unfavorite -> reload -> favorite persists | PASS | API mutation, DB count, `getTrip` before/after; also exercised twice in the browser |
| 2.4 | Another user (`demo-friend`) sees only their own state | PASS | Friend favorites `tor-ChIJmYABitY0K4gRYmJ-246h6qA`; friend search true, demo search false; friend cleanup removed the row |
| 2.5 | No catalogue existence validation remains; `pg/favorites.ts` gone; no API SQL on `user_favorites` | PASS | Bogus ID accepted; `backend/server/src/pg/favorites.ts` and `test/pg-favorites.test.ts` absent; `git grep` shows no API query |
| 2.6 | No catalogue call in favorite mutation | PASS | Locations container stopped; `favoriteLocation("tor-cn-tower")` still succeeded |
| 2.7 | Favorite set fetched once per request | PASS by code inspection | `ctx.favoriteIds` is a request-scoped promise in `resolvers.ts:536-546`; no explicit automated assertion (see P3-7) |
| 2.8 | Users service down: search still returns places with `isFavorite:false` | PASS | `searchLocations` returned 200 with all false while users was stopped; API log `[api] favorite lookup failed; continuing without favorites` |
| 2.9 | Users service down: trip reads still work with favorites false (QA brief) | **FAIL*** | `getTrip("demo-trip")` -> `USERS_UNAVAILABLE` (the users-service timeout message) after ~2 s; no hang. Cause is pre-existing `enrichMembers` dependency, not the favorites resolver. Contract 0013 section 9 explicitly accepts "trip reads fail clearly" |
| 2.10 | Users service down: mutation returns stable error and UI shows localized English toast, not a silent rollback | PASS | `favoriteLocation` -> `USERS_UNAVAILABLE`; browser toast "The users service is unavailable."; heart rolled back to its prior state |
| 2.11 | Invalid/overlong location ID via GraphQL -> stable `FAVORITE_SAVE_FAILED` (English) | PASS | 129-char ID -> `FAVORITE_SAVE_FAILED`, "Couldn't update the favorite." |
| 2.12 | Error codes are stable and localized; no Spanish leak in favorite error toast | PASS | Browser toast in English; `errors.USERS_UNAVAILABLE` / `errors.FAVORITE_SAVE_FAILED` exist in both `en.ts` and `es.ts` |

### 2.3 UI (Compose and ingress)

| # | Check | Result | Evidence |
|---|---|---|---|
| 3.1 | Login `demo` / `demo123` on Compose | PASS | Playwright (`chrome` headless): URL moved from `/login` to `/` |
| 3.2 | Login on Helm ingress `http://triplanner.localhost` | PASS | Same script, same result |
| 3.3 | CN Tower heart toggles off, reload keeps it off, toggles on, reload keeps it on | PASS | DOM `.fav` class and API `getTrip` checked at every step |
| 3.4 | Royal Ontario Museum heart is active and toggles | PASS | `class="fav active"` -> `fav` -> `fav active` |
| 3.5 | Manual activity has no heart | PASS | Added a manual item (`activityId:null`); DOM card has **no** `Add/Remove favorites` button. (Contract section 6 asks for a disabled heart + tooltip; implementation hides it - P3-2) |
| 3.6 | No console errors | PASS | Clean load: `CONSOLE_ERRORS: []`, `FAILED_REQUESTS: []`. During reloads only SSE `/api/graphql` requests end as `net::ERR_ABORTED` (expected subscription teardown) |
| 3.7 | Catalogue search in the Add-activity modal shows the heart state | PASS | Result row for CN Tower showed `Remove from favorites`; adding created an item with `activityId: tor-ChIJ...` |
| 3.8 | Manual item cleanup | PASS | The QA item was removed after every run (`removeItem`) |

### 2.4 Data migration

| # | Check | Result | Evidence |
|---|---|---|---|
| 4.1 | Dry-run against Compose platform DB | PASS | `[favorites] would copy 1/1; invalid_user=0 missing_user=0 invalid_location=0` |
| 4.2 | Apply | PASS | `copied 1/1`; live users count stable |
| 4.3 | Apply re-run is idempotent | PASS | `copied 1/1`; count unchanged; `ON CONFLICT DO NOTHING` |
| 4.4 | Invalid/missing users and overlong IDs are reported, not silently dropped | PASS | Scratch DB with 4 rows -> `would copy 1/4; invalid_user=1 missing_user=1 invalid_location=1`; apply and re-run identical; scratch DB dropped |
| 4.5 | Platform `user_favorites` untouched | PASS | Still exists, 1 row (`tor-rom`); no DROP executed |
| 4.6 | Copy preserves content | PASS | Demo has `tor-cn-tower` and `tor-rom`; no orphans/duplicates. `created_at` changed for rows toggled by QA (expected: remove/re-add sets `now()`) |

Command shape used in the users image:

    docker exec \
      -e LEGACY_DATABASE_URL=postgres://.../triplanner \
      -e USERS_DATABASE_URL=postgres://.../users \
      local_triplanner-users sh -c 'cd /app && bun scripts/migrate-favorites.ts'

`APPLY=1` was added for apply runs. Credentials are the demo Compose
credentials and are not reproduced here.

### 2.5 Decommission readiness

| # | Check | Result | Evidence |
|---|---|---|---|
| 5.1 | Platform `user_favorites` still exists | PASS | `to_regclass('public.user_favorites')` -> `user_favorites`, 1 row |
| 5.2 | No runtime read/write of `user_favorites` in API | PASS | `git grep` finds only `backend/db/pg/schema.sql`, `migrate-users.ts`, migration tests/script and comments |
| 5.3 | `pg/favorites.ts` and its test removed | PASS | Both paths absent |
| 5.4 | Favorites are served only by the users service | PASS | GraphQL and internal search both call `UsersStore.listFavoriteIds` |
| 5.5 | Drop is safe without extra code changes | **CONDITION** | `backend/db/pg/schema.sql:66-74` still creates the table on every API boot (`BOOTSTRAP_LOCAL=1`), so `DROP TABLE` alone is undone on restart. The decommission release must remove the CREATE block and the `migrate-users.ts` reference (P3-3) |

Recommended decommission change set (after Gate 2, API stopped, backup taken):

    -- backend/db/pg/decommission-favorites.sql (new)
    DROP TABLE IF EXISTS user_favorites;

Required in the same change:

1. Delete the `USER FAVORITES` block (`backend/db/pg/schema.sql:66-74`),
   otherwise the next API boot re-creates the empty table.
2. Remove or guard `['user_favorites', 'user_id']` in
   `backend/users-service/scripts/migrate-users.ts:409`.
3. Update stale comments: `schema.sql:8`, `decommission-users.sql:7`,
   `decommission-trips.sql:8`, `backend/server/src/seed.ts:2`.
4. Update `AGENTS.md` (currently says the API "keeps favorites/limits in
   Postgres" and has no M12 entry) and the contract status.

### 2.6 Regression checks

| # | Check | Result | Evidence |
|---|---|---|---|
| 6.1 | Search places (API and UI) | PASS | API returned 3 CN Tower results; UI search form returned the same 3; favorites-first ordering observed |
| 6.2 | Add a catalogue activity | PASS | Add-activity modal created `CN Tower` with `activityId: tor-ChIJ...`; removed afterwards |
| 6.3 | Username invite / notification | PASS | `tripLocalInvite(demo-friend)` -> `notificationId`; friend `myNotifications` showed `unread`; `declineTripLocalInvite` cleaned it up |
| 6.4 | Attachments still work | PASS | Added a 70-byte PNG to `demo-item-1`; served through web proxy and API with 200 `image/png`; tampered `sig` -> 403; removed afterwards |
| 6.5 | English default | PASS | `<html lang="en">`; login and app copy English; `demo`/`demo-friend` login returns `language: "en"` |
| 6.6 | Zero keys / deterministic demo | PASS | `LLM_PROVIDER=none`, `provider=preloaded`; no key in repo/image/bundle/logs |
| 6.7 | es/en switch, routes/Uber deep links | N/A for M12 | Not re-tested; no M12 code touched those paths |

### 2.7 Suites and Helm

| # | Check | Result | Evidence |
|---|---|---|---|
| 7.1 | Users service tests | PASS | `65 pass`, `0 fail`, exit 0 (includes `migration.test.ts` 3/3) |
| 7.2 | API tests | PASS | `69 pass`, `0 fail`, exit 0 |
| 7.3 | Frontend tests | PASS | `32 pass`, `0 fail`, exit 0 |
| 7.4 | TypeScript | PASS | `bunx tsc --noEmit` exit 0 with empty output for API, users, frontend |
| 7.5 | Helm tests | PASS | `helm test triplanner -n triplanner` -> 5/5 suites `Succeeded` (email, locations, trips, users, web) |
| 7.6 | Chart changes in this commit | NONE | `git show --stat 74c40bc` has no `helm/` or `deploy/` files |

## 3. Defects

### P1 - none

No data loss, auth bypass, demo-path breakage or secret leak was found.

### P2 - none

The only matrix row that fails the QA brief is 2.9 (trip reads when the users
service is down). It is **not a regression and not a contract violation**:
`buildTrip` already depended on `enrichMembers` before `74c40bc`, and contract
0013 section 9 explicitly says "trip reads fail clearly". It is tracked as P3-1
so the human can decide whether the stricter QA-brief expectation is required.

### P3 - non-blocking

| ID | Finding | Evidence / impact | Suggested action |
|---|---|---|---|
| P3-1 | Trip reads fail with `USERS_UNAVAILABLE` when the users service is down, instead of degrading to `isFavorite:false` | `getTrip("demo-trip")` failed after the users timeout; search degraded correctly. QA brief expected best-effort trip reads; contract section 9 accepted clear failure | Either accept and document the behavior, or make member enrichment best-effort (separate slice; out of M12 code scope) |
| P3-2 | Manual activity heart is hidden, while contract section 6 asks for a disabled heart with "manual activity" tooltip | `frontend-next/components/ItemCard.tsx:184` renders the heart only when `activityId` exists; browser DOM confirmed no heart. QA brief says "manual activity has no heart", so the demo expectation is met | Update contract section 6 to "no heart" or implement the disabled tooltip |
| P3-3 | Stale docs/comments and missing M12 status | `AGENTS.md:121` says the API keeps favorites in Postgres; AGENTS has no M12 entry; `backend/db/pg/schema.sql:8/66-74`, `backend/server/src/seed.ts:2`, `decommission-users.sql:7`, `decommission-trips.sql:8` still describe platform-owned favorites | Update in the decommission/Gate 2 docs PR |
| P3-4 | Helm chart values are not pinned to the tested M12 images | `values.yaml` still has `users 0.1.0`, `trips 0.1.1`, `web 1.3.0`; the running release uses overrides (`users 0.1.1-dev1`, `trips 0.1.1-dev2`, `web 1.3.0-dev4`). A fresh Helm install from HEAD would not include favorites | Publish final images and pin them in the chart as part of M12.7/v1.5.0 |
| P3-5 | `docs/migrations/README.md:31` links `0014-activity-reminders.md`, which is untracked | `git status` shows `?? docs/migrations/0014-activity-reminders.md`; a checkout of `74c40bc` alone has a broken link | Commit 0014 with its doc or remove the link until the slice lands |
| P3-6 | Migration report labels `copied` as source valid rows, not rows inserted | Re-run prints `copied 1/1` although `ON CONFLICT` inserted 0. Counts are stable and content is correct | Print `inserted` separately, or rename the field to `valid` |
| P3-7 | No automated assertion that the favorite set is fetched once per GraphQL request | Contract section 8 asks for it; code inspection shows the request-scoped promise, but no test counts calls | Add a resolver/remote-store test that spies on `listFavoriteIds` |
| P3-8 | The users test suite (port-forwarded Helm users DB) leaves the cluster users DB empty | `select count(*) from users` in `triplanner-users-postgres-0` -> `0`; `/ready` still true; Helm web currently uses the Compose API so ingress QA passed | Reseed/restart the Helm users deployment before final Helm acceptance; keep test DB separate from demo DB |
| P3-9 | `favoriteLocation` returns the caller's `locationId` untrimmed while storage trims it | Code: `resolvers.ts:1481`; `favoriteLocationId` trims in users service. Only a padded-ID edge case; UI sends clean IDs | Return the normalized `location_id` from the users service |

## 4. Residual risks

### Not tested

- The UI invite dialog and the attachment upload modal were driven through the
  API and component tests, not clicked in the browser.
- The es/en switch and the Google Maps/Uber deep-link routes were not re-tested
  because no M12 code touched them.
- macOS clean-clone, a full Helm-only API cutover, the broker/email path and
  optional LLM providers were outside this slice.
- The single-favorites-fetch guarantee was checked by code inspection, not by
  counting users-service calls at runtime.
- Helm users login was not exercised after the test suite emptied that database.

1. **No real authentication.** The demo trusts `x-user-id`; anyone who can reach
   the published Compose API can impersonate any user, including private
   favorites. This is the documented demo model, not an M12 regression.
2. **Legacy IDs are opaque.** `tor-cn-tower` / `tor-rom` work on trip items but
   cannot match catalogue search results; normalising the demo seed remains a
   separate data task (contract section 2.6).
3. **Users service outage** degrades search but breaks trip reads and favorite
   mutations (`USERS_UNAVAILABLE`), as accepted by contract section 9.
4. **Helm users DB** is empty after the users test suite; reseed before Helm
   acceptance. The ingress demo currently uses the Compose API, so the tested
   path is unaffected.
5. **Chart pinning** is still on pre-M12 tags; the tested images are local/dev
   tags and are not published by this commit.
6. **Platform table recreation**: dropping `user_favorites` without editing
   `backend/db/pg/schema.sql` will recreate it on the next API boot.

## 5. Gate 2 recommendation

**APPROVE WITH CONDITIONS.**

The M12 slice meets every functional contract clause tested on the real Compose
stack and the Helm ingress: schema v2, internal auth/self checks, legacy and
real catalogue favorites, per-user isolation, persistence, removal of the
platform favorites module, idempotent one-time migration, English error toast,
manual-activity behavior, and all suites/typechecks/Helm tests. No P1/P2 defect
was found.

Conditions before merge/tag and before the platform table is dropped:

1. Resolve the QA-brief vs contract discrepancy for users-down trip reads
   (accept/document or schedule a follow-up).
2. Update the stale docs/comments and add the M12 state to `AGENTS.md`; fix the
   `0014` README link.
3. Pin and publish the tested images in chart/values for `v1.5.0` (M12.7);
   re-run Helm acceptance on the pinned tags.
4. Execute decommission only after Gate 2: remove the schema CREATE block,
   `migrate-users.ts` reference and stale comments, then run
   `DROP TABLE IF EXISTS user_favorites;` with a backup.
5. Reseed the Helm users DB before final Helm acceptance.
6. Optional: add the missing "one favorites fetch per request" test and the
   normalized-location-ID response fix.

## 6. Evidence notes

- Commands were run from `C:\Users\macdc\local_triplanner` on Windows with
  PowerShell. Browser evidence used headless Chrome via `playwright-core` in a
  temporary directory; no repository code was modified for testing.
- The users test suite connects to the port-forwarded Helm users Postgres at
  `127.0.0.1:55433`; the Compose users DB is separate and was not reset.
- The platform `user_favorites` table was **not** dropped. Live rows were only
  added/removed through the API for isolation, idempotency and migration tests;
  the demo account was restored to `tor-cn-tower` + `tor-rom` before sign-off.
