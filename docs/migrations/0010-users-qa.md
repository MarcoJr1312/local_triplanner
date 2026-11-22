# 0010 - Users service QA and Gate 2 evidence

| Field | Value |
|---|---|
| Date | 2026-11-22 |
| Slice | M10 users-service migration (M10.2-M10.12) |
| Branch | `refactor/helm-users-service` |
| HEAD | `612c71f` |
| Contracts | `0008-users-service.md`, `0009-users-cutover.md` |
| Environment | Docker Desktop Kubernetes, namespace triplanner, chart 0.7.0, revision 21 |
| Result | Original QA: HOLD. Re-verified at 5e4e419: **APPROVE WITH CONDITIONS** (see section 11). |

## 1. Environment and images

| Item | Observed |
|---|---|
| Kubernetes context | docker-desktop, node desktop-control-plane |
| Helm release | triplanner, chart helm-triplanner-0.7.0, appVersion 0.4.0, revision 21 (deployed) |
| Users image | marcojr13/triplanner-users:0.1.0-dev1 (release override; local tag 0.1.0), digest sha256:c762d22307fb498fa176c04ceaf765aa087f19d4e1e17a885d2ac0d665b5b0dc |
| Trips image | marcojr13/triplanner-trips:0.1.1, digest sha256:8d304dd3db95d2ffa471c0da840512746eee678b2492101274c601862a0c0e09 |
| Other images | email 0.1.1, locations 0.2.1, Kafka 0.1.0, MongoDB 7 |
| Data stores | trips-postgres and users-postgres StatefulSets ready; users schema v1; trips schema v2 |
| Cluster Services | all ClusterIP or headless None; no NodePort/LoadBalancer; DB ports not published |
| Port-forwards | users 4500, trips 4400, locations 4300, users-postgres 5434, trips-postgres 5433 (QA restarted the trips-postgres forward; the initial forward was absent) |
| Local stack | Compose platform Postgres localhost:5432 (fixed UUIDs applied); Compose users service built/started for verification then stopped; API run from source on :4000 with USERS_MODE=remote; web from source on :3100 |
| Test DBs | users postgres://127.0.0.1:55433/users, trips postgres://127.0.0.1:55432/trips |
| Data after QA | users: 2 total / 2 active demo accounts, 0 notifications; trips: 2 trips (demo trip + pre-existing New Test Trip), 9 demo items, 0 orphan/duplicate memberships; platform users: 2 demo rows, all UUIDs |

QA-created users, trips and notifications were removed after the runs. The
pre-existing New Test Trip owned by demo was present before this QA session and
was left untouched.

## 2. Automated suites and typechecks

| Suite | Command | Result |
|---|---|---|
| Users service | `cd backend/users-service && bun test` | 61 pass / 0 fail, 7 files, 250 expects |
| Users migration | `cd backend/users-service && bun test test/migration.test.ts` | 2 pass / 0 fail, 30 expects |
| Users typecheck | `cd backend/users-service && bunx tsc --noEmit` | pass (no output) |
| Trips service | `cd backend/trips-service && bun test` | 65 pass / 0 fail, 5 files, 345 expects |
| Trips typecheck | `cd backend/trips-service && bunx tsc --noEmit` | pass |
| API | `cd backend/server && bun test` | 77 pass / 0 fail, 17 files |
| API typecheck | `cd backend/server && bunx tsc --noEmit` | pass |
| Frontend | `cd frontend-next && bun test` | 22 pass / 0 fail, 3 files, 58 expects |
| Frontend typecheck | `cd frontend-next && bunx tsc --noEmit` | pass |
| Frontend build | `cd frontend-next && bun run build` | pass; /, /login, /join, /trip/[id], /settings, /api/graphql built |

## 3. Verification matrix

Legend: P = pass, F = fail, B = blocked/not testable in this session.

### 3.1 Users service contract

| ID | Criterion | Method | Environment | Result | Evidence |
|---|---|---|---|---|---|
| U1 | /health and /ready unauthenticated | Automated + curl | cluster users 4500 | P | status ok; ready with postgres ok and migrated true |
| U2 | Internal routes reject missing/wrong token | Automated | cluster users | P | 401 UNAUTHORIZED both cases |
| U3 | Create account with username/password/display name, no email | Automated | cluster users | P | 201, email=null, language=es, UUID id, no hash/password in JSON |
| U4 | Duplicate username rejected case-insensitively | Automated | cluster users | P | 409 USERNAME_TAKEN |
| U5 | Login success and failure | Automated | cluster users | P | 200 profile; wrong password and unknown user 401 INVALID_CREDENTIALS |
| U6 | Argon2id hash never returned | Automated + DB | cluster users DB | P | no password_hash/$argon2 in JSON; hashes have argon2id at position 2; 0 plaintext demo123; demo hashes are $argon2id$ (118 chars) |
| U7 | Profile by id/username/email, batch, search | Automated | cluster users | P | all lookups 200; demo email resolves fixed UUID; unknown email 404; batch filters invalid; 201 IDs 400 |
| U8 | Limits: limit=0 rejected, large limit clamped | Automated | cluster users | P | 400 INVALID_ARGUMENT; limit=500 returned <=50 rows |
| U9 | Self profile update; actor mismatch forbidden | Automated | cluster users | P | PATCH self 200; PATCH with x-actor-id=demo 403 FORBIDDEN |
| U10 | Soft delete removes login/search but keeps row | Automated | cluster users | P | DELETE 200; login 401; by-username 404; get-by-id returns deleted_at |
| U11 | Username reuse after soft delete | Automated | cluster users | P | re-create 201 with new UUID |
| U12 | Protected demo UUIDs cannot be deleted | Automated | cluster users | P | demo and demo-friend 403 PROTECTED_USER |
| U13 | Delete unknown user | Automated | cluster users | P | 404 USER_NOT_FOUND |
| U14 | Notification create idempotent per user+invitation | Automated | cluster users | P | first 201, retry 200 same ID; inbox 1 row |
| U15 | Notification ownership | Automated | cluster users | P | owner 200; other actor list 403; other actor get 404; no actor 401 |
| U16 | Read/accepted/declined transitions; no downgrade | Automated | cluster users | P | read -> accepted; accepted + read stays accepted; accepted + declined 400; declined repeat stays declined |
| U17 | Self-invite rejected | Automated | cluster users | P | 400 INVALID_ARGUMENT |

