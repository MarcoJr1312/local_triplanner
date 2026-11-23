# 0016 - Activity reminders (M13) QA evidence

| Field | Value |
|---|---|
| Status | **QA complete - P2s resolved in 1dc9658; Gate 2 recommendation: APPROVE WITH CONDITIONS (see section 7)** |
| Cycle | Microservice Code Migration (`19455fa3-28ea-4f03-b195-973c5ddf595e`) |
| Slice | M13 - activity reminders (trips config, users inbox, API dispatch, UI) |
| Contract | `docs/migrations/0014-activity-reminders.md` (Gate 1 approved 2026-11-22) |
| Branch / commit | `feature/activity-reminders` / `ce50561d7d9c034e0e702333206d74f99a6427ef` (clean tree) |
| QA owner | Independent QA (no production code, manifests or schema changed) |
| Date | 2026-11-22 local (2026-11-23 UTC, 03:37Z at the end of the run) |

> Scope: evidence and defects only. No Orkai status was changed and no human
> decision was requested from this session. Temporary users, items, reminder
> rows, notifications, memberships and attachments created for this run were
> removed; the demo data is back to its 10-item/2-member baseline.

## 1. Environment and revisions

### Compose

| Component | Image / container | Notes |
|---|---|---|
| Web | local build `sha256:10fbbbdee669` at `http://localhost:3000` | M13 UI present (dialog + notification card) |
| API | local build `sha256:780719e9bfbd` at `http://127.0.0.1:4000` | `REMINDER_SWEEP_MS=3000` (Compose override; committed default is `30000`) |
| Users | local build `sha256:c39c016230e8`, internal `users:4500` only | schema v3, `schema_migrations` 1/2/3 |
| Trips | local build `sha256:cd536ac40b75`, internal `trips:4400` only | schema v3, `schema_migrations` 1/2/3 |
| Locations | `sha256:d27cc4b0b844`, internal `locations:4300` only | used for member enrichment, unchanged |
| Databases | `postgres:17` platform/users/trips, `mongo:7` | users DB is `local_triplanner-users-postgres`; trips DB is `local_triplanner-trips-postgres` |
| Test DBs | trips `127.0.0.1:55432`, users `127.0.0.1:55433` | same servers used by the suites |

Zero-key state (unchanged): `getLlmSettings -> provider=none, demo=true`;
`getLocationsSettings -> provider=preloaded, hasKey=false`; `LLM_PROVIDER=none`
in the agent. No `dev-internal-token` in the web image (`grep -rl` over `/app`
returned nothing) and no `sk-`/password/token lines in the API logs.

### Helm

| Item | Value |
|---|---|
| Release | `triplanner`, namespace `triplanner`, **revision 33** (`deployed`, 2026-11-22 22:11:22 -05:00) |
| Chart | `helm-triplanner-0.8.0` (`appVersion: 0.5.0`) |
| Web image | `marcojr13/triplanner-web:1.3.0-dev5` |
| Users image | `marcojr13/triplanner-users:0.1.1-dev2` |
| Trips image | `marcojr13/triplanner-trips:0.1.1-dev4` |
| Other images | email `0.1.1`, kafka `0.1.0`, locations `0.2.1`, mongo `7`, postgres `17` |
| Entry point | `http://triplanner.localhost` -> ingress at `127.0.0.1:80` with `Host: triplanner.localhost`; points at the Compose API |
| Probes | `/api/health` -> `{"status":"ok"}`; `/api/ready` -> `{"status":"ready","backend":"ok"}` |
| `helm test` | **5/5 suites Succeeded** (email, locations, trips, users, web) |
| Render check | `helm template triplanner helm/helm-triplanner -n triplanner` -> 52 documents, **0** namespaced kinds missing `metadata.namespace: triplanner` |
| Security context | every deployment `runAsNonRoot=true`; containers run as `app`/`node` (non-root) |

`triplanner.localhost` does **not** resolve through Windows DNS on this host.
The ingress was exercised with `curl -H "Host: triplanner.localhost"
http://127.0.0.1/...` and with Chrome
`--host-resolver-rules="MAP triplanner.localhost 127.0.0.1"`.

Tooling: bun 1.4.3 (host and containers), Node 26.13.0, Chrome headless driven
by a temporary `puppeteer-core` install outside the repo (not committed).

## 2. Verification matrix

Legend: **PASS** observed as specified; **FAIL** fails the contract/QA brief;
**N/A** not in this slice. Environment: C = Compose, H = Helm ingress.

### Test mode by area

| Area | Automated evidence | Manual (real-stack) evidence | Environment |
|---|---|---|---|
| 2.1 Trips schema/data | trips `test/db.test.ts` (tables/schema), migration runner tests | `psql` `\d`, counts, cascade probes | C |
| 2.2 Trips REST/domain | trips `test/domain.test.ts` (roles, recipients, time, past due), API schema compile | `curl` internal routes + GraphQL probes | C |
| 2.3 Users notifications | users `test/notifications.test.ts` (create/dedupe/list/invite) | `psql` schema, live rows | C |
| 2.4 Scheduler | API `test/reminders.test.ts` (delivery/dedupe/grace/retry with fake clock) | browser SSE + DB timeline, users-down injection | C |
| 2.5 UI | none (gap P3-6) | Chrome headless against Compose and ingress | C/H |
| 2.6 Failure/security | API retry test; i18n compile-time key parity | stop users, login/error, health, uploads, psql | C/H |
| 2.7 Regression | trips/users/API/frontend suites, `helm test` | invite/accept, favorites, attachments | C/H |
| 2.8 Docs/CI | workflow inspection | `helm template`, `helm test` | H |

