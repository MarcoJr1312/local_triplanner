# 0018 - M14 agent pgvector sync + prompt enrichment: QA evidence

| Field | Value |
|---|---|
| Status | **Post-QA complete - APPROVE WITH CONDITIONS (no P1/P2; P2-1..P2-5 fixed)** |
| Cycle | Microservice Code Migration (19455fa3-28ea-4f03-b195-973c5ddf595e) |
| Slice | M14.7 - acceptance, failure injection and QA |
| Contract | 0017-agent-service.md (header still says Proposed - pending Gate 1) |
| Branch / commit | feature/agent-pgvector @ 4b89ec8 (2026-11-23 11:47:02 -0500) **plus 3 uncommitted files** |
| Runtime | Compose project local_triplanner; Helm release triplanner rev 42 in namespace triplanner |
| Chart | helm-triplanner 0.11.0 / appVersion 1.6.0 |
| QA window | 2026-11-23 16:50-17:15 UTC (11:50-12:15 EST) |
| Evidence date | 2026-11-23 |

## 0. Verdict

The M14 functional core works on both stacks: locations versioning/outbox, the
agent's pgvector snapshot/consumer/reconcile, tombstones and stale/duplicate
rejection, weak-prompt enrichment, auto-suggest/suggestions/day-plan through
the Helm ingress, and the Helm agent's security posture all passed.

Sign-off is **blocked** because:

1. the deployed images do **not** match commit 4b89ec8 (three dirty files that
   change runtime behaviour);
2. the documented locations-down fallback does not hold on the demo trip
   (auto-suggest returns 502 BACKEND_ERROR);
3. the Helm interest-sync path is split-brain (setMyInterests updates the
   Compose agent, never the Helm agent);
4. the published-image stack deploy/docker-compose.hub.yml was not updated for
   the dedicated agent database/broker and will break on the next image publish.

All four are P2. No P1 was found (no data loss, auth bypass, secret leak or
broken default clone path).

## 1. Environment and artifacts

| Item | Observed |
|---|---|
| Working tree | M backend/agent-service/src/tripsuggest/enrichment.py, M .../vector_store.py, M backend/locations-service/src/catalogue/mongo.ts |
| Compose images | local_triplanner-agent:latest sha256:497cd76a798f built 16:47:45Z; local_triplanner-locations:latest sha256:83ebfffc43e8 built 16:47:28Z |
| Helm images | agent marcojr13/triplanner-agent:1.6.0-dev4 (= 497cd76a798f), locations 0.2.2-dev3 (= 83ebfffc43e8), web 1.3.0-dev6, trips 0.1.1-dev5, users 0.1.1-dev2 |
| Registry | docker manifest inspect reports **no such manifest** for triplanner-agent:1.6.0-dev4 and triplanner-locations:0.2.2-dev3; Helm images are local-only |
| Compose files in use | deploy/docker-compose.yml + frontend-helm.yml + local-cluster.yml (project lists three files) |
| Compose agent DB | agent-postgres (pgvector/pgvector:pg17), private port |
| Helm agent DB | triplanner-agent-postgres-0, PVC 2Gi, headless ClusterIP |
| Compose broker | kafka:8080, private; 203 LocationChanged messages, consumer agent-locations next offset 204 |
| Platform Postgres | legacy agent_embeddings 189 rows, last write 2026-11-22 05:40Z; agent_index_state last write 2026-11-14 - no M14 writes |
| Seed | 186 places + 1 destination in Mongo; agent active places 186 on both stacks |

## 2. Pass/fail matrix

Legend: **PASS** = criterion met and evidenced; **FAIL** = criterion not met;
**PARTIAL** = core works but a documented sub-criterion does not; **N/T** = not
tested, reason in Section 8.

### 2.1 Locations contract (M14.2)

| ID | Criterion | Result | Evidence |
|---|---|---|---|
| L1 | version exists and starts at 1; content_hash is canonical | PASS | 186 places all version:1, 64-hex content_hash; destination toronto v1 |
| L2 | Version increments only on real content change | PASS | Temp place qa-m14-1795452729: create v1; identical POST stayed v1 with identical last_updated; changed POST v2; same-content seed re-run stayed v1 |
| L3 | Seed re-run emits no duplicate events | PASS | POST /internal/v1/seed -> {"seeded":187}; outbox 0, unpublished 0, all docs still v1, broker message count unchanged |
| L4 | Outbox row is written for create/update/delete/recreate | PASS | 5 outbox rows for the QA id (v1 create, v2 update, v3 delete, v4 recreate, v5 delete), all published_at set, attempts:0 |
| L5 | Publisher marks published / retries on failure | PASS | Normal: published_at set within ~1 s. Broker down: attempts:4, published_at:null, last_error; after broker start published_at set at attempt 5 |
| L6 | Broker envelope: topic/key/value, delete carries no body | PASS | Topic LocationChanged, key location:<id>; v3/v5 messages deleted:true, location:null, locationId present |
| L7 | Delete route is internal-token protected; not browser-reachable | PASS | No token -> 401 {"error":"UNAUTHORIZED"}; wrong token -> 401; 4300 not published |
| L8 | Delete event and recreate gets a higher version | PASS | Delete -> v3 tombstone; recreate -> v4 active; versions counter {_id: qa..., version:5} after cleanup delete |
| L9 | Retry backoff | **PARTIAL** | Contract Section 4.2 says backoff; publisher retries every ~1 s with no delay/backoff (attempts:4 in 15 s) |

### 2.2 Agent database and consumer (M14.3/M14.4)