### 3.2 API orchestration and failure modes

| ID | Criterion | Method | Environment | Result | Evidence |
|---|---|---|---|---|---|
| A1 | login proxy, invalid credentials, no hash | Automated | API :4000, cluster users | P | host login returns UUID; bad password INVALID_CREDENTIALS; no hash |
| A2 | listUsers, getUserByUsername, getMyProfile | Automated | API :4000 | P | all resolve the QA host; unknown profile returns null |
| A3 | createUser, duplicate, deleteUser | Automated | API :4000 | P | create UUID; duplicate USERNAME_TAKEN; delete true; login after delete INVALID_CREDENTIALS |
| A4 | deleteUser protected demo | Automated | API :4000 | P | PROTECTED_USER |
| A5 | deleteUser owner guard | Automated | API :4000 + cluster trips | P | USER_OWNS_TRIPS while host owns a trip; delete succeeds after trips removed |
| A6 | deleteUser non-owner member | Automated | API :4000 | P | member delete true; profile has deleted_at; membership remains soft-deleted |
| A7 | tripLocalInvite by username | Automated | API :4000 + cluster users/trips | P | returns invitation/notification; inbox shows inviter username; no hash |
| A8 | tripLocalInvite self/already member/unknown | Automated | API :4000 | P | INVALID_ARGUMENT, ALREADY_MEMBER, USER_NOT_FOUND |
| A9 | myNotifications and markNotificationRead | Automated | API :4000 | P | notification visible; read status returned; other actor NOTIFICATION_NOT_FOUND |
| A10 | acceptTripLocalInvite | Automated | API :4000 | P | guest becomes editor; trip returned |
| A11 | Repeated accept is idempotent (contract section 9) | Automated | API :4000 | F | INVITE_ALREADY_USED instead of returning the trip - D-1 |
| A12 | declineTripLocalInvite and repeat | Automated | API :4000 | P | declined; repeat returns declined |
| A13 | onNotification live subscription | Automated + live SSE | API :4000 and web proxy :3100 | P | repo subscription test passes; live SSE through /api/graphql received onNotification for tripLocalInvite (tripName, status=unread, inviter.username=demo) |
| A14 | Email invite + /join by code regression | Automated | API :4000 + cluster trips | P | sendTripInvite returns code/joinUrl; getTripByCode preview; joinTripWithCode adds demo-friend |
| A15 | Email invite from a new (users-service-only) account | Automated + DB | API :4000 | F | outbox ownerName=DemoUser for host QA Host Updated - D-3 |
| A16 | Notification failure compensates | Automated stub + DB | API :4020 + cluster trips | F | NOTIFICATION_FAILED returned; trip invitation remained pending - D-2 |
| A17 | Users service unavailable maps to USERS_UNAVAILABLE | Automated + live scale-down | API :4010 and :4000 | P | login/inbox/list/profile all USERS_UNAVAILABLE; no platform fallback |
| A18 | Trips service unavailable maps to TRIPS_UNAVAILABLE | Automated + live scale-down | API :4030 and :4000 | P | list, local invite and accept all TRIPS_UNAVAILABLE; no hang |
| A19 | Broker outage does not affect local invites | Automated + live scale-down | API :4000 + cluster broker | P | local invite + accept succeeded with broker replicas=0; outbox count 5 before and 5 after |

### 3.3 Trips service

| ID | Criterion | Method | Environment | Result | Evidence |
|---|---|---|---|---|---|
| T1 | Local invitation create/retry | Automated | cluster trips | P | 201 local, email=null, code=null; retry 200 same ID |
| T2 | join-local and repeat | Automated | cluster trips | P | joined true; repeat joined=false, 200 |
| T3 | Local decline and repeat | Automated | cluster trips | P | declined; repeat declined |
| T4 | Email invitation and join-by-code unaffected | Automated | cluster trips | P | email invitation code + join; outbox rows for email path |
| T5 | Local invite creates no outbox row | Automated + DB | cluster trips | P | local invitation IDs had no outbox payload; broker-down test outbox unchanged |
| T6 | UUID-only references | SQL | cluster trips | P | trips.owner_id, trip_members.user_id, trip_items.created_by, invitations.created_by, invitations.invitee_user_id all 0 non-UUID |
| T7 | Schema v2 applied | SQL | cluster trips | P | schema_migrations versions 1 and 2 |