### 2.1 Trips schema and data integrity

| # | Check | Result | Evidence |
|---|---|---|---|
| 1.1 | `schema_migrations` has version 3, applied transactionally (`pg_advisory_xact_lock`, one transaction) | PASS | `select version, applied_at from schema_migrations` -> 1, 2, 3 |
| 1.2 | `trip_item_reminders` PK `item_id`, FK `trip_items(id) ON DELETE CASCADE`, FK `trips(id) ON DELETE CASCADE`, `lead_minutes` check (15/30/60/120), `updated_by`, `updated_at` | PASS | `\d trip_item_reminders` |
| 1.3 | `trip_item_reminder_recipients` PK `(item_id,user_id)`, FK `trip_item_reminders(item_id) ON DELETE CASCADE`, nullable `sent_at` | PASS | `\d trip_item_reminder_recipients` |
| 1.4 | Old columns `reminder_enabled`, `reminder_sent`, `reminder_due_at` are gone from `trip_items` | PASS | `information_schema.columns` -> 18 columns, none of the three; `schema.sql` and `import-legacy.ts` updated |
| 1.5 | No stale `recomputeReminder` or old-column reads in the trips service or API | PASS | `git grep` finds only migration/doc text and the unused `computeReminderDueAt` |
| 1.6 | Existing items migrate to "no reminder" (no config rows) | PASS | `select count(*) from trip_item_reminders` -> 0 after migration |
| 1.7 | Demo items have seed start times 10:00/14:00/19:00/09:30/13:00/20:00/11:00/15:30/21:00; the migration only fills NULL values | PASS | DB rows; `003-activity-reminders.sql:35-52` uses `AND start_time IS NULL` |
| 1.8 | Item cascade: config + recipients deleted with the item | PASS | Created a config, `removeItem` -> both tables 0 rows; no orphan configs/recipients (`left join` checks = 0) |
| 1.9 | Trip cascade: configs and recipients deleted with the trip | PASS | Temp trip with 1 config + 1 recipient -> `deleteTrip` -> both 0, item 0 (schema FK `ON DELETE CASCADE`) |
| 1.10 | No duplicates or orphans at the end of the run | PASS | configs 0, recipients 0, orphan configs 0, orphan recipients 0; demo trip 10 items, 2 members |

### 2.2 Trips internal REST / domain contract

| # | Check | Result | Evidence |
|---|---|---|---|
| 2.1 | Internal routes reject a missing/bad token -> 401 `UNAUTHORIZED` | PASS | `GET /internal/v1/reminders/due` and `PUT .../reminder` with no/wrong token |
| 2.2 | Actor-scoped reminder route without `x-actor-id` -> 401 `ACTOR_REQUIRED` | PASS | `PUT .../reminder` without actor |
| 2.3 | `PUT` upsert for owner; GET for viewer returns config with `can_edit=false` and recipient ids | PASS | direct route + GraphQL |
| 2.4 | Viewer `PUT` -> 403 `FORBIDDEN_EDIT`; non-member actor -> `NOT_TRIP_MEMBER` | PASS | GraphQL as `marco` (viewer) and `demo-friend` (non-member) |
| 2.5 | Editor can edit/disable a reminder created by the owner | PASS | temp editor `qa-m13-ed329844` edited item 5 (lead 30) and read `myRole=editor` |
| 2.6 | Lead values 15/30/60/120 accepted; 45 rejected with `INVALID_ARGUMENT`; default 60 in the aggregate | PASS | `CASE lead15/lead30/lead60/lead120`, `CASE lead45-rejected` |
| 2.7 | Recipients: empty -> `REMINDER_RECIPIENTS_REQUIRED`; non-member -> rejected (same stable code, message "All reminder recipients must be current trip members."); viewer is a valid recipient | PASS | `CASE empty/non-member`; item 2 recipients `[demo, marco]` |
| 2.8 | Mandatory start time: item without time -> `REMINDER_TIME_REQUIRED`; with `start_time` the item time is written in the same call | PASS | `CASE missing-time-rejected`, `CASE missing-time-with-start-time` (Twilight item got 12:00, later restored to NULL) |
| 2.9 | Past due -> `REMINDER_TIME_PASSED` (409) and no config written | PASS | Same-day item at 00:01 UTC -> `CASE past-due-rejected`; config count stayed 0 |
| 2.10 | Disable deletes the config and recipients; lead/recipients ignored | PASS | `{enabled:false}` -> 0 config rows across 6 disables |
| 2.11 | Member removal removes the recipient row; config with no recipients is deleted | PASS | Editor removed -> item 5 recipients `[demo]` only; viewer removed from the sole-recipient config on item 6 -> `reminder.enabled=false` and no row |
| 2.12 | Cross-trip item rejected (`ITEM_NOT_FOUND`); SQL-injection-shaped trip/item ids rejected with stable 404, no 500 | PASS | `tripId=compose-smoke` + demo item; `demo-item-1' OR '1'='1`; `demo-trip' OR '1'='1` |
| 2.13 | Due response shape and "unsent only" filter | PASS | `GET /internal/v1/reminders/due?now=2026-12-05T09:00:00.000Z` returned `{items:[{item_id,trip_id,trip_name,item_title,day,start_at,due_at,lead_minutes,recipient_ids}]}`; after `POST .../sent` the same query returned `{items:[]}` |
| 2.14 | `POST /internal/v1/reminders/{itemId}/sent` marks only the listed recipients | PASS | mark-sent 200 `{ok:true}`; `sent_at` set; recipient excluded from later due queries |
| 2.15 | Internal contract casing | **P3-3** | Internal REST is `snake_case` throughout; the contract's due example uses camelCase. The API maps it correctly; documentation-only mismatch |