| ID | Criterion | Result | Evidence |
|---|---|---|---|
| A1 | Schema/extension/table/index created idempotently | PASS | vector extension; agent_embeddings columns/check; HNSW index; agent_sync_state; no agent_index_state |
| A2 | Index definition matches contract | **PARTIAL** | idx_agent_embeddings_destination lacks the WHERE deleted=false predicate (contract Section 5) |
| A3 | agent_sync_state records all four keys | **PARTIAL** | Only bootstrap_complete, last_snapshot_at; last_event_at/last_event_offset are in memory only and reset on restart |
| A4 | Snapshot count and no destination rows | PASS | Compose 186 active; Helm 186 active; active rows with empty category = 0. One legacy toronto tombstone remains from an earlier build that indexed the destination |
| A5 | Event update/delete applied | PASS | Compose and Helm: create v1 -> row v1, update v2 -> row v2, delete v3 -> deleted=true, source_version=3 |
| A6 | Stale/duplicate events ignored | PASS | After v2, a direct v1 event left name/version unchanged; a duplicate v2 with a different name also left v2 unchanged |
| A7 | Tombstone rejects stale upsert | PASS | After delete v3, a direct v1 event did not resurrect; recreate v4 did |
| A8 | Reconcile tombstones missing IDs | PASS | Injected orphan qa-m14-orphan v9; restart -> tombstoned v10; active count 186; no duplicate rows |
| A9 | Restart/reconcile has no duplicates and keeps offsets | PASS | Two agent restarts: 186 active, row count stable, broker offset advanced, no replay duplication |
| A10 | Malformed event is terminal, consumer continues | PASS | Missing location -> dropping invalid location event; unknown type -> ignored; both acked (offset 202/203); next valid events still processed |
| A11 | /ready 200 only with DB + bootstrap | PASS | Normal 200; agent-postgres stopped -> 503 {"status":"not_ready","db":"down",...}; /health remains 200; recovery 200 |
| A12 | /ready reports locations/broker degradation | **FAIL** | No locations/broker fields. With locations down, /ready still returned 200 and last_error:null (reconcile only every 300 s) |
| A13 | Metrics exposed | **FAIL** | No /metrics endpoint or counters; contract Section 5.1 mentions metrics |

### 2.3 End-to-end event flow and failure semantics

| ID | Criterion | Result | Evidence |
|---|---|---|---|
| E1 | Compose: locations POST -> broker -> agent vector row | PASS | Temp id v1 row appeared in agent_embeddings ~0.6 s after POST |
| E2 | Compose: delete -> tombstone | PASS | Row deleted=true, source_version=3; active 186 |
| E3 | Helm: locations POST -> Helm broker -> Helm agent | PASS | qa-m14-helm-1795453261 v1 -> v2 -> tombstone v3; Helm outbox 187 rows, all published |
| E4 | Broker down: outbox retries, agent serves last index, then catches up | PASS | Outbox unpublished with attempts; auto-suggest 200; after broker start row v1 arrived; delete tombstone v2 |
| E5 | Locations down: agent serves last index, enrichment skipped | **PARTIAL** | Agent-only search_with_enrichment returned 5 results and logged locations enrichment skipped; but the product path (auto-suggest/suggestions) returned 502 {"error":{"code":"BACKEND_ERROR","message":"El catalogo no esta disponible."}} because the Compose API trip-context needs locations for demo-trip coords |
| E6 | API/web degrade without data loss | PASS | 502/500 responses; demo trip/users/interests unchanged after all injections |
| E7 | Duplicate/out-of-order events | PASS | See A6/A7 |
| E8 | Agent DB down: /ready 503, no trip data loss | PASS | 503 body db:down; auto-suggest 500; demo data intact; recovery 200 |

### 2.4 Prompt enrichment (M14.5)

| ID | Criterion | Result | Evidence |
|---|---|---|---|
| R1 | Weak match -> exactly one locations search | PASS | Deleted Casa Loma row; instrumented search_with_enrichment("Casa Loma") -> 1 call, log locations enrichment q='Casa Loma' extra=1, row restored, active 186 |
| R2 | Enriched results indexed and re-queried once | PASS | Returned top-5 included the restored row; call count 1; live POST /api/agent/suggestions answered with Casa Loma and row reappeared |
| R3 | Strong score skips enrichment | PASS | Full CN Tower document (score 100) -> 0 calls; a deleted unrelated row stayed missing; live endpoint 200 and row stayed missing |
| R4 | Auto-suggest never enriches | PASS | Deleted ROM row, POST /api/agent/auto-suggest -> 200, 5 items, ROM row still missing |
| R5 | Realistic "strong" prompts skip | **PARTIAL** | Exact-name prompts score below 60: CN Tower 43, Royal Ontario Museum 38, Casa Loma 29; each triggered one locations search. Only near-verbatim document text scores >=60. Every recruiter-style prompt therefore calls locations once |
| R6 | 8 s timeout | N/T | Locations is local and fast; no slow endpoint injected |
| R7 | One call per request, max 20 | PASS | Log shows limit=20; AGENT_ENRICH_LIMIT=20; code path has a single _locations.search |

### 2.5 UI/API and interests (M14.5/M14.6)