### 3.4 Fixed-UUID migration

| ID | Criterion | Method | Environment | Result | Evidence |
|---|---|---|---|---|---|
| M1 | Scratch migration dry-run/apply/idempotency | Automated | scratch DBs on 55433 | P | migration.test.ts 2/2 pass, 30 expects; apply rewrites platform/trips/service, second run idempotent |
| M2 | Actual platform users are UUIDs | SQL | Compose platform DB | P | 0 non-UUID users.id; demo IDs are fixed UUIDs |
| M3 | Actual platform reference columns are UUIDs | SQL | Compose platform DB | P | 0 bad values in users, attachments, viewers, favorites, interests, chats, embeddings |
| M4 | Actual cluster trips references are UUIDs | SQL | cluster trips DB | P | 0 bad values in all five reference columns |
| M5 | Demo login after cutover | API | cluster users + API | P | demo/demo123 -> 1111...; demo-friend/demo123 -> 2222... |
| M6 | Dry-run against real migrated DBs | Script | platform + trips + users | P | 2 identities, 0 placeholders, 0 warnings, no writes |
| M7 | Compose platform fixed-UUID references | SQL | Compose platform | P | users table 2 rows, both UUID; no non-UUID reference columns |

### 3.5 Frontend

| ID | Criterion | Method | Environment | Result | Evidence |
|---|---|---|---|---|---|
| F1 | Fresh browser default language is Spanish | Playwright | web :3100, fresh context | F | heading "Sign in", document lang=en - D-4 |
| F2 | Username/password login through the UI | Playwright | web :3100 + API :4000 | P | created account auto-signs in; guest logs in with username/password; API demo/demo123 login also verified (M5) |
| F3 | Create account; session stores UUID/profile only | Playwright | web :3100 | P | account created and signed in; localStorage has no $argon2, password_hash or internal token |
| F4 | Account management, protected demo, owner-delete guard, delete | Playwright | web :3100 | P | demo rows have no delete button; trip-owning delete shows USER_OWNS_TRIPS; delete succeeds after trip delete |
| F5 | Invite modal username tab | Playwright | web :3100 | P | guest receives notification; confirmation text shown |
| F6 | Bell accept and deep link | Playwright | web :3100 | P | accept navigates to /trip/<uuid> and shows the trip |
| F7 | es/en switch | Playwright | web :3100 + API :4000 | P | settings language saved; nav changed to My trips |
| F8 | No preloaded Uber pickup | Code/test | frontend uberLink | P | 8 uberLink tests pass; only destination (+ optional pickup) preloaded; no request action |
| F9 | Browser console clean | Playwright | web :3100 | P3 | one 404, confirmed missing /favicon.ico (pre-existing cosmetic) |

### 3.6 Helm, Compose, security, cluster

| ID | Criterion | Method | Environment | Result | Evidence |
|---|---|---|---|---|---|
| H1 | helm lint | CLI | chart 0.7.0 | P | 1 chart linted, 0 failed (only icon recommendation) |
| H2 | helm template namespaces | CLI | chart 0.7.0 | P | default 36 namespaced kinds / 36 namespace lines; NetworkPolicy enabled 44 / 44; only ClusterRole/ClusterRoleBinding omit namespace |
| H3 | NetworkPolicies render when enabled | Render | --set networkPolicy.enabled=true | P | 8 policies including triplanner-users (ingress API pod, egress users-postgres/DNS) and triplanner-users-postgres |
| H4 | helm test | CLI | release 21 | P | email, locations, trips, users suites all Succeeded (two runs) |
| H5 | Users probes/limits | Render/kubectl | cluster | P | users liveness/readiness on http; resources requests/limits; users-postgres probes/limits |
| H6 | Users pods non-root/read-only/no escalation | kubectl + exec | cluster | P | runAsNonRoot=true, readOnlyRootFilesystem=true, allowPrivilegeEscalation=false; users uid=100, users-postgres uid=999 |
| H7 | Secrets referenced, not committed | git/log/manifest/browser | repo/cluster | P | 0 tracked files contain the internal token; 0 occurrences in logs, rendered manifests, browser storage; token uses existingSecret; .env.fetch is ignored/untracked |
| H8 | No app DB port published | kubectl/docker | cluster + Compose | P | all app DB Services ClusterIP/None; Compose users/trips DBs have no published ports; only web 3000 and dev Postgres/Mongo on 127.0.0.1; QA test DBs 55433/55432 are separate test containers |
| H9 | Rollback path | Helm dry-run | release 21 | P | helm rollback 19 --dry-run=server reports success; revision 19 is last pre-M10 stable (0.6.1); revision 20 is a failed 0.7.0 attempt |
| H10 | Compose users service | docker compose up + curl/login | Compose | P | users + users-postgres built/started; /health 200; demo login 200; no published users port; stopped after test |
| H11 | Hub image availability | Registry | Docker Hub | B/F | docker manifest inspect marcojr13/triplanner-users:0.1.0 -> no such manifest - D-6 |
| H12 | CI smoke covers users/local invites | Repo review | workflows/scripts | P3 | scripts/smoke.* and compose-smoke.yml still omit users/trips and do not test login/local invite; no users.yml workflow |