### 2.3 Users notification v3

| # | Check | Result | Evidence |
|---|---|---|---|
| 3.1 | `schema_migrations` version 3 on the existing DB, no schema errors | PASS | `select version` -> 1/2/3; users log `[users] schema v3 already applied`; service healthy |
| 3.2 | `type` check accepts `trip_invite` + `activity_reminder`; `invitation_id`/`role` nullable; new `item_id`, `item_title`, `start_at`, `lead_minutes`, `dedupe_key` | PASS | `\d notifications` |
| 3.3 | Unique `(user_id, dedupe_key)` index; invite unique `(user_id, invitation_id)` preserved | PASS | `idx_notifications_dedupe`, `idx_notifications_invitation` |
| 3.4 | `activity_reminder` insert requires item/title/start_at/lead/dedupe; lead outside 15/30/60/120 rejected | PASS | users test `rejects an invalid lead time`; live rows |
| 3.5 | Dedupe per user/key returns `created=false` and does not create a second row | PASS | 3 QA notifications; reset `sent_at` and a re-sweep kept the count at 2 for the item; no second `onNotification` |
| 3.6 | Reminder rows have nullable invite fields and are listed through GraphQL (`myNotifications`) | PASS | live rows `invitation_id=null`, `role=null`; inbox UI rendered them |
| 3.7 | Invite regression: local invite -> notification -> accept still works | PASS | temp users invited via `tripLocalInvite`, accepted via `acceptTripLocalInvite`; roles applied; `trip_invite` count back to 14 |
| 3.8 | Existing invite rows unaffected after migration | PASS | 14 `trip_invite` rows with their invitation/role fields intact |

### 2.4 API scheduler and live delivery (C)

| # | Check | Result | Evidence |
|---|---|---|---|
| 4.1 | Owner/editor save creates a config; UI bell flips on without reload | PASS | browser save -> toast "Reminder saved" -> `aria-label="Turn off reminder"` |
| 4.2 | Two-recipient reminder delivered live to both inboxes at due time, through the web SSE proxy, no reload | PASS | demo + marco SSE events at 03:18:01Z for the 03:33Z start (lead 15); one users row per recipient |
| 4.3 | Dedupe key is `activity_reminder:{itemId}:{userId}:{dueAt}` per recipient | PASS | users rows for the live item; identical key on re-sweep |
| 4.4 | Dedupe on a second sweep: clearing `sent_at` re-marks sent but creates no duplicate and publishes nothing | PASS | `sent_at` NULL at 03:25:44 -> re-marked 03:25:48.5; notification count stayed 2; 60 s SSE listener saw no event |
| 4.5 | API restart does not duplicate or re-publish | PASS | API restarted 03:25:05; count unchanged; `due` query returned no unsent recipients |
| 4.6 | 15-minute grace: a reminder late by >15 min is marked sent without a notification | PASS | item moved to 02:45Z (due 02:30Z, about 46 min late) -> `sent_at=03:15:58.669Z`, no notification row, no `onNotification` |
| 4.7 | Users service down: recipients stay unsent, API does not crash, health stays ok, retry after restart | PASS | users stopped 03:19:17; retry item due 03:23Z stayed unsent; 5/5 `/health` calls returned `ok`; users restarted 03:24:26 -> notification created 03:24:31 and `sent_at` set |
| 4.8 | Failure is logged without secrets | PASS | API log `[reminders] could not notify <uuid> for <item>:` followed by the users-service timeout/unavailable message (Spanish); ids only, no token |
| 4.9 | Sweep does not block HTTP/health | PASS | health ok during failed sweeps; normal GraphQL calls unaffected |
| 4.10 | Committed default interval is 30 000 ms; Compose override is 3 000 ms | PASS | `deploy/docker-compose.yml:173`; container env `REMINDER_SWEEP_MS=3000` |
| 4.11 | Single scheduler replica documented; no leader election | PASS by contract/code | `startReminderScheduler` only in `backend/server/src/index.ts`; contract section 6 |

### 2.5 UI - Compose (C) and ingress (H)