| ID | Criterion | Result | Evidence |
|---|---|---|---|
| U1 | Compose auto-suggest | PASS | 200, 5 items, scores present |
| U2 | Compose suggestions (chat) | PASS | 200, deterministic demo answer with suggestions block |
| U3 | Ingress auto-suggest / suggestions / day-plan -> Helm agent | PASS | 200/200/200; Helm agent access log shows the POSTs from the web pod; web env NEXT_PRIVATE_AGENT_URL=http://triplanner-agent:4100 |
| U4 | English default | PASS | html lang="en"; dictionaries en.ts/es.ts; default en in I18nProvider |
| U5 | es/en switch | N/T | Client-side localStorage switch; no headless browser in this run. Code inspection only |
| U6 | Deep links / routes | PASS | /, /login, /trip/demo-trip, /settings, /search, /calendar -> 200 through ingress |
| U7 | Interests reach the agent that serves the web | **FAIL** | setMyInterests(["food","museums","views","nightlife"]) via ingress -> platform 4, Compose agent 4, Helm agent still 3; no /internal/interests/sync POST in Helm agent log. The Compose API AGENT_BASE_URL=http://agent:4100 targets the Compose agent |
| U8 | Suggestions reflect a location change | PASS | Weak-live test answered with the restored Casa Loma after its vector row was deleted and re-enriched |
| U9 | No preloaded Uber pickup | PASS | Frontend suite uberLink.test.ts 33/33; no coordinates when no pickup is supplied |

### 2.6 Decommission readiness

| ID | Criterion | Result | Evidence |
|---|---|---|---|
| D1 | Agent no longer reads/writes platform agent tables | PASS | Agent DB env is agent-postgres / triplanner-agent-postgres; platform agent_embeddings/agent_index_state last writes predate M14 |
| D2 | get_places_cache removed | PASS | No get_places_cache reference in API/agent/frontend source |
| D3 | API /internal/places-cache still exists (expected until M14.8) | PASS | Returns 200 {places:186, contentHash} |
| D4 | Copy interest vectors with scripts/migrate-agent-vectors.py | **FAIL** | Script referenced by contract Section 8.3 does not exist; interests were synced manually |
| D5 | Drop SQL ready | **FAIL (pending M14.8)** | Not written. Recommended: DROP TABLE IF EXISTS agent_embeddings; DROP TABLE IF EXISTS agent_index_state; then remove CREATE EXTENSION vector and the block at backend/db/pg/schema.sql:98-126; keep until Gate 2 for the old-agent rollback image |
| D6 | Places rebuilt, counts match | PASS | 186 places in both agent DBs; 186 catalogue places |

### 2.7 Compose/Helm security and operations

| ID | Criterion | Result | Evidence |
|---|---|---|---|
| S1 | Agent + agent-postgres ready (Compose) | PASS | Both healthy; agent /ready 200 |
| S2 | Agent + agent-postgres ready (Helm) | PASS | Pods 1/1; /ready 200, 186 indexed; PG PVC Bound 2Gi |
| S3 | ClusterIP only, no external exposure | PASS | kubectl get svc: agent ClusterIP 4100, agent-postgres headless None; only web has Ingress |
| S4 | Non-root | PASS | Helm agent uid 10001, PG uid 999; Compose agent 10001, locations 100/101, PG process 999 |
| S5 | Read-only root filesystem | PASS | Helm agent and PG: touch /test-write -> Read-only file system; Compose rootfs not read-only (global requirement only says non-root) |
| S6 | No Kubernetes API token | PASS | automountServiceAccountToken:false; /var/run/secrets/... absent in both pods |
| S7 | ConfigMap non-secret env + Secret refs | PASS | triplanner-agent-config holds URLs/thresholds; DB/token via secretKeyRef; no secret in ConfigMap |
| S8 | helm test incl. agent hook | PASS | 6/6 suites Succeeded (agent, email, locations, trips, users, web) |
| S9 | No secrets in logs/browser/manifests | PASS | Logs, web bundle, rendered chart and /api/agent/config contain no key; Compose env has an untracked .env.fetch DeepSeek key (not in repo/image/logs, provider none) |
| S10 | Namespace on every namespaced object | PASS | Rendered chart scan: 0 objects missing metadata.namespace; only ClusterRole/Binding exceptions |
| S11 | Probes and limits | PASS | Liveness /health, readiness /ready (failureThreshold 12), requests 100m/256Mi, limits 1 CPU/1Gi |
| S12 | Rollback | PASS (dry-run) | helm rollback triplanner 41 --dry-run=server --no-hooks succeeded; revision 42 still deployed |
| S13 | Compose internal ports not published | **PARTIAL** | Base Compose publishes only web; the transition overlay used for Helm publishes API 0.0.0.0:4000 and agent 0.0.0.0:4100 (task expected 127.0.0.1) |
| S14 | Image publication for chart defaults | **FAIL (pending M14.8)** | Chart defaults are 1.6.0 (agent/trips/users/web) but no such local manifests; Docker Hub has no 1.6.0-dev4/0.2.2-dev3. Helm acceptance relies on locally-loaded dev tags |

### 2.8 Regression

| ID | Check | Result | Evidence |
|---|---|---|---|
| G1 | Locations tests | PASS | 38 pass / 0 fail |
| G2 | Agent tests | PASS | test_m2 13/13; test_settings 7/7 |
| G3 | Users tests | PASS | 67 pass / 0 fail (temporary users_test DB on 127.0.0.1:55433) |
| G4 | Trips tests | PASS | 67 pass / 0 fail |
| G5 | API tests | PASS | 73 pass / 0 fail |
| G6 | Frontend tests | PASS | 33 pass / 0 fail |
| G7 | Typecheck/lint | PASS | locations tsc --noEmit exit 0; helm lint 0 failures |
| G8 | Demo identities | PASS | demo login 200; demo-friend profile 200; demo-trip owner/members intact; demo-friend is not a member (pre-existing) |
| G9 | Read-only GraphQL regression | PASS | getMyInterests = food,museums,views; myNotifications read; trip items + reminder state read; searchLocations isFavorite read |
| G10 | Local invite/bell | N/T (mutation) | No live invite created (would mutate demo trips/notifications); users 67 + API 73 cover invite/notification code. myNotifications read path works |
| G11 | Favorites heart | PASS (read) | searchLocations returns isFavorite:false without error; users 67 + API 73 cover the mutation |
| G12 | Reminders | PASS (read) | Demo items return reminder {enabled:false, leadMinutes:60, canEdit:true}; M13 suites pass |
| G13 | Uploads | N/T | 0 attachments in the demo DB; no attachment created. API suite covers attachment code |
| G14 | Web through ingress | PASS | /, deep links, GraphQL, agent proxy all 200 |