## 4. Defects

No P1 defect was found in the current runtime. D-3 escalates to P1 after M10.13 if the platform users table is dropped while the code still queries it.

### D-1 - Repeated acceptTripLocalInvite returns INVITE_ALREADY_USED (P2)

- Contract: 0008-users-service.md section 9 says "Accept is idempotent: a repeated call returns the trip; a declined/revoked invitation returns INVITE_ALREADY_USED."
- Reproduction: create a local invite, accept as the invitee, call acceptTripLocalInvite again with the same notification ID.
- Expected: the trip is returned; the trips service already returns joined=false and the aggregate for an accepted invitation with membership.
- Actual: GraphQL error INVITE_ALREADY_USED.
- Evidence: matrix A11; live run api.acceptLocalInvite passed, then api.accept.idempotent-contract expected=trip (contract 9) actual=INVITE_ALREADY_USED. backend/server/test/users-graphql.test.ts also asserts INVITE_ALREADY_USED, so the test codifies the mismatch.
- Impact: double click or client retry shows an error after a successful accept; notification is already accepted. Not data loss.
- Where: backend/server/src/resolvers.ts:895-899 rejects both accepted and declined before ctx.trips.joinLocal. backend/trips-service/src/domain/service.ts:636-647 already supports the idempotent accepted path.

### D-2 - Notification failure compensation leaves the local invitation pending (P2)

- Contract: 0008-users-service.md section 9 says if notification creation fails after the trip invitation is created, the API calls the trips decline route as compensation and returns NOTIFICATION_FAILED.
- Reproduction: run the API with a users-service stub that resolves GET /users/by-username/{username} for a real target but returns 500 on POST /notifications; create a trip owned by a host; call tripLocalInvite. API returns NOTIFICATION_FAILED; query invitations for that trip.
- Expected: invitation declined (or otherwise not pending); API returns NOTIFICATION_FAILED.
- Actual: invitation remains pending (channel local, no notification); compensation call silently fails.
- Evidence: focused run {"host":"ac6798ff-...","comp":"0bcbae60-...","trip":"c21c59f7-...","status":200,"errors":["NOTIFICATION_FAILED"]}; SQL: id=8ab87d82-c575-41a0-8587-54198d025c2f | local | pending | invitee=0bcbae60-... | created_by=ac6798ff-...
- Impact: invisible local invitation until host retries (retry reuses the pending invitation and can succeed once users service is healthy). No notification, no accept path for invitee. Contract compensation guarantee not met.
- Where: backend/server/src/resolvers.ts:877-879 calls ctx.trips.declineLocalInvitation(ctx.currentUserId, tripId, invitation.id) with the host actor, but backend/trips-service/src/domain/service.ts:665-677 requires the actor to be the invitation invitee; catch(() => undefined) hides the failure.

### D-3 - sendTripInvite still reads the platform users table (P2; P1 after M10.13)

- Contract: 0008-users-service.md section 10.3 says sendTripInvite uses ctx.users; section 5 says the users service is the authority for account existence.
- Reproduction: create an account only in the users service (normal createUser path), have it own a trip, send an email invite, inspect the trips outbox payload payload->'payload'->>'ownerName'.
- Expected: inviter display name/language from the users service (QA Host Updated).
- Actual: ownerName=DemoUser, language=es because the platform users query returns no row.
- Evidence: outbox query recipient qa-new-mwrd4rd0433@example.com, owner_name=DemoUser, lang=es; QA host display name was QA Host Updated. Code: backend/server/src/resolvers.ts:1283-1285 still runs SELECT display_name, language FROM users WHERE id = ? against ctx.db (platform Postgres).
- Impact: wrong inviter name in email; after M10.13 drops the platform users table, every email invite from a new account will throw a database error (P1). API tests/Playwright miss this because the demo row exists.
- Where: backend/server/src/resolvers.ts:1283-1285; replace with ctx.users.getUser(ctx.currentUserId) and its language/display_name.

### D-4 - Fresh browser defaults to English, not Spanish (P2)

- Contract: 0008-users-service.md section 11 requires Spanish default with mirrored es/en keys. AGENTS.md says the product UI is Spanish by default with an es/en switch.
- Reproduction: open http://127.0.0.1:3100/login in a fresh browser profile (no triplanner.locale.v2 in localStorage).
- Expected: Spanish login page ("Inicia sesion", lang=es).
- Actual: heading "Sign in", document lang=en. After demo login the UI switches to Spanish because the demo profile language is es, so the unauthenticated entry point is the visible failure.
- Evidence: Playwright ui.spanish-default heading="Sign in" lang=en; source frontend-next/lib/i18n/index.tsx:30-37 returns 'en' and comments "The demo defaults to English; Spanish remains available in settings."
- Impact: recruiter-facing first screen violates the product convention; the es/en switch itself works (F7).
- Note: pre-existing from 6176ac4 (v1.2.0), not introduced by the M10 web commit, but it fails the M10 contract and AGENTS.md and must be fixed or explicitly accepted at the human gate.