| # | Check | Result | Evidence |
|---|---|---|---|
| 5.1 | English is the default locale | PASS | `document.documentElement.lang=en`; English login and trip copy on both entry points |
| 5.2 | Owner bell opens the dialog with activity time, lead and members | PASS (C+H) | dialog text: "Activity time", "Notify before", "15/30/60/120 min before", "Who gets notified", members Demo/Marco/(temp viewer) |
| 5.3 | Time is prefilled from the item; leads are 15/30/60/120 | PASS | `input[type=time].value=10:00`; select options `["15","30","60","120"]` |
| 5.4 | Save works on Compose and on the Helm ingress | PASS (C+H) | toast "Reminder saved"; bell `aria-label="Turn off reminder"`; GraphQL aggregate updated |
| 5.5 | Disable works on Compose and on the Helm ingress | PASS (C+H) | toast "Reminder turned off"; bell `aria-label="Turn on reminder"`; config row deleted |
| 5.6 | Reopening the dialog shows the saved lead | PASS | reopened select value `30` |
| 5.7 | Viewer cannot configure: mutation 403 and disabled bell | PASS | `FORBIDDEN_EDIT`; bell `disabled=true`; no "Turn on/off reminder" buttons |
| 5.8 | Viewer recipient / non-recipient bell text matches contract section 7 | **FAIL (P3-1)** | recipient: `aria-label="Turn off reminder"` (disabled); non-recipient: `"Reminder configured"`; contract asks for a read-only "Reminder set for {time} ({lead} before)" and "Only the owner or an editor..." |
| 5.9 | Reminder notification card: title, "{item} starts at {time}", trip, Open trip | PASS | card text `Activity reminder / QA M13 live reminder starts at 10:33 PM / Fin de semana en Toronto | 15 min before / Read / Open trip` |
| 5.10 | "Open trip" navigates to the trip | PASS | URL `/trip/demo-trip` |
| 5.11 | Card time equals the activity time shown in the itinerary/dialog | **FAIL (P2-1)** | activity 03:33 (trip wall time), card 10:33 PM (device America/Toronto); demo trip timezone is UTC |
| 5.12 | Spanish switch and English restore (settings) | PASS | `lang=es`, "Ajustes"/"Idioma" visible, saved; restored to `lang=en`, profile language `en` |
| 5.13 | No console errors on the touched screens | PASS | Compose + ingress: `[]` (SSE teardown on API restart ends the stream, expected) |
| 5.14 | Mobile/responsive layout | N/A | not exercised; no mobile emulation in this run |

### 2.6 Failure and security

| # | Check | Result | Evidence |
|---|---|---|---|
| 6.1 | Users service down shows a localized English error, no hang | PASS | login attempt -> "The users service is unavailable." in **3021 ms**; no Spanish leak; `errors.USERS_UNAVAILABLE` exists in both dictionaries |
| 6.2 | Users down does not block reminder configuration | PASS | reminder saves use trips only; verified save/disable while the users pod was down |
| 6.3 | No secrets in bundle/logs/manifests | PASS | `grep` of the web image for `dev-internal-token` -> none; API logs contain ids only; no `sk-`/tokens |
| 6.4 | Non-root containers | PASS | Compose users `app`, node web; Helm `runAsNonRoot=true` |
| 6.5 | Internal ports not published (trips/users/locations) | PASS | `docker ps` shows only internal `:4400`, `:4500`, `:4300`; Helm Services are ClusterIP |
| 6.6 | Pre-existing demo port exposure (API 4000, agent 4100, platform Postgres/Mongo on localhost) | Observation | needed by the M11 Helm web / demo; unchanged by M13 |
| 6.7 | Membership checks on reads/mutations | PASS | non-member `getTrip`/reminder -> `NOT_TRIP_MEMBER`; viewer mutation -> `FORBIDDEN_EDIT`; cross-trip item -> `ITEM_NOT_FOUND` |
| 6.8 | Attachment visibility + HMAC expiry | PASS | signed URL 200 (API and web proxy); unsigned URL 403; delete -> 404; `visibility=private`, `viewerIds=[]` |
| 6.9 | SQL injection via ids | PASS | injection-shaped trip/item ids return stable 404s; all queries parameterized |
| 6.10 | No user can configure another trip | PASS | client-supplied `tripId` is checked by the trips service against the item's trip |
| 6.11 | Uber links never preload a pickup | PASS | `LocationDetailModal` passes no `pickup` -> `pickup=my_location`; `uberLink` tests cover it |

### 2.7 Regression

| # | Check | Result | Evidence |
|---|---|---|---|
| 7.1 | Local invite + notification + accept | PASS | temp editor/viewer users invited as editor/viewer, accepted, roles correct, then removed and soft-deleted |
| 7.2 | Favorites heart toggles and persists | PASS | CN Tower `Remove from favorites` -> click -> `Add to favorites` -> DB 0 -> click -> DB 1 (baseline restored) |
| 7.3 | Add activity | PASS (API) | temp items created through `addItem` on the demo trip and a temp trip; UI add modal not re-exercised |
| 7.4 | Attachments upload/read/delete | PASS (API) | 68-byte PNG via `addItemAttachment`; signed 200; unsigned 403; remove -> 404; table back to 0 |
| 7.5 | English default UI | PASS | Section 5.1 |
| 7.6 | `helm test` | PASS | 5/5 suites Succeeded |
| 7.7 | Demo trip seed (10 items, 2 members) and the extra user item with no time | PASS | DB rows; Twilight Cafe `start_time=null` restored after testing |
| 7.8 | Frontend test suite | PASS (32/32) | but no reminder-specific tests (see P3-6) |
| 7.9 | Trips/users/API test suites + typecheck | PASS | trips 67/67, users 67/67, API 73/73, frontend 32/32; `tsc` exit 0 in all four |

