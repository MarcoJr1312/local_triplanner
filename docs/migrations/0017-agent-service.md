# 0017 — Agent service: pgvector sync and prompt enrichment

| Field | Value |
|---|---|
| Status | **Proposed — pending Gate 1** |
| Cycle | Microservice Code Migration (`19455fa3-28ea-4f03-b195-973c5ddf595e`) |
| Integration branch | `refactor/helm` |
| Work branch | `feature/agent-pgvector` |
| Runtime | Python 3.12, FastAPI, Agno, PostgreSQL 17 + pgvector |
| Source of truth | `locations` service (MongoDB) |
| Transport | Go HTTP broker, topic `LocationChanged` |
| Chart | `helm-triplanner` 0.11.0 |

## 1. Summary

Move the agent’s vector store out of the platform PostgreSQL and into a
dedicated PostgreSQL 17 + pgvector database. The locations service remains the
only source of truth for places; the agent keeps a derived, eventually
consistent vector index of locations and uses it for suggestions.

Locations changes are published through the Go HTTP broker with a Mongo
outbox, the agent consumes them with per-consumer offsets, and both a startup
snapshot and a periodic reconcile repair gaps. When a prompt produces a weak
vector match, the agent asks the locations service for more places based on the
prompt, indexes those rows immediately and re-runs the vector query once.

This is **not literal synchronous replication**. The agent index can lag by
seconds; the snapshot/reconcile path guarantees it converges.

## 2. Decisions (2026-11-23)

1. **Outbox + snapshot/reconcile.** Locations writes a Mongo outbox; a publisher
   retries to the broker. The agent bootstraps from the full locations snapshot
   and reconciles periodically.
2. **Weak-match threshold.** If the best vector score is below 60/100 or fewer
   than `K` results, the agent asks locations once for up to 20 places, indexes
   them and re-queries once.
3. **Helm + Compose pgvector.** Both runtimes get an agent workload with its own
   pgvector PostgreSQL; the Helm web points at the Helm agent.
4. **Offline hashing embedder.** Keep the deterministic 384-dim embedder; no
   provider key or network is required for embeddings.
5. **Event bus.** Use the existing Go HTTP broker (`LocationChanged`), not
   Apache Kafka. It is at-least-once, single-node, and not wire-compatible with
   Kafka.

## 3. Ownership

| Data | Owner | Store |
|---|---|---|
| Destinations/places, HasData cache | locations service | MongoDB |
| Location change outbox | locations service | MongoDB collection |
| Place embeddings, interests, transient queries | agent service | PostgreSQL + pgvector |
| Trip context, membership, chat rows | API facade | existing stores |
| Change transport | Go broker | SQLite |

The agent never writes to MongoDB or Postgres owned by another service. The
locations service never writes embeddings. The API keeps orchestrating trip
context and chat persistence.

## 4. Locations change contract

### 4.1 Versioning

Add to `LocationRow` and the Mongo document:

- `version integer NOT NULL DEFAULT 1`
- a canonical `content_hash text`

`version` increments **only when the location content changes**. Re-running the
idempotent seed or repeating an identical upsert does not publish an event.
`last_updated` changes only on a real update.

### 4.2 Outbox

Mongo collection `locations_outbox`:

```json
{
  "_id": "uuid",
  "event_id": "uuid",
  "location_id": "tor-cn-tower",
  "version": 7,
  "type": "location.changed.v1",
  "payload": { "...": "full LocationRow snapshot" },
  "created_at": "ISO",
  "published_at": null,
  "attempts": 0,
  "last_error": null
}
```

A publisher loop in the locations service polls unpublished rows, publishes
them to the broker and marks `published_at`; failures increment `attempts` and
retry with backoff. There is no Mongo transaction: a crash between the place
write and the outbox insert is repaired by the agent snapshot/reconcile.

### 4.3 Broker message

- Topic: `LocationChanged`
- Key: `location:<id>`
- Value:

```json
{
  "eventId": "uuid",
  "type": "location.changed.v1",
  "version": 7,
  "occurredAt": "2026-11-23T...",
  "deleted": false,
  "location": { "...": "full LocationRow including version" }
}
```

`deleted: true` carries the last known version and no `location` body.