### D-5 - GraphQL nullability drifts from the approved contract (P2)

- Contract: 0008-users-service.md section 10.2 specifies UserProfile.email nullable, Member.email nullable, UserProfile.deletedAt, Notification.inviter: UserProfile!.
- Reproduction: create a user with no email through createUser; query getMyProfile { email }; introspect the schema.
- Expected: email=null, deletedAt field present, inviter non-null per contract.
- Actual: email="" (schema still String!), no deletedAt field, inviter nullable (UserProfile).
- Evidence: live GraphQL response create_email="" and profile_email=""; backend/graphql/schema.graphql:81 and :132 still say email: String!; backend/server/src/pg/auth.ts:61-67 returns row.email ?? ''; backend/server/src/schema.ts:165 has inviter: UserProfile (no !).
- Impact: no observed UI break because the frontend treats empty email as blank and guards inviter; strict contract acceptance fails. Fold into a schema/contract amendment or complete the frontend/schema change.

### D-6 - Published Hub stack cannot pull the users image (release blocker, P2)

- Reproduction: docker manifest inspect marcojr13/triplanner-users:0.1.0 (default in deploy/docker-compose.hub.yml:158).
- Expected: published multi-arch manifest for the users image used by the Hub stack.
- Actual: no such manifest: docker.io/marcojr13/triplanner-users:0.1.0. Cluster runs local 0.1.0-dev1 override; there is no .github/workflows/users.yml publish workflow (agent/api/locations/trips/web exist).
- Impact: docker compose -f deploy/docker-compose.hub.yml up -d fails at the users pull, so the published recruiter path is broken. Planned M10.14 work, but must complete before advertising the Hub stack. Regression note: 5e4e419 adds .github/workflows/users.yml; the missing image is now tracked as an M10.14 release condition, not a Gate 2 code defect.

### D-7 - Documentation and smoke scripts stale for M10 (P3)

- README.md:35-36 still says "No Firebase, no password"; README.md:112 says choose Demo without the demo password; README.md:114 says "All six services" although Compose now has eight (web, api, locations, agent, users + four DBs).
- docs/DEMO_TOUR.md:14,49-53 documents only the email invite path; the username tab and bell are not in the tour.
- docs/migrations/0008-users-service.md header still says "Proposed - pending Gate 1"; 0009 says "cluster cutover pending".
- scripts/smoke.sh/smoke.ps1 health list is postgres mongo locations api agent web; it omits users/trips and does not test username login, local invite, notification or fixed-UUID demo identities. .github/workflows/compose-smoke.yml has the same list.
- scripts/port-forward.ps1:10 documents proxy ports 8443/8444/8445/8446 while the script starts 8447 for users; the target list itself includes 4500/8447/5434 correctly.

### D-8 - One cosmetic 404 in the browser console (P3)

- A fresh Playwright run recorded one "Failed to load resource: 404". GET /favicon.ico returns 404; no app/favicon.ico or public/favicon.ico exists. Not M10-specific and not user-visible, but it keeps the console non-clean.

## 5. Failure injection evidence

| Injection | Expected | Observed |
|---|---|---|
| Users deployment scaled to 0 | API returns USERS_UNAVAILABLE, no platform fallback | login error code USERS_UNAVAILABLE; 4500 /health unavailable; restored to 1 and /ready returned ready |
| Trips deployment scaled to 0 | TRIPS_UNAVAILABLE on reads/invite/accept; no hang | listMyTrips and tripLocalInvite returned TRIPS_UNAVAILABLE; acceptTripLocalInvite via API :4030 also TRIPS_UNAVAILABLE; restored to 1 |
| Broker scaled to 0 | local invite/accept still works, outbox unchanged | local invite 200, accept 200, same trip; outbox count 5 -> 5; broker restored and rollout complete |
| Notification stub returns 500 | NOTIFICATION_FAILED and compensation | NOTIFICATION_FAILED; invitation remained pending (D-2) |
| Users URL pointed at dead port (API :4010) | USERS_UNAVAILABLE for login/inbox/list/profile | all four returned USERS_UNAVAILABLE; no demo profile leaked |
| Trips URL pointed at dead port (API :4030) | TRIPS_UNAVAILABLE for list/local invite/accept | all returned TRIPS_UNAVAILABLE |

## 6. Security and data checks