### 2.8 Docs, CI and packaging

| # | Check | Result | Evidence |
|---|---|---|---|
| 8.1 | Contract 0014 matches shipped behaviour | Mostly | schema/roles/limits/dedupe/grace/retry match; mismatches are P3-3/P3-4 and the UI P3-1/P3-2 |
| 8.2 | Migration index lists the slice | PASS | `docs/migrations/README.md` lists 0014 |
| 8.3 | AGENTS.md current migration state includes M13 | **FAIL (P3-8)** | `AGENTS.md` ends at M12; no M13 reminder entry |
| 8.4 | Release notes for the M13 release | Pending (expected) | no v1.6.0 notes; M13.7 release step not executed |
| 8.5 | Chart values match the accepted images | **FAIL (P3-9)** | `values.yaml`: users `0.1.0`, trips `0.1.1`, web `1.3.0`, appVersion `0.5.0`; the accepted release uses `users 0.1.1-dev2`, `trips 0.1.1-dev4`, `web 1.3.0-dev5` via `--set` |
| 8.6 | CI workflows for the touched services | PASS by inspection | `.github/workflows/{trips,users,api,web}.yml` run typecheck + `bun test`; not executed on GitHub in this run |

## 3. Defects

### P1

None.

### P2

#### P2-1 - Reminder card time does not match the Toronto itinerary (demo timezone UTC + device-local formatting)

- **Environment:** Compose, demo trip, browser `America/Toronto`.
- **Reproduction:**
  1. `select timezone from trips where id='demo-trip'` -> `UTC` (the seed `INSERT INTO trips` omits `timezone`, so it takes the schema default).
  2. Set an item to a time a few minutes ahead (or use the QA item scheduled at 03:33 UTC) with lead 15 and let the reminder fire.
  3. Read the notification card and compare it with the activity time in the dialog/itinerary.
- **Expected:** contract section 7 - the card says "{item} starts at {time}" with the same time the user set and sees in the itinerary.
- **Actual:** card `QA M13 live reminder starts at 10:33 PM`; activity time `03:33`; the notification `start_at` is `2026-11-23T03:33:00.000Z` and the card formats it in the device zone. For the Toronto demo this is a **5-hour offset** (4 h in summer). A reminder set for the 19:00 ROM fires at 14:00 local and the card says "2:00 PM".
- **Root cause:** the demo trip's `timezone` is `UTC`; user-created trips use the creator's device zone (`NewTripModal.tsx:90`), so only the seeded demo is wrong. The card renders `startAt` in the device zone, which makes the seeded offset visible.
- **Suggested fix:** set `timezone='America/Toronto'` for `demo-trip` in `seed.ts` and in a data migration for existing volumes (only when it is still `UTC`), then re-check the live card. Optionally carry the trip timezone in the due/notification payload and format the card with it, and add a test asserting the card time equals the item `startTime`.
- **Impact:** wrong time in the headline feature on the recruiter demo path. Blocking until fixed or explicitly accepted.

#### P2-2 - Reminder error codes are not localized; the dialog shows the generic error

- **Environment:** Compose UI, any trip/item where `start - lead <= now`.
- **Reproduction:** open the bell on an item, keep lead 60 (due already passed), press **Save reminder**.
- **Expected:** contract sections 7/8 - a message localized by the stable code `REMINDER_TIME_PASSED` (e.g. "The reminder time has already passed; choose a later time or a shorter lead."), mirrored in Spanish.
- **Actual:** `Something went wrong. Please try again.` (`errors.generic`). `errors.REMINDER_TIME_REQUIRED`, `errors.REMINDER_TIME_PASSED` and `errors.REMINDER_RECIPIENTS_REQUIRED` are absent from both `en.ts` and `es.ts`, so `localizeApiError` falls back. The API itself correctly returned `REMINDER_TIME_PASSED`.
- **Evidence:** browser run `pastdue-error-text: ["Something went wrong. Please try again."]`; GraphQL error `REMINDER_TIME_PASSED`; i18n grep.
- **Suggested fix:** add the three `errors.REMINDER_*` keys to `frontend-next/lib/i18n/{en,es}.ts` and a frontend test that maps each stable code.
- **Impact:** no functional block, but a documented error path loses its actionable guidance.

### P3