## 3. Defects

### P2-1 (FIXED in post-QA, Section 11) - Deployed images do not match the commit under test

- **Severity:** P2 (release/merge provenance; latent data correctness)
- **Environment:** Compose + Helm, both stacks
- **Expected:** The tested artifact is reproducible from 4b89ec8.
- **Actual:** The working tree has three uncommitted files, and the images
  contain them:
  - enrichment.py: logger.info("locations enrichment ...") is in the image,
    absent from the commit.
  - vector_store.py: destination skip (if not place.get("category") and
    place.get("slug")) is in the image, absent from the commit.
  - mongo.ts: listPlaces() has no .limit(500) in the image; the commit has
    .limit(500).
  Images were built 26-43 s after the commit; the dirty changes were already in the build context; docker image inspect shows only Compose labels, no revision label.
- **Impact:** A clean build of 4b89ec8 reintroduces the destination-indexing bug
  (an earlier Helm build indexed toronto as a place; its tombstone is still in
  the agent DB) and the 500-row snapshot truncation. With >500 catalogue rows,
  apply_snapshot tombstones rows missing from the truncated snapshot at
  version+1; a later snapshot with the original version cannot resurrect them,
  so the agent index loses rows permanently.
- **Evidence:** git status --porcelain; git show 4b89ec8:... vs
  docker exec ... grep; image creation timestamps.
- **Fix:** Commit the three files (with tests) or revert them, rebuild both
  images, and re-run the affected matrix rows before Gate 2.

### P2-2 (FIXED in post-QA, Section 11) - Locations down breaks the demo auto-suggest path

- **Severity:** P2 (documented failure semantics, product path)
- **Reproduction:** Stop local_triplanner-locations; POST
  /api/agent/auto-suggest with tripId=demo-trip and the demo user.
- **Expected (contract Section 9):** agent serves the last synced index;
  enrichment is skipped; UI still works.