- No secrets in the repository: git grep for the cluster INTERNAL_TOKEN = 0 tracked files; QA password = 0; git status --short clean. backend/.env.fetch exists locally, is ignored by backend/.gitignore and is not tracked; its values are not reproduced here.
- No secrets in logs/manifests/browser: token occurrences in API/users/web logs = 0; in helm get manifest = 0; in browser localStorage = 0; no $argon2/password_hash in browser storage. Users service logs contain no plaintext or hash.
- Password handling: demo and QA accounts hashed with Argon2id ($argon2id$, 118 chars); no demo123 plaintext in password_hash; login errors are 401 and do not reveal account existence.
- Auth failure: missing/wrong internal token -> 401 UNAUTHORIZED; missing x-actor-id on notification reads -> 401; cross-user notification read/list -> 404/403.
- Membership: API and trips both reject non-members (NOT_TRIP_MEMBER); local invite re-checks target membership and editor/owner role.
- Delete guards: protected demo UUIDs rejected by users service and API; owner guard USER_OWNS_TRIPS; non-owner member soft delete allowed and retains membership.
- Cluster hardening: all pods run non-root with readOnlyRootFilesystem, dropped capabilities and no privilege escalation; users uid=100, users-postgres uid=999; DB Services ClusterIP/headless, no NodePort/LoadBalancer.
- Data after cleanup: users 2 active/2 total; notifications 0; trips 2; members 2; orphan members 0; duplicate members 0; demo items 9; platform users 2 UUIDs; non-UUID references 0 in all checked columns.
- Attachments: server suite includes pg-attachments and invite-links tests (77 pass). No M10-specific attachment regression found; users store is used for uploader names and viewer IDs. HMAC expiry itself was not re-timed.

## 7. Not tested / blocked

- Full docker compose -f deploy/docker-compose.yml up --build from a clean volume was not re-run end-to-end. Compose users + users-postgres were built, started, health-checked and demo-login-checked; API/web ran from source against cluster services. The prior M9 Compose acceptance remains the baseline for the rest of the stack.
- The published Hub stack was not run because users 0.1.0 is absent (D-6).
- A real macOS clean-clone was not repeated.
- M10.13 decommission preconditions: backend/db/pg/schema.sql still defines users/notifications; backend/server/src/seed.ts:42-49 still calls ensureLocalDemoUsers in every db:seed, and Compose runs db:seed on boot. Dropping the platform users table without removing these will make the API container fail at boot. Gate seed on USERS_MODE=local and remove the platform tables with the local adapter.
- HMAC attachment URL expiry was not timed; attachment suite covers visibility/signing behavior, not a 15-minute wall-clock expiry.
- Real two-user multi-replica notification fan-out was not tested; API pubsub is single-process by contract.
- Actual Helm rollback was not executed (only dry-run); release stayed at revision 21.

## 8. Gate 2 recommendation (original QA at 612c71f)

Original QA recommendation: HOLD. P2 defects D-1, D-2, D-3, D-4 and D-5 were open; D-6 blocks the published Hub path. Per project rules, P1/P2 defects block sign-off.

Minimum conditions for a later APPROVE WITH CONDITIONS:

1. Fix D-1: repeated accept returns the trip; keep INVITE_ALREADY_USED only for declined/revoked. Add the missing API test (or amend the contract at Gate 1 if the current behavior is intentional).
2. Fix D-2: compensate the local invitation with an actor trips accepts (dedicated internal revoke route or invitee-scoped token); regression test must assert declined after notification failure.
3. Fix D-3: replace the platform users query in sendTripInvite with ctx.users.getUser; preserve display name/language; test with a users-service-only account.
4. Fix D-4 or explicitly accept the English login default at the human gate; contract section 11 and AGENTS.md currently require Spanish.
5. Resolve D-5 by making the GraphQL schema/frontend match the approved contract (nullable email, deletedAt, inviter nullability) or by amending the contract before decommission.
6. Complete D-6 (publish marcojr13/triplanner-users:0.1.0, add users CI/publish workflow) before advertising the Hub compose stack.
7. Update D-7 docs/smoke scripts and M10 status headers; use revision 19 (0.6.1) as the documented rollback target, not revision 20.

If the human gate explicitly accepts D-1..D-5 as residual risk, the residual recommendation is APPROVE WITH CONDITIONS, with D-6 and docs/CI tracked as release blockers rather than code defects.

## 9. Evidence paths

Temporary logs and rendered manifests (outside the repository):

- C:\Users\macdc\AppData\Local\Temp\opencode\m10-api-qa.log - 92-check users/API matrix (91 pass, D-1 fail)
- C:\Users\macdc\AppData\Local\Temp\opencode\m10-ui-qa.log - Playwright account/invite/bell matrix (Spanish default fail, favicon 404)
- C:\Users\macdc\AppData\Local\Temp\opencode\m10-comp-qa.ts - D-2 reproduction
- C:\Users\macdc\AppData\Local\Temp\opencode\m10-sse-qa2.ts - live onNotification SSE through the web proxy
- C:\Users\macdc\AppData\Local\Temp\opencode\m10-migrate-dryrun2.log - real-DB dry-run (2 identities, 0 placeholders, 0 warnings)
- C:\Users\macdc\AppData\Local\Temp\opencode\m10-render.yaml - default Helm render
- C:\Users\macdc\AppData\Local\Temp\opencode\m10-render-np.yaml - render with NetworkPolicies enabled
- C:\Users\macdc\AppData\Local\Temp\opencode\m10-api.log, m10-web.log - source-run API/web logs with no token/password/hash occurrences
- C:\Users\macdc\AppData\Local\Temp\opencode\pw\m10-ui-qa.ts - Playwright test source
- C:\Users\macdc\AppData\Local\Temp\opencode\m10-api-qa.ts - users/API test source