| ID | Finding | Evidence / repro | Suggested owner |
|---|---|---|---|
| P3-1 | Viewer bell text does not match contract section 7. A viewer recipient sees a **disabled** bell labelled `Turn off reminder`; a viewer non-recipient sees `Reminder configured`; a viewer with the reminder off sees no bell at all. Contract asks for a read-only "Reminder set for {time} ({lead} before)" and "Only the owner or an editor can set reminders". | Live UI: `{"label":"Turn off reminder","disabled":true}` for the recipient, `{"label":"Reminder configured","disabled":true}` for the non-recipient | Frontend |
| P3-2 | "Open trip" goes to `/trip/{id}` without `?day={day}` (contract section 7); the trip page has no day query-param support. | `AppShell.tsx` reminder branch `router.push` to `/trip/${notification.tripId}`; no `useSearchParams` in the trip page | Frontend/PM |
| P3-3 | Contract section 3 declares `uuid` ids; the shipped tables use `text` (consistent with `trips`/`trip_items`). Contract section 4 shows a camelCase due payload; the internal REST is snake_case (the API maps it). | `003-activity-reminders.sql`; due response above | PM (doc) |
| P3-4 | Contract section 5 declares a partial unique index; the shipped index is a full unique index on `(user_id, dedupe_key)`. Postgres treats NULLs as distinct, so the behaviour is equivalent. | `\d notifications` -> `idx_notifications_dedupe` | Backend (doc) |
| P3-5 | `computeReminderDueAt` remains in `backend/trips-service/src/domain/reminders.ts` with no callers; contract section 9 says to reuse it, but the live path uses `wallTimeToUtcIso` with the configured lead. | `git grep computeReminderDueAt` -> definition only | Backend |
| P3-6 | No frontend tests for the reminder dialog, recipient selection, viewer read-only state, live bell, notification card or es/en strings, although contract section 8 lists them. The 32 frontend tests cover health/ready/api/geolocation/server-config/uber only. Manual browser verification is the only evidence. | `frontend-next/**/*.test.ts*` list; no `reminder`/`notification` matches | Frontend |
| P3-7 | Internal `PUT .../reminder` with `"start_time": null` and `enabled=true` clears the item time while keeping the config, so the reminder can never fire. Not reachable through GraphQL (the resolver converts `null` to `undefined`), but it is a robustness hole in the internal contract. | code reading `service.ts:1004-1032`; direct REST only | Backend |
| P3-8 | `AGENTS.md` "Current migration state" stops at M12; the migrations index does not list `0015`/`0016`; no M13 release notes yet (release step pending). | `AGENTS.md:156`; `docs/migrations/README.md` list | PM |
| P3-9 | `helm/helm-triplanner/values.yaml` still points at users `0.1.0`, trips `0.1.1`, web `1.3.0` (appVersion `0.5.0`); a default `helm upgrade` would replace the accepted dev images with services that lack M13/schema v3, and reminders would fail against them. The accepted release uses `--set` dev tags. | `values.yaml:33-43`; `helm template` images; live pods | SRE/PM (M13.7) |
| P3-10 | Expired reminders are silently marked sent; no metric/log distinguishes "expired" from "delivered". The contract does not require it, but the demo has no way to notice a missed delivery. | API log has only failure lines; grace test produced no log | Backend |

## 4. What was not tested and why

- **Mobile/responsive layout** of the new dialog and card: no mobile emulation in this
  run; the layouts were only checked at 1440x1000.
- **Multiple API replicas / leader election:** explicitly out of the contract
  (section 6, one replica). Two replicas would rely on the dedupe key; the publish
  path is guarded by `created=true`, but this was not exercised.
- **A pure Helm-only deployment of the reminders producer:** the chart has no API
  workload (M11 web-only scope). The Helm web points at the Compose API, which is
  where the scheduler runs. A chart-only install cannot dispatch reminders.
- **Long-running scheduling (days)** and a real 15-minute late delivery by wall
  clock: the grace path was exercised by moving an item's time into the past after
  configuring it, and the API unit test uses a fake clock.
- **Load/volume:** only 3 concurrent reminders were swept; no stress test of the
  sweep with many trips/members.
- **Email reminder delivery:** out of contract (section 2.6, in-app only).
- **Vault/External Secrets for Mongo/users/trips credentials:** demo values only;
  production override path was not re-tested.
- **GitHub Actions execution:** the workflows were inspected, not run; all suites
  were executed locally instead.
- **macOS clean-clone QA:** known project-wide limitation (AGENTS.md).

## 5. Residual risks

- The reminder scheduler is a single best-effort loop in the API process; if the
  API is down longer than 15 minutes the reminder is dropped (by design, section 6).
- Inbox rows have no retention policy; activity reminders accumulate in the users
  DB (not part of the contract).
- Notifications are keyed by text `trip_id`/`item_id`; deleting a trip/item leaves
  the reminder card pointing at a missing trip (the users DB intentionally has no
  cross-service FK). The "Open trip" button would land on a 404/empty trip.
- The demo trip timezone remains UTC unless P2-1 is fixed; the offset applies to
  every reminder created on that trip.
- The chart values point at pre-M13 images until M13.7; a default `helm upgrade`
  would deploy incompatible users/trips services.
- The Compose demo publishes the API (`4000`), agent (`4100`) and platform
  Postgres/Mongo on the host; this is pre-existing and needed by the M11 Helm web,
  but it is broader than "only web is published" in AGENTS.md.

## 6. Gate 2 recommendation

> Historical: this was the recommendation at the time of the original report. It is superseded by section 7 after commit 1dc9658 (P2s resolved).

**HOLD - do not merge/tag as-is.** Two P2 defects block sign-off under the QA
rubric:

1. **P2-1** demo-trip timezone / card time (visible wrong time in the demo).
2. **P2-2** missing localized `REMINDER_*` error keys (documented error path).

Both are small: a seed/data change plus an optional card formatting decision, and
three i18n keys with a test. After the fixes, re-run:

- the live two-recipient delivery with a browser in `America/Toronto` and assert
  the card time equals the item start time;
- the past-due save and assert the localized `REMINDER_TIME_PASSED` message;
- the Compose UI save/disable and the ingress save/disable (no regressions);
- the full suites (trips/users/API/frontend + typecheck) and `helm test`.