### 4.4 Locations REST additions

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/internal/v1/locations` | Existing full snapshot; rows include `version` and `content_hash` |
| `DELETE` | `/internal/v1/locations/{id}` | Delete a place and enqueue `deleted:true` |
| `GET` | `/internal/v1/locations/search` | Existing search; used by the agent for enrichment |

The delete route is owner-only in the sense that it is protected by the
internal token; it is not exposed to the browser.

## 5. Agent vector schema

The agent owns this database and creates the schema idempotently at startup
(`ensure_schema()`), including `CREATE EXTENSION IF NOT EXISTS vector`.

```sql
CREATE TABLE agent_embeddings (
  id             text PRIMARY KEY,
  kind           text NOT NULL CHECK (kind IN ('place', 'interest', 'query')),
  destination_id text,
  user_id        text,
  session_id     text,
  document       text NOT NULL,
  metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,
  embedding      vector(384) NOT NULL,
  source_version bigint NOT NULL DEFAULT 0,
  deleted        boolean NOT NULL DEFAULT false,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_agent_embeddings_destination
  ON agent_embeddings(destination_id, kind) WHERE deleted = false;
CREATE INDEX idx_agent_embeddings_user
  ON agent_embeddings(user_id, kind);
CREATE INDEX idx_agent_embeddings_session
  ON agent_embeddings(session_id);
CREATE INDEX idx_agent_embeddings_vector
  ON agent_embeddings USING hnsw (embedding vector_cosine_ops);

CREATE TABLE agent_sync_state (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

- Deletes set `deleted = true` and `source_version = version`; vector queries
  filter `kind = 'place' AND deleted = false`. Tombstones reject stale upserts.
- `agent_sync_state` records `bootstrap_complete`, `last_snapshot_at`,
  `last_event_at`, `last_event_offset`.
- Interests/queries keep the current behavior (`source_version = 0`,
  `deleted = false`).
- The old `agent_index_state` table is not recreated; the sync state replaces it.

### 5.1 Bootstrap and reconcile

1. Agent startup: ensure schema, `GET /internal/v1/locations` snapshot, upsert
   places in batches, mark `bootstrap_complete=true`.
2. Periodic reconcile every `SYNC_INTERVAL_MS` (default 300000): fetch the
   snapshot, upsert changed versions, tombstone IDs missing from the snapshot.
3. If the snapshot fails, keep the last index and mark `sync_state` stale; do
   not fail readiness forever, but expose the error in `/ready` and metrics.
4. `ready` is 200 only when the database is reachable and the first bootstrap
   completed; broker/locations failures are reported as degraded.

### 5.2 Event consumer

- Consumer name `agent-locations` (configurable).
- `GET /v1/topics/LocationChanged/messages?consumer=agent-locations&limit=50&wait=20`.
- For each message: validate envelope, compare `version` with the stored row
  (including tombstones), embed and upsert or tombstone, commit, then ack the
  broker offset.
- Broker failures: back off and retry; do not ack.
- Malformed events: log and ack (terminal) after a bounded local retry.
- At-least-once delivery is made idempotent by `(location_id, version)`.

## 6. Prompt-driven enrichment

After the normal vector query:

```text
results = top_k(destination, query_vector)
if results empty or len(results) < K or best_score < AGENT_MATCH_THRESHOLD:
    extra = locations.search(
        q=user_prompt,
        lat=destination_lat,
        lng=destination_lng,
        limit=AGENT_ENRICH_LIMIT
    )
    upsert extra into the agent index (locations also publishes events)
    results = top_k(destination, query_vector)   # once
```

Defaults:

- `AGENT_MATCH_THRESHOLD=60` (integer score 0–100)
- `AGENT_ENRICH_LIMIT=20`
- One enrichment call per request, max 20 places, timeout 8 s.
- If locations is unavailable, continue with the existing index and tools.
- Auto-suggest has no user prompt; it never triggers external enrichment. It
  uses the synced index and the user’s interest vector.
- Suggestion chat and day-plan use the prompt/destination name respectively.

The locations service remains the only component that calls HasData; the agent
only calls the internal locations REST API.

## 7. Agent runtime and deployment

### 7.1 Configuration

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` or `POSTGRES_*` | local pgvector | Agent DB |
| `LOCATIONS_URL` | `http://triplanner-locations:4300` | Snapshot/search |
| `LOCATIONS_TIMEOUT_MS` | `8000` | Enrichment timeout |
| `BROKER_URL` | `http://triplanner-kafka:8080` | Event consumer |
| `BROKER_TOPIC` | `LocationChanged` | Topic |
| `BROKER_CONSUMER` | `agent-locations` | Consumer offset |
| `SYNC_INTERVAL_MS` | `300000` | Reconcile |
| `AGENT_MATCH_THRESHOLD` | `60` | Enrichment trigger |
| `AGENT_ENRICH_LIMIT` | `20` | Extra places |
| `BACKEND_URL` | external API | Trip context/chat |
| `INTERNAL_TOKEN` | Secret | Locations/API auth |
| `LLM_*` | provider settings | Existing BYOK |

### 7.2 Compose

- `agent-postgres`: `pgvector/pgvector:pg17`, own credentials/volume,
  ClusterIP-only on the Compose network.
- `agent`: `DATABASE_URL` to `agent-postgres`; `BROKER_URL` to `kafka`,
  `LOCATIONS_URL` to `locations`; `agentdata` volume for `.data/llm.json`;
  depends on API, locations, kafka and agent-postgres.
- Locations gets `BROKER_URL`/topic/outbox settings.
- Platform Postgres no longer stores agent vectors after cutover.

### 7.3 Helm

- `agent-postgres` StatefulSet (pgvector image), Secret, Service, PVC 2Gi,
  probes, NetworkPolicy; no external exposure.
- `agent` Deployment, Service `:4100`, ServiceAccount (no kube API), PVC for
  `.data`, ConfigMap for non-secret env, Secret for DB credentials and
  `INTERNAL_TOKEN`; probes `/health` and `/ready`; optional NetworkPolicy.
- `images.agent` (publish `triplanner-agent:1.6.0`), `agentService` values block;
  chart 0.11.0.
- Helm web `webService.agent.url` points at `http://triplanner-agent:4100`.
- Agent `BACKEND_URL=http://host.docker.internal:4000` until the API joins Helm.
- Locations values get broker/outbox settings.

## 8. Cutover and decommission

1. Deploy locations versioning/outbox/publisher (backward compatible).
2. Deploy agent pgvector DB and the new agent; bootstrap from the locations
   snapshot. Keep the old agent/API path available for rollback.
3. Copy interest embeddings from platform `agent_embeddings` (`kind='interest'`)
   to the agent DB with `scripts/migrate-agent-vectors.py`; places are rebuilt
   from the snapshot, transient queries are discarded.
4. Point the web/agent URL at the new agent; verify suggestions, interests,
   auto-suggest and day-plan.
5. Remove the agent’s places-cache indexing, then remove API
   `/internal/places-cache` after QA.
6. Drop `agent_embeddings`/`agent_index_state` from the platform schema and
   remove the pgvector extension use from the platform database after Gate 2.
7. Rollback: keep the platform tables and old agent image until Gate 2; point
   the web back to the old agent if needed.

## 9. Failure semantics

- **Locations down**: agent serves the last synced index; enrichment is skipped;
  `/ready` reports `locations: down`; the UI still works.
- **Broker down**: consumer retries; snapshot/reconcile still repair on the next
  interval; no message loss in the locations outbox.
- **Agent DB down**: `/ready` fails; the API/web show the existing degraded
  agent state; no trip data is lost.
- **Duplicate/out-of-order events**: version check ignores stale/duplicate
  updates.
- **Deleted/TTL-expired places**: tombstone on delete; reconcile tombstones IDs
  missing from the snapshot.

## 10. Tests and acceptance

- Locations: version only on change; outbox row; publisher retries; delete
  event; snapshot includes versions; seed re-run emits no duplicate events.
- Agent: schema bootstrap; snapshot diff; event upsert/tombstone; stale/duplicate
  skip; consumer ack after commit; malformed event; broker/locations down;
  reconcile delete; readiness.
- Enrichment: weak score triggers one locations search, indexes results and
  re-queries; strong score skips; auto-suggest never enriches; 8 s timeout.
- Data migration: interest rows copied; places rebuilt; counts match.
- Compose and Helm: seed sync, location update via service, agent vector update,
  suggestions reflect it; poor-match prompt enriches; restart/reconcile; no
  platform agent tables; `helm test`.
- Security: agent DB ClusterIP only, non-root, no kube API, internal token,
  no secrets in ConfigMaps/logs; broker/locations not public.

## 11. Risks

| Risk | Mitigation |
|---|---|
| Outbox gap without Mongo transactions | Snapshot + periodic reconcile; version/content hash |
| Broker is at-least-once | Idempotent `(location_id, version)` and tombstones |
| Agent index lag | `/ready` exposes staleness; last index serves traffic |
| HasData enrichment cost | One call per weak request, cap 20, 8 s, disabled when provider is preloaded |
| Platform DB drop breaks old agent | Keep tables until Gate 2; rollback image |
| Two stacks share names | Separate Compose and Helm brokers/DBs; consumer name configurable |
| pgvector extension privileges | Official image user is superuser; `ensure_schema` fails clearly otherwise |
| Agent DB growth | Tombstones kept for version safety; add TTL cleanup after QA |

## 12. Rollout

| Stage | Name | Owner |
|---|---|---|
| M14.1 | Contract, ADR and Gate 1 | PM |
| M14.2 | Locations version, outbox, publisher and delete route | Backend |
| M14.3 | Agent pgvector schema, snapshot/bootstrap and reconcile | Backend |
| M14.4 | Agent LocationChanged consumer and idempotency | Backend |
| M14.5 | Prompt enrichment and places-cache removal | Backend |
| M14.6 | Compose/Helm agent and pgvector workloads | SRE |
| M14.7 | Acceptance, failure injection and QA | QA |
| M14.8 | Gate 2, decommission and release | PM/SRE |

## 13. Exit criteria

- The agent stores all vectors in its own pgvector database; platform agent
  tables are gone.
- Locations changes reach the agent within the sweep interval and reconcile
  repairs gaps.
- Weak prompts ask locations once, index the extra places and return better
  matches; strong prompts do not call locations.
- Compose and Helm agent workloads are healthy and non-root; the Helm web uses
  the Helm agent.
- Gate 2 recorded before removing the platform vector tables.