The cluster, Compose and SQL checks above were executed live against the running stack; the commands and observed values are quoted in the matrix. No Orkai task or human-gate decision was changed by this QA run.









## 10. Regression after fixes (5e4e419)

Re-verified on 2026-11-22 against branch `refactor/helm-users-service` at
`5e4e419` (`fix: close M10 users QA defects`). Cluster release is chart 0.7.0
revision 22 with `users 0.1.0-dev1` (digest
`sha256:c762d22307fb498fa176c04ceaf765aa087f19d4e1e17a885d2ac0d665b5b0dc`) and
`trips 0.1.1-dev1` (digest
`sha256:7bbff00deff78f710ed57d6c0bcad11bfd94d64dc43d29eee514d017bd81f344`).
The original matrix in sections 3 and 4 is retained as the pre-fix record.

### 10.1 Suites and build

| Check | Command | Result |
|---|---|---|
| Users | `cd backend/users-service && bun test` | 61 pass / 0 fail, 250 expects |
| Users migration | `cd backend/users-service && bun test test/migration.test.ts` | 2 pass / 0 fail, 30 expects |
| Trips | `cd backend/trips-service && bun test` | 66 pass / 0 fail, 351 expects |
| API | `cd backend/server && bun test` | 78 pass / 0 fail, 17 files |
| Frontend | `cd frontend-next && bun test` | 22 pass / 0 fail, 58 expects |
| Typechecks | all four `bunx tsc --noEmit` | all pass |
| Frontend build | `cd frontend-next && bun run build` | pass; `/icon.svg` route generated |
| Playwright UI | full account/invite/bell smoke on :3100 | 12/12 pass: Spanish default, create account, invite username tab, bell accept, deep link, language switch, protected demo, owner-delete guard, delete account, no secrets, no console errors |
| Helm | `helm lint` + `helm test triplanner -n triplanner` | lint pass; email/locations/trips/users test suites all Succeeded at revision 22 |
| Helm render | `helm template` | 36 namespaced kinds / 36 namespace lines (unchanged) |

### 10.2 Fix-by-fix verification

| Finding | Regression check | Result |
|---|---|---|
| D-1 | Live API: invite -> accept -> repeat accept; separate invite -> decline -> accept | **PASS**: first and retry both returned the trip with 2 members; declined accept returned `INVITE_ALREADY_USED` |
| D-2 | Stub users service returns target but 500s notification; API compensation; DB invitation status. Direct revoke route authorization and repeat. | **PASS**: `NOTIFICATION_FAILED`; invitation status `revoked`; guest revoke 403 `NOT_TRIP_MEMBER`; host revoke 200 `revoked`; repeat 200 `revoked`; join after revoke 409 `INVITE_ALREADY_USED` |
| D-3 | Grep API for users SQL; live email invite from a users-service-only account; outbox ownerName | **PASS**: users SQL remains only in `backend/server/src/users/local.ts`; `sendTripInvite` resolves `ctx.users.getUser`; outbox `ownerName=RG Host` for a new account |
| D-4 | Fresh Playwright context on `/login` | **PASS**: heading `Inicia sesión`, `lang=es`; create account succeeds |
| D-5 | Live `getMyProfile { email deletedAt }`; `getTrip.members.email`; schema/docs | **PASS**: profile email `null`, `deletedAt` field returns `null`, host member email `null`; schema has nullable `UserProfile.email`/`Member.email`, `UserProfile.deletedAt`, nullable `Notification.inviter`; 0008 updated |
| D-6 | Workflow present; Hub image manifest | **PARTIAL / release condition**: `.github/workflows/users.yml` exists with test + amd64/arm64 publish; `marcojr13/triplanner-users:0.1.0` still has no manifest. Treated as M10.14, not a Gate 2 code defect per instruction |
| D-7 | Docs/smoke review | **PARTIAL (P3)**: README/DEMO_TOUR/CICD updated, but README quickstart still says "choose Demo (owner)" and "All six services", and its infra list omits trips/users; CICD lists email.yml although no .github/workflows/email.yml exists; 0008 header still says "Proposed - pending Gate 1" and its section 8/9 still document the old decline compensation instead of the new revoke route; smoke scripts and compose-smoke health list still omit users/trips; port-forward comment still lists 8446 but starts 8447 |
| D-8 | Fresh Playwright console/network; icon route | **PASS**: `/icon.svg` returns `image/svg+xml`; no console errors and no non-2xx responses in the fresh session |

### 10.3 Live regression outputs