If the human explicitly accepts device-local time with the UTC demo trip as a
known demo limitation, P2-1 can be downgraded to P3 and the slice becomes
**APPROVE WITH CONDITIONS** with the remaining conditions:

- fix P2-2 (three i18n keys + test);
- at M13.7: publish the M13 images (`web`, `api`, `users`, `trips`) and bump
  `helm/helm-triplanner/values.yaml` + `appVersion` + release notes, then re-run
  `helm test` and the published-stack smoke;
- schedule the P3 items (viewer bell labels, `?day` deep link, frontend component
  tests, AGENTS/README updates) as follow-ups.

**No Orkai status was changed by this session; the decision is the human's.**
## 7. Post-QA resolution (commit 1dc9658)

| Field | Value |
|---|---|
| Re-verification commit | `1dc9658030745acd973d72ac377c851a0523121b` |
| Date | 2026-11-22 local (2026-11-23, about 03:58Z) |
| Compose | trips and web rebuilt (`trips sha256:9a77ff87...`, `web sha256:8b532dce...`); API `sha256:780719e9...` and users `sha256:c39c0162...` unchanged |
| Helm | release revision **34**; users `0.1.1-dev2`, trips `0.1.1-dev5`, web `1.3.0-dev6` |
| Suites | trips 67/67, users 67/67, API 73/73, frontend **33/33**; `tsc` exit 0 in all four |
| Helm test | **5/5 suites Succeeded** |
| Verdict | **Both P2 defects resolved; no P1/P2 remain.** Gate 2 recommendation updated to **APPROVE WITH CONDITIONS** (section 7.6) |

### 7.1 P2-1 timezone - RESOLVED

| # | Check | Result | Evidence |
|---|---|---|---|
| 7.1.1 | Compose demo trip uses the Toronto timezone and schema v4 | PASS | `select timezone from trips where id='demo-trip'` -> `America/Toronto`; `schema_migrations` -> 1, 2, 3, 4 |
| 7.1.2 | Helm demo trip uses the Toronto timezone and schema v4 (trips `0.1.1-dev5`) | PASS | `kubectl exec triplanner-trips-postgres-0 ...` -> `America/Toronto`; versions 1-4 |
| 7.1.3 | CN Tower 10:00 with 60-min lead computes the Toronto instant | PASS | Compose and Helm internal due endpoint (now `2026-12-04T14:30Z`) both returned `start_at=2026-12-04T15:00:00.000Z`, `due_at=2026-12-04T14:00:00.000Z`; a query at `13:30Z` returned `{items:[]}` |
| 7.1.4 | Live reminder with a Toronto wall time reaches both recipients without reload | PASS | Item `7025526e...` day `2026-11-22` time `23:05` (Toronto) -> `start_at=2026-11-23T04:05:00Z`, `due_at=03:50Z`; demo and marco SSE events at `03:50:01Z` through the web proxy; 2 users rows with `start_at` = `2026-11-23 04:05:00+00` |
| 7.1.5 | Notification card shows the same wall time the editor set | PASS | Browser in `America/Toronto`: `QA M13 live Toronto starts at 11:05 PM`; item `startTime` = `23:05`; `start_at` = `04:05Z` |
| 7.1.6 | Dedupe after a reset `sent_at` (second sweep) | PASS | Count 2 before and after; `sent_at` re-marked `03:50:28.562Z`; no extra SSE event |
| 7.1.7 | No timezone regression to other trips or demo data | PASS | Only `demo-trip` is `America/Toronto`; the other four trips remain `UTC`; demo trip still 10 items, 2 members and the original seed times; 0 reminder configs after cleanup |

**P2-1 closed.**

### 7.2 P2-2 localization - RESOLVED

| # | Check | Result | Evidence |
|---|---|---|---|
| 7.2.1 | English and Spanish keys exist for the three reminder codes | PASS | `en.ts`/`es.ts` add `errors.REMINDER_TIME_REQUIRED`, `errors.REMINDER_TIME_PASSED`, `errors.REMINDER_RECIPIENTS_REQUIRED` |
| 7.2.2 | Past-due dialog shows the specific English message, not the generic error | PASS | Temp trip/item day `2026-11-23`, start `00:01`, save with lead 60 -> `That reminder time has already passed. Choose a later time or a shorter lead.`; zero console errors |
| 7.2.3 | Frontend mapping test | PASS | frontend `33/33`; the new test asserts `localizeApiError` maps all three codes to `errors.<CODE>` |
| 7.2.4 | Cleanup | PASS | Temp trip `350643ef...` and its item deleted; Compose trips back to 5; 0 reminder configs |

**P2-2 closed.**

### 7.3 P3 fixes verified