- **Actual:** 502 {"error":{"code":"BACKEND_ERROR","message":"El catalogo no
  esta disponible."}}. The Compose API /internal/trip-context/demo-trip returns
  503 LOCATIONS_UNAVAILABLE because the demo trip has null
  destination_lat/lng and destinationCoords() calls locations
  (backend/server/src/internal.ts:110-114,166-169). Agent-only
  search_with_enrichment does degrade correctly (5 results + warning), so the
  agent code is not the root cause; the cross-service promise is false.
- **Impact:** The recruiter demo cannot return suggestions while locations is
  down, even though the agent has a complete local index.
- **Fix / decision:** Add an API-side coordinate fallback (trip destination or
  agent context) or amend contract Section 9 and record the limitation. Re-test
  both.

### P2-3 (FIXED for non-empty add/remove; see P2-5) - Helm web interest changes never reach the Helm agent

- **Severity:** P2 (Helm acceptance; user-visible settings do nothing)
- **Reproduction:** Through http://triplanner.localhost/api/graphql, call
  setMyInterests(terms:["food","museums","views","nightlife"]) as demo.
- **Expected:** The Helm agent (which serves the Helm web) has four interests.
- **Actual:** Platform Postgres 4, Compose agent 4, Helm agent 3; no
  /internal/interests/sync request in the Helm agent log. The Compose API's
  AGENT_BASE_URL is http://agent:4100 (Compose), and its INTERNAL_TOKEN is the
  Compose dev token, while the Helm agent uses the Helm token.
- **Impact:** Auto-suggest/suggestions on the Helm web ignore new or edited
  interests. The current demo only works because interests were synced by hand.
- **Fix:** Route the API's interest sync to the Helm agent (URL + token) for the
  transitional stack, or proxy the sync through the web, or explicitly keep the
  API in Compose with a documented limitation. Manual sync is not reproducible.

### P2-4 (FIXED config; Hub runtime smoke pending) - docker-compose.hub.yml not migrated to the dedicated agent DB/broker

- **Severity:** P2 (published-image demo path; release blocker)
- **Expected:** The Hub stack runs the M14 agent with agent-postgres, Kafka,
  LOCATIONS_URL, BROKER_URL and the locations outbox.
- **Actual:** deploy/docker-compose.hub.yml (last touched before M14):
  - agent DATABASE_URL: postgres://triplanner:triplanner@postgres:5432/triplanner
    (platform DB), no POSTGRES_HOST, LOCATIONS_URL, BROKER_URL,
    SYNC_INTERVAL_MS, AGENT_*;
  - no agent-postgres service, no kafka service;
  - locations has no BROKER_URL/outbox settings.
- **Impact:** When M14 images are published, a Hub deploy will bootstrap the
  agent against the legacy platform DB and default 127.0.0.1:4300/8080
  (unreachable inside the container); /ready stays not-ready and auto-suggest
  fails. docker compose config --quiet still passes, so CI validation will not
  catch it.
- **Fix:** Port the agent-postgres/kafka/locations-outbox changes into the Hub
  file and add a Hub smoke run (or intentionally retire the Hub stack).

### P3 defects / gaps

| ID | Severity | Finding |
|---|---|---|
| P3-1 | P3 | /ready has no locations/broker status; with locations down it returned 200 and last_error:null until the 5-minute reconcile. Contract Section 9 says locations: down. |
| P3-2 | P3 | agent_sync_state only stores bootstrap_complete/last_snapshot_at; last_event_at/last_event_offset reset on restart (observed null after restarts). Contract Section 5.1 lists all four. |
| P3-3 | P3 | No metrics endpoint; contract Section 5.1 mentions metrics. |
| P3-4 | P3 | Outbox publisher retries at a fixed ~1 s with no backoff (4 attempts in 15 s). Contract Section 4.2 says backoff. |
| P3-5 | P3 | idx_agent_embeddings_destination is not partial (WHERE deleted=false) as specified in Section 5. |
| P3-6 | P3 | Helm agent test hook checks /health only, not /ready; a not-ready agent or a down agent DB still passes helm test. |
| P3-7 | P3 | Runtime logging has no INFO handler: locations snapshot synced, locations enrichment and reconcile logs are suppressed; only warnings/access logs appear. This removed the requested enrichment log evidence from the live service (it appears only with logging.basicConfig). |
| P3-8 | P3 | scripts/migrate-agent-vectors.py referenced by contract Section 8.3 does not exist; interest copy was manual. Drop SQL also not written (M14.8). |
| P3-9 | P3 | Stale docs: contract header "Proposed - pending Gate 1"; helm/helm-triplanner/README.md still says the agent is external via host.docker.internal and lists 1.6.0 images; NOTES.txt says API/agent ports must be published; README.md and backend/agent-service/README.md say the agent shares the backend Postgres; docs/QA_MATRIX.md says agent 11/11 (now 13/13). |
| P3-10 | P3 | Compose transition overlay publishes API/agent on 0.0.0.0:4000/4100 rather than 127.0.0.1; base Compose is correct (web only). Local LAN exposure in the Helm transition stack. |
| P3-11 | P3 | CI/tests still target the platform Postgres (tests/test_m2.py admin URL 127.0.0.1:5432/triplanner), not the agent pgvector DB; after Gate 2 drops platform pgvector the suite breaks. No CI coverage of the consumer/event flow, enrichment call count, or Helm chart (helm lint/helm test not in workflows). |
| P3-12 | P3 | nextVersion() is $inc followed by findOne; two concurrent upserts can read the same version and one update is then ignored by the agent (> check). Low likelihood in the demo, but the version is the idempotency key. |
| P3-13 | P3 | Malformed events are acked immediately, not after the "bounded local retry" wording of Section 5.2; a poison event is dropped and relies on reconcile. |
| P3-14 | P3 | English html lang="en" but the metadata description is Spanish ("planifica viajes en equipo"); es/en switch not browser-tested. |
| P3-15 | P3 | Pre-existing agent tombstones sync-probe (v2), tor-cn-tower (v2), toronto (v2) remain in the Compose agent DB; QA rows were removed. Broker retains 10 QA LocationChanged messages (no delete API). |

## 4. Failure-injection log

| Injection | Result |
|---|---|
| Locations stopped | /ready 200 (no locations field); auto-suggest 502 BACKEND_ERROR; API 503 LOCATIONS_UNAVAILABLE; agent-only enrichment returns 5 with warning. Restored healthy. |
| Kafka stopped | New outbox row unpublished, attempts:4 in 15 s, last_error set; auto-suggest 200; after restart published_at set and agent row v1 appeared. Delete v2 tombstoned. |
| agent-postgres stopped | /ready 503 db:down; /health 200; auto-suggest 500; after restart /ready 200 and 186 rows intact. |
| Agent restart | Reconcile tombstoned injected orphan v9->v10; active 186; no duplicates; consumer offset preserved. |
| Malformed broker events | Invalid body dropped/acked; unknown type ignored/acked; next events processed; /ready 200. |
| Stale/duplicate direct events | v1 after v2 ignored; v2 duplicate with different name ignored; tombstone rejected stale v1. |
| Locations slow/timeout | Not injected; 8 s timeout code path untested. |

## 5. Data and cleanup

| Data set | Before QA | After QA |
|---|---|---|
| Compose catalogue places | 186 | 186 |
| Compose outbox | 0 | 0 (QA rows deleted; published seed history was already absent) |
| Compose agent places | 186 active + 3 tombstones + 3 interests | 186 active + 3 tombstones + 3 interests + 0 queries |
| Helm catalogue places | 186 | 186 |
| Helm outbox | 187 published | 187 published, 0 unpublished |
| Helm agent places | 186 active + 1 tombstone + 3 interests | 186 active + 1 tombstone + 3 interests |
| Platform user_interests (demo) | food,museums,views | restored to food,museums,views |
| Demo trip | demo-trip, 10 items, 5 trips | unchanged |
| Broker | 191 LocationChanged | 203 LocationChanged (10 QA events + 2 malformed remain; no delete API) |

QA IDs removed from Mongo and both agent DBs: qa-m14-1795452729,
qa-m14-outage-1795452962, qa-m14-orphan, qa-m14-helm-1795453261, and all
q-qa-* query rows. triplanner_agent_test was dropped from platform Postgres.
The temporary users test Postgres container was removed.

## 6. Decommission recommendation (M14.8, after Gate 2)

1. Keep the platform tables until Gate 2; the old agent image is the rollback.
2. Back up the three demo interests (already present in both agent DBs).
3. After Gate 2 run:

       DROP TABLE IF EXISTS agent_embeddings;
       DROP TABLE IF EXISTS agent_index_state;

   then remove the CREATE EXTENSION IF NOT EXISTS vector line and the
   agent_embeddings/agent_index_state block from backend/db/pg/schema.sql
   (currently lines 13 and 98-126), and drop the extension only after confirming
   no other table uses vector.
4. Remove the API /internal/places-cache route and deps.catalogue.listPlaces()
   use (backend/server/src/internal.ts:389-390, 299-340).
5. Change backend/agent-service/tests/test_m2.py to a dedicated agent test DB
   and add the event-flow/enrichment tests to CI.

## 7. Residual risks

- Agent index can lag by seconds; reconcile interval is 300 s. /ready exposes
  bootstrap/DB but not locations/broker freshness.
- Tombstones grow without TTL; no cleanup job.
- The broker is at-least-once with no DLQ for LocationChanged; QA messages
  remain in the log.
- Committed listPlaces().limit(500) creates a latent permanent-tombstone bug
  above 500 catalogue rows.
- The transitional Compose/Helm split leaves interest sync and token routing
  split; the web is Helm, the API/agent data plane is mixed.
- The local untracked backend/.env.fetch injects a real DeepSeek key into the
  Compose agent environment (provider none; not in repo/image/logs/bundle).
  Do not use that environment for screenshots or logs.
- Docker Hub dev tags are not published; the chart defaults to 1.6.0 images
  that are not present locally/registry, so a clean install needs overrides
  until M14.8.

## 8. Not tested (and why)

- es/en switch in a browser - no headless browser in this run; code inspection
  only (default en, mirrored dictionaries).
- Uploads / attachment HMAC expiry - no seeded attachment; creating one would
  mutate demo data. API 73 tests include attachment code.
- Live local invite accept/decline - would create notifications and change
  membership; users 67 + API 73 cover the invite/bell path, and myNotifications
  read works.
- Reminder sweep - M13 behavior; demo items have reminders disabled; API 73
  covers the sweep.
- 8 s enrichment timeout - locations is local; no slow endpoint injected.
- Concurrent version counter race - not exercised.
- Clean-clone rebuild from commit - image would not match the tested dirty
  tree; intentionally not rebuilt to avoid destroying the evidence stack.
- Actual Helm rollback - dry-run only, to avoid disrupting the released stack.
- Docker Hub pull on a clean machine - manifests missing.
- macOS clean clone - still the known pending limitation.

## 9. Gate 2 recommendation (original - superseded by Section 11)

**HOLD.** The M14 implementation is functionally close and the core event,
reconcile, enrichment and security tests pass, but four P2s must be closed or
explicitly accepted at the human gate:

1. **P2-1** commit the three working-tree files (or revert and re-test), rebuild
   and re-verify; the current images are not the commit.
2. **P2-2** fix or formally amend the locations-down failure semantics; the demo
   auto-suggest currently returns 502.
3. **P2-3** route interest sync to the Helm agent (URL + token), or record a
   signed limitation and remove "interests verified" from the Helm acceptance.
4. **P2-4** update or retire deploy/docker-compose.hub.yml before publishing
   M14 images.

Once P2-1 and P2-3 are fixed/re-verified and P2-2/P2-4 are either fixed or
accepted as documented conditions, the slice can move to **APPROVE WITH
CONDITIONS**; the P3 items should be tracked for M14.8/release.

## 10. Evidence index

- Locations flow: temp id qa-m14-1795452729, outbox rows v1-v5, broker
  messages 192-199.
- Helm flow: qa-m14-helm-1795453261, outbox 187/0 unpublished, agent v1->v2->v3
  tombstone.
- Enrichment: instrumented search_with_enrichment 1 call weak / 0 calls strong;
  live suggestions 200 with and without the row.
- Readiness: 200/503 payloads; /health 200 during DB down.
- Security: uid/read-only/token checks; 401/403 responses.
- Helm: helm test 6/6; helm rollback --dry-run=server success.
- Tests: locations 38/38, agent 13/13 + settings 7/7, users 67/67, trips 67/67,
  API 73/73, frontend 33/33; locations tsc 0; helm lint 0.


## 11. Post-QA re-verification (2026-11-23 17:15-17:35 UTC)

Scope: HEAD `6b96d10` (`fix(agent): close M14 integration gaps`) plus
`1f4738d`; Compose rebuilt; Helm revision 43. Images under test:
`triplanner-agent:1.6.0-dev5` (`sha256:fc3d738d2a48`),
`triplanner-trips:0.1.1-dev6` (`sha256:631fb220e438`),
`triplanner-locations:0.2.2-dev3` (`sha256:83ebfffc43e8`). Compose and Helm use
the same IDs.

### 11.1 Original P2 status

| P2 | Status | Re-verification evidence |
|---|---|---|
| P2-1 images vs commit | **FIXED** | `git status` now shows only the untracked QA doc. All files changed by 1f4738d/6b96d10 compare byte-for-byte (normalized CRLF) with HEAD in the running images: enrichment.py, vector_store.py, auto_suggest.py, main.py, mongo.ts, db.ts, migrate.ts, seed.ts, 005-demo-coordinates.sql. Image build times (12:11:09/12:11:28) precede the final commit timestamp (12:12:58), but their contents match HEAD. |
| P2-2 locations-down auto-suggest | **FIXED** | Migration 005 is applied in both trips DBs (`schema_migrations` v5) and demo-trip has 43.6532/-79.3832. With Compose locations stopped, Compose auto-suggest returned 200 (5 items) and ingress auto-suggest returned 200 (5 items); API trip context returned 200 with lat/lng and 3 days. Locations restarted healthy. |
| P2-3 Helm interest sync | **FIXED for non-empty add/remove** | Remove nightlife via ingress: Helm agent 4 rows before the request, 3 after ingress auto-suggest. Add nightlife back: Helm 3 before, 4 after. Restored to food,museums,views on platform, Compose and Helm. The API still targets the Compose agent, but the Helm agent now reconciles from the API context on request. |
| P2-4 Hub Compose | **FIXED (config)** | `docker compose -f deploy/docker-compose.hub.yml config --quiet` exit 0. Services include agent, agent-postgres, kafka, locations. Agent env: POSTGRES_HOST=agent-postgres, POSTGRES_DB=agent, LOCATIONS_URL=http://locations:4300, BROKER_URL=http://kafka:8080, BROKER_TOPIC=LocationChanged, SYNC_INTERVAL_MS=300000, AGENT_MATCH_THRESHOLD=60; no DATABASE_URL. Volumes agentdata, agentpgdata, kafkadata, locationsdata. |

### 11.2 P2-5 (FIXED in Section 12) - clearing all interests leaves stale Helm suggestions

- **Severity:** P2 (wrong behaviour on the Settings -> interests path)
- **Reproduction:** `setMyInterests(terms: [])` via
  `http://triplanner.localhost/api/graphql` as demo, then
  `POST /api/agent/auto-suggest` through the ingress.
- **Expected:** platform and the Helm agent have no interests; auto-suggest
  returns `422 NO_INTERESTS` like Compose.
- **Actual:** platform 0, Compose agent 0; Helm agent still has the previous 3
  rows; ingress auto-suggest returns **200 with 5 items**. The Compose agent
  returns `422 {"error":{"code":"NO_INTERESTS",...}}` for the same state.
- **Cause:** the new reconciliation guards on a non-empty context:
  `if context_terms and set(...)` in `auto_suggest.py`, and
  `return agent_terms or context_terms` in `main.py:_user_interest_terms`.
  An explicit empty `interests` list is treated as "no context" instead of
  "clear the index".
- **Impact:** a user who clears all interests keeps receiving suggestions from
  stale Helm embeddings; the claim that the agent reconciles interests from the
  API context is false for the empty set.
- **Fix:** treat `interests: []` as authoritative (`sync_user_interests(user, [])`
  deletes the `ui-*` rows) and let `user_interest_vector` return None so
  auto-suggest returns 422. Keep the "context missing" case distinct from
  "context empty". Re-run remove/add/clear.
- **Evidence:** Compose 422 NO_INTERESTS vs Helm 200; Helm rows 3 after the
  empty mutation; restored to 3 on all stacks afterwards.

### 11.3 Test and operations re-run

| Check | Result |
|---|---|
| trips-service | 67 pass / 0 fail (362 expects, real `trips_test` DB) |
| agent-service `test_m2` | 13/13 |
| agent-service `test_settings` | 7/7 |
| locations-service | 38 pass / 0 fail |
| users-service | 67 pass / 0 fail (real `users_test` DB) |
| API | 73 pass / 0 fail |
| frontend | 33 pass / 0 fail |
| typechecks | locations, trips, users, API, frontend: all exit 0 |
| helm lint | 0 chart failures |
| helm test | 6/6 suites Succeeded (agent, email, locations, trips, users, web) |
| image provenance | Compose/Helm agent fc3d738d2a48, trips 631fb220e438, locations 83ebfffc43e8; changed files match HEAD |

Event recheck on the new agent image: QA place create v1, update v2, delete v3
tombstone; a directly published destination-shaped event (`category:null`,
`slug` set) produced **no agent row**; active destination rows = 0 on both
stacks. The remaining `toronto` (and Compose `sync-probe`, `tor-cn-tower`)
tombstones are `deleted=true`, filtered by every query, excluded from the
snapshot, and the new image skips destination-shaped upserts. They are harmless;
they can be removed after Gate 2.

Final state: Compose and Helm 186 active places; 3 and 1 harmless tombstones;
3 demo interests on platform/Compose/Helm; no `qa-m14*` rows; Compose outbox 0
unpublished 0; Helm outbox 187 all published; all Compose and Helm services
healthy.

### 11.4 Remaining P1/P2

- **P1:** none.
- **P2:** **P2-5 only** (empty-interest reconciliation). P2-1, P2-2, P2-3
  (non-empty) and P2-4 (config) are fixed.

Residual P3 / release conditions still open from Section 3:

- P3-1/P3-2/P3-3: /ready still lacks locations/broker state and metrics;
  agent_sync_state still omits last_event_at/last_event_offset.
- P3-4/P3-5: outbox has no backoff; destination index is not partial.
- P3-6/P3-7: helm agent hook checks only /health; runtime INFO sync/enrichment
  logs remain suppressed.
- P3-8/P3-9: missing migrate-agent-vectors.py/drop SQL; stale README, chart
  README, NOTES and QA_MATRIX docs.
- P3-10/P3-11/P3-12/P3-13/P3-14: 0.0.0.0 transition ports; CI still targets
  platform Postgres and has no event/enrichment/Helm coverage; version counter
  race; malformed events ack immediately; Spanish metadata description.
- P3-15: harmless pre-existing tombstones; broker retains QA messages.
- Hub release tags: `deploy/docker-compose.hub.yml` defaults locations to
  1.7.0 (not yet published) while `.env.example` pins LOCATIONS_IMAGE_TAG=0.2.1
  (old locations without M14 outbox). Align and publish the M14 image tags
  before the Hub release; the Hub stack was config-validated, not runtime-run.
- Three old "Offline locations" trips in the Compose trips DB still have null
  coordinates. Locations-down auto-suggest is fixed for demo-trip (the recruiter
  path) but not for those legacy test trips.
- Clearing all interests is the P2-5 edge above.

### 11.5 Gate 2 recommendation at P2-5 discovery (superseded by Section 12)

**HOLD**, narrowly: all four original P2s are closed, but P2-5 is a new P2 on a
documented Settings path. Clearing all interests must clear the Helm agent
index and return `NO_INTERESTS`; today the Helm agent keeps stale rows and
auto-suggest returns 200. The fix is small and isolated to the two empty-context
guards.

If the human accepts P2-5 as a known residual (the demo always has interests),
the slice is otherwise ready for **APPROVE WITH CONDITIONS**:

1. Fix/verify P2-5, or record the signed limitation.
2. Publish and pin the M14 images/tags; align `.env.example` and the Hub defaults
   (locations 0.2.2, agent/trips dev or release tags), then run one Hub runtime
   smoke.
3. Track the P3 observability/docs/CI items for M14.8 before release.

## 12. P2-5 closure and final Gate 2 brief (2026-11-23 17:35-17:50 UTC)

Scope: HEAD `5c7c8f6` (`fix(agent): treat an empty interest list as
authoritative`); Compose rebuilt; Helm revision 44. Images: agent
`1.6.0-dev6` (`sha256:022dd91fae03`), trips `0.1.1-dev6`
(`sha256:631fb220e438`), locations `0.2.2-dev3`
(`sha256:83ebfffc43e8`). Compose and Helm use the same agent image.

### 12.1 P2-5 status: FIXED

The changed files `auto_suggest.py` and `main.py` hash-match HEAD inside the
running image (`6925c92afeb5`, `f441130f9c61`). The new test
`test_clearing_interests_removes_all_terms` is in the suite (14/14).

Live ingress evidence:

| Step | Result |
|---|---|
| setMyInterests([]) | 200; platform 0, Compose agent 0, Helm agent 3 before the request |
| Ingress auto-suggest | **422 `NO_INTERESTS`** |
| Compose auto-suggest | **422 `NO_INTERESTS`** |
| Helm agent after request | 0 interest rows |
| setMyInterests([food,museums,views]) then ingress auto-suggest | 200; Helm 3 rows |
| Add nightlife then ingress auto-suggest | 200; Helm 4 rows |
| Remove nightlife then ingress auto-suggest | 200; Helm 3 rows; nightlife rows 0 |

No stale terms remained after clear, add or remove. Platform, Compose and Helm
were restored to `food,museums,views`.

### 12.2 Test and operations re-run

| Check | Result |
|---|---|
| agent-service `test_m2` | **14/14** (includes test_clearing_interests_removes_all_terms) |
| agent-service `test_settings` | 7/7 |
| locations-service | 38 pass / 0 fail |
| trips-service | 67 pass / 0 fail (real trips_test DB) |
| users-service | 67 pass / 0 fail (real users_test DB) |
| API | 73 pass / 0 fail |
| frontend | 33 pass / 0 fail |
| typechecks | locations, trips, users, API, frontend: all exit 0 |
| helm lint | 0 chart failures |
| helm test | 6/6 suites Succeeded (agent, email, locations, trips, users, web) |

Final state: 186 active places on Compose and Helm; 3/1 harmless tombstones;
3 demo interests on platform/Compose/Helm; no `qa-m14*` rows; Compose outbox 0
unpublished 0; Helm outbox 187 all published; active destination rows 0; all
Compose and Helm services healthy; ingress 200.

### 12.3 Remaining P1/P2

- **P1:** none.
- **P2:** none. P2-1 through P2-5 are closed and re-verified.

Residual P3/release conditions from Sections 3 and 11 still apply: `/ready`
locations/broker fields and metrics, agent_sync_state event keys, outbox
backoff, partial destination index, Helm agent hook only /health, runtime INFO
logs, missing migration script/drop SQL, stale docs, CI gaps, 0.0.0.0
transition ports, version-counter race, malformed-event ack behavior, Spanish
metadata, harmless tombstones/broker QA messages. The Hub stack was
config-validated only (no runtime smoke), and its release tags must be aligned
and published (`.env.example` currently pins LOCATIONS_IMAGE_TAG=0.2.1; the Hub
default is 1.7.0). Three legacy "Offline locations" trips still have null
coordinates; demo-trip is fixed.

### 12.4 Final Gate 2 recommendation

**APPROVE WITH CONDITIONS.**

No P1 or P2 remains. The M14 code slice is accepted for Gate 2:

1. M14.8 must publish and pin the final images (agent 1.6.0, trips 0.1.1,
   locations 0.2.2), align `.env.example` and the Hub defaults, and run one Hub
   runtime smoke (the Hub configuration passed, but runtime was not executed).
2. Track the P3 observability/docs/CI items (readiness fields, metrics, outbox
   backoff, Helm readiness hook, logs, migration/drop SQL, stale docs) for the
   release.
3. Optionally clean the harmless old tombstones and QA broker messages after
   Gate 2.

## 13. Gate 2 closure (2026-11-23)

The human owner approved Gate 2 (“Approve Gate 2”).

- Platform `agent_embeddings` and `agent_index_state` were dropped and the
  platform `vector` extension removed; the API schema no longer creates them.
- API `/internal/places-cache` and the agent `get_places_cache` client were
  removed.
- The user interests on platform, Compose agent and Helm agent are
  `food,museums,views`.
- Chart 0.11.0, `appVersion` 1.7.0, images `web/api/users/trips/locations/agent`
  at `1.7.0` on tag `v1.7.0`; release notes
  `docs/RELEASE_NOTES_v1.7.0.md`.
- Publication, the published-stack smoke and one Hub runtime smoke remain the
  release step.