- Accept-retry: `first_ok=true`, `retry_ok=true`, `retry_code=null`, `retry_id=2ae3f3c5-...`, `members=2`.
- Declined accept: `INVITE_ALREADY_USED`.
- Revoke: `guest_status=403` / `NOT_TRIP_MEMBER`; `host_status=200` / `revoked`; repeat `200` / `revoked`; join `409` / `INVITE_ALREADY_USED`.
- Compensation: `code=NOTIFICATION_FAILED`; DB invitation status `revoked`.
- Email from new account: `send_code=null` (success), outbox `ownerName=RG Host`.
- Nullability: `profile_email=null`, `profile_deletedAt=null`, `host_member_email=null`.
- UI default: `heading=Inicia sesión`, `lang=es`, session email `null`, no hash/token in localStorage.
- Full UI regression: 12/12 Playwright checks passed (create account, invite by username, bell accept, deep link, language switch, protected/owner/delete guards) with no console errors.

### 10.4 Data and environment after regression

- Users service: 2 total / 2 active demo accounts, 0 notifications (QA regression users hard-deleted).
- Trips service: 2 trips (demo trip + pre-existing New Test Trip), 9 demo items, 0 orphan/duplicate memberships.
- Outbox: 2 pre-existing rows; regression email row removed after verification.
- Cluster pods ready; only ClusterIP/headless Services; no published DB ports.
- API source and web source used for live checks were stopped after verification; cluster port-forwards remain.

### 10.5 Residual regression risks

- Full clean `docker compose up --build` was not re-run end-to-end; the affected suites and Compose users service were verified separately.
- Hub image publishing remains M10.14; the workflow is present but the image is not on Docker Hub.
- HMAC attachment URL wall-clock expiry and actual Helm rollback were not timed/executed (rollback dry-run only).
- M10.13 decommission preconditions remain: platform schema still defines `users`/`notifications`, and `backend/server/src/seed.ts` still calls `ensureLocalDemoUsers` on every `db:seed`; remove/gate these before dropping the platform table.

## 11. Final Gate 2 recommendation

**APPROVE WITH CONDITIONS.** The five code P2 findings from the original QA
(D-1 through D-5) are re-verified as fixed at `5e4e419`; the affected suites,
frontend build, Helm tests and live accept/revoke/compensation checks pass. No
remaining P1 or P2 code defect was found.

Conditions before release / M10.14:

1. Publish `marcojr13/triplanner-users:0.1.0` (and confirm the matching API/web/trips images) with the new `users.yml` workflow before advertising the Hub compose stack. This is a release condition, not a Gate 2 code defect.
2. D-7 was closed after the re-run in the docs/smoke cleanup recorded below; keep the quickstart and smoke scripts current.
3. Track the M10.13 decommission preconditions from section 10.5 (platform schema, seed gating) before dropping platform users/notifications.

Residual risk accepted at the human gate: the full clean Compose one-command stack was not re-run in this regression; HMAC attachment expiry and an actual Helm rollback were not timed/executed; Hub publication remains pending M10.14.

**Original QA record:** the pre-fix matrix in sections 3 and 4 remains the HOLD evidence for `612c71f`; sections 10 and 11 are the post-fix verification and final recommendation.

### 11.1 Gate 2 and M10.13 execution

The human Gate 2 decision was **approve** after the re-verification above.
M10.13 then removed `USERS_MODE`, the local users adapter and the deprecated
`registerUser`/`findUserByEmail`/`inviteMember` paths. The platform
`users`/`notifications` tables were dropped on the Compose database with
`backend/db/pg/decommission-users.sql`; the API now boots from source with
`BOOTSTRAP_LOCAL=1` against the users service and returns the demo profile,
login and trips without any platform users table. Suites after the decommission:
users 61, trips 66, API 70, frontend 22 (all green). M10.14 publication remains.

## 12. Post-report D-7 cleanup (implementation)

After the QA re-run the remaining P3 documentation/test-script drift was closed
without production code changes:

- README quickstart now uses `demo` / `demo123`, lists trips/users databases and
  services, and no longer says "All six services".
- `docs/CICD.md` lists the existing workflows (no `email.yml`) and the users
  workflow/image.
- `docs/migrations/0008-users-service.md` status is updated and the local-invite
  revoke route plus revoke compensation are documented.
- `scripts/smoke.ps1`, `scripts/smoke.sh` and `compose-smoke.yml` include
  trips/users health checks and a users-service login check through the API.
- `scripts/port-forward.ps1` / `.sh` document and start 8447 for users and 5434
  for users PostgreSQL.

These are docs/scripts only; the Gate 2 code verification above is unchanged.

## 13. Regression evidence paths

- C:\Users\macdc\AppData\Local\Temp\opencode\m10-regress.ts - live accept/decline/revoke/compensation/email/nullability regression script
- C:\Users\macdc\AppData\Local\Temp\opencode\m10-regress.ts output - quoted in section 10.3
- C:\Users\macdc\AppData\Local\Temp\opencode\m10-api-regress.log - API source log used for the live checks
- C:\Users\macdc\AppData\Local\Temp\opencode\m10-web-regress.log - Next.js source log used for the UI regression
- C:\Users\macdc\AppData\Local\Temp\opencode\pw\m10-regress-ui.ts - Playwright Spanish-default/icon/create-account regression
- C:\Users\macdc\AppData\Local\Temp\opencode\m10-render-r22.yaml - Helm render at revision 22
- C:\Users\macdc\AppData\Local\Temp\opencode\m10-api-qa.log, m10-ui-qa.log - original pre-fix evidence retained