| ID | Post-fix state | Evidence | Status |
|---|---|---|---|
| P3-1 | Viewer bell labels no longer imply a control the viewer can use | marco session, Compose: reminder recipient -> `Reminder configured` (disabled); non-recipient with an active reminder -> `Only the owner or an editor can set reminders` (disabled); item with no reminder -> no bell; no `Turn on/off reminder` labels; 0 console errors | **Closed** (see residual wording in 7.5) |
| P3-2 | Contract now documents the shipped `/trip/{id}` link (no `?day`) | `docs/migrations/0014-activity-reminders.md` diff | Closed (doc) |
| P3-3 | Contract uses `text` ids and snake_case due payload | Contract section 3/4 diff; live due payload | Closed (doc) |
| P3-4 | Contract describes the full unique `(user_id, dedupe_key)` index | Contract section 5 diff; `\d notifications` | Closed (doc) |
| P3-5 | Dead `computeReminderDueAt` removed; only `wallTimeToUtcIso` remains | `backend/trips-service/src/domain/reminders.ts` diff; `git grep computeReminderDueAt` -> none | Closed |
| P3-6 | Error-code mapping test added; dialog/viewer/live-bell UI still only manually verified | frontend `33/33`; new `maps the reminder validation codes`; no component tests for `ReminderDialog`/`AppShell` | **Partially closed** |
| P3-7 | Internal `start_time: null` edge unchanged | code unchanged; GraphQL still converts `null` to `undefined` | Open (P3) |
| P3-8 | `AGENTS.md` still ends at M12; index still omits 0015/0016; no M13 release notes | `git show --stat 1dc9658` does not touch AGENTS/README/release notes | Open (P3) |
| P3-9 | Chart `values.yaml` still points at pre-M13 tags (release step) | `helm template` images users `0.1.0`, trips `0.1.1`, web `1.3.0`; the live release uses `--set` dev tags | Open (P3, M13.7) |
| P3-10 | Expired reminders still silent (no log/metric) | no change | Open (P3) |

### 7.4 New environment finding during re-verification - P3-11 (trips test isolation)

The trips suite default is `postgres://trips:trips@127.0.0.1:55432/trips`
(`backend/trips-service/test/helpers/pg.ts`). Port `55432` on this host is a
`kubectl port-forward svc/triplanner-trips-postgres 55432:5432`, i.e. **the Helm
trips database, not a dedicated test database**. `resetSchema()` drops
`outbox, invitations, trip_items, trip_members, trips, schema_migrations
CASCADE`, so running the suite resets the Helm demo data.

Observed during this run:

- Before the suites: Helm `trips` DB had `demo-trip`, 9 items and timezone
  `America/Toronto`.
- After the suites: the Helm DB had a single fixture trip `Toronto` (owner `u1`,
  members `u1`/`u2`, 2 invitations), **0 items**, 0 reminders; the trips pod logged
  `outbox tick error: relation "outbox" does not exist` from 03:53:24Z.
- The chart `helm test` hooks are non-destructive (busybox `wget` on `/ready`); the
  reset came from the local service suite, not the chart hook.
- The Helm web points at the Compose API, so the ingress demo path was unaffected.
- Restore: deleted the fixture trip and ran
  `kubectl rollout restart deploy/triplanner-trips`; the pod re-applied the seed
  (`demo seed: 9 items in demo-trip`), schema v4, timezone `America/Toronto`,
  0 reminder configs, no outbox errors, and `helm test` was 5/5 again.

**Recommendation:** give the trips suite a dedicated `trips_test` database (the
same fix M12 applied to users on `55433`), or remove the port-forward before running
the suite. This is a QA/acceptance environment issue, not an M13 code defect, but it
must not be repeated during the final Helm acceptance.

### 7.5 Remaining P3 after re-verification

- **P3-1 residual:** the recipient viewer tooltip is `Reminder configured`, not the
  contract's literal "Reminder set for {time} ({lead} before)". No false affordance
  remains; cosmetic wording only.
- **P3-6:** no component tests for the dialog, recipient selection, viewer read-only
  state, live bell update or notification card; the error-mapping test is the only
  new frontend coverage.
- **P3-7:** internal `start_time: null` with `enabled=true` can still clear the item
  time while keeping the config (not reachable from GraphQL).
- **P3-8:** AGENTS.md, the migrations index and release notes are not updated for M13.
- **P3-9:** chart `values.yaml`/`appVersion` still point at pre-M13 images.
- **P3-10:** expired reminders are not observable.
- **P3-11:** trips test suite uses the Helm database (section 7.4).
- **Process note:** contract 0014 was edited after Gate 1 (text ids, snake_case,
  full index, no `?day`, Toronto timezone) to match the shipped implementation.
  Record a Gate 1 re-approval if the process requires one.

### 7.6 Updated Gate 2 recommendation

**APPROVE WITH CONDITIONS.** No P1 or P2 defects remain; both original P2s were
reproduced against the old build and verified fixed in `1dc9658` on both Compose and
Helm.

Conditions:

1. **M13.7 release step:** publish the M13 images (`web`, `api`, `users`, `trips`)
   and bump `helm/helm-triplanner/values.yaml`, `appVersion` and the release notes;
   re-run `helm test` and the published-stack smoke. Until then the chart defaults
   still deploy pre-M13 services.
2. **Test isolation before final Helm acceptance:** move the trips suite to a
   dedicated `trips_test` database (or stop the 55432 port-forward) and re-seed the
   Helm trips deployment after any suite run. The Helm demo data was restored in this
   run (`demo-trip`, 9 items, `America/Toronto`, schema v4, 0 reminders).
3. **Optional P3 follow-ups:** component tests for the reminder UI, AGENTS/README/
   release notes, expiry observability, the exact recipient tooltip wording, and the
   internal `start_time: null` guard.

No Orkai status was changed by this session; the Gate 2 decision is the human's.