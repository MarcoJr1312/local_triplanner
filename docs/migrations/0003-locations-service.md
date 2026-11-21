# 0003 - Locations/activities service

| Field | Value |
|---|---|
| Status | M6d complete; M6e next |
| Integration branch | `refactor/helm` |
| Work branch | `refactor/helm-locations-service` (local only) |
| Runtime | Bun + TypeScript |
| Transport | Internal HTTP/JSON, `x-internal-token` |
| Data store | MongoDB 7, owned by the service |
| Helm | MongoDB StatefulSet + locations Deployment |

## 1. Summary

Extract the MongoDB location catalogue from the API into an independently
deployable `triplanner-locations` service. The service owns destinations,
places/activities, search and the committed Toronto seed. The API keeps the
GraphQL contract, favorites, trips and membership; the web and the agent keep
their current contracts.

This is a synchronous read service, not an event consumer. The eight gates in
[`README.md`](./README.md) apply with gates 3-4 adapted: there is no outbox or
DLQ, so the contract tests and the Compose end-to-end run replace the
producer/consumer failure-injection gates.

## 2. Current state

- `backend/server/src/catalogue/mongo.ts` connects the API directly to MongoDB
  and implements `search`, `listDestinations`, `listByParent`, `listPlaces`,
  `getById`, `getByPlaceId`, `getByDataId` and `upsert`.
- GraphQL resolvers in `backend/server/src/resolvers.ts` expose
  `listDestinations`, `listActivities`, `searchLocations`, `locationById` and
  `locationDetails`; `favoriteLocation` validates the id through the catalogue.
- Favorites-first ranking, the 75 km radius and the 20/10 limits live in
  `backend/server/src/catalogue/search.ts` and the resolvers.
- The agent calls the API at `/internal/search-places`,
  `/internal/place-details` and `/internal/places-cache/{tripId}`.
- `backend/server/src/seed.ts` seeds both Postgres demo data and MongoDB from
  `backend/db/toronto-locations.json` (fallback `seed-data.json`).
- The API's Docker image copies the Toronto dataset and seed images.

## 3. Scope

In scope:

- Destinations and places/activities (the `Location` and `Activity` GraphQL
  types).
- Search by name tokens, category filters and destination grouping.
- The Toronto seed and the Mongo indexes.
- Internal REST v1 contract exposed by the new service.
- Compose and Helm deployment of the service and MongoDB.

Out of scope:

- Trip itinerary items, favorites, presence, users, invitations and budgets.
  Those stay in PostgreSQL and the API.
- Agent-side vector storage and prompt behaviour.
- Mongo authentication, TLS and multi-node replica sets. The demo keeps a
  single-node, cluster-internal StatefulSet.
- gRPC. The locations service uses HTTP/JSON in this migration.

## 4. Target topology

```
web (Next.js) --GraphQL--> api (Bun) --HTTP/JSON--> locations (Bun) --> mongo (7)
                               |                                        ^
                               +-- Postgres (favorites, trips)          |
agent (FastAPI) --/internal/*--> api                                    |
                               +-- broker --> email                      |
```

- `locations` listens on `4300` inside the Compose network and the cluster;
  only `api` may call it. Port 4300 is never published on the host. The agent
  keeps 4100.
- `agent` keeps calling the API. Pointing the agent directly at the locations
  service is a later, separate decision.
- Mongo listens on `27017`, reachable only from `locations`.
- The web container and GraphQL schema do not change.

## 5. Internal REST v1 contract

Base path: `/internal/v1`. Every route requires the internal token header:

```
x-internal-token: $INTERNAL_TOKEN
```

Missing or wrong token: `401 {"error":"UNAUTHORIZED"}`. Unknown route:
`404 {"error":"NOT_FOUND"}`. Invalid query: `400 {"error":"INVALID_ARGUMENT"}`.
Mongo failure: `503 {"error":"UNAVAILABLE"}`.

Health endpoints are unauthenticated:

| Route | Success |
|---|---|
| `GET /health` | `200 {"status":"ok"}` |
| `GET /ready` | `200 {"status":"ready","mongo":"ok","seeded":true}`; `503` when Mongo is down or the seed is incomplete |

### 5.1 DTO

List and single-item responses carry the `LocationRow` shape used by the API
today, so the API can keep `locationRowToGraphQL` unchanged:

```json
{
  "id": "seed-dest-toronto",
  "source": "seed",
  "place_id": null,
  "data_id": null,
  "slug": "toronto",
  "name": "Toronto",
  "category": null,
  "raw_type": null,
  "country": "Canada",
  "description": "…",
  "lat": 43.6532,
  "lng": -79.3832,
  "address": null,
  "rating": null,
  "rating_count": null,
  "hours_json": null,
  "website_url": null,
  "social_links_json": null,
  "phone": null,
  "price_level": null,
  "image_url": "/uploads/seed/toronto.jpg",
  "cost": null,
  "tags_json": null,
  "duration_hours": null,
  "parent_id": null,
  "last_updated": "2026-11-21T00:00:00.000Z",
  "created_at": "2026-11-21T00:00:00.000Z",
  "expires_at": null
}
```

Snake-case is intentional: it is the storage contract, not the GraphQL shape.
The API maps it to camelCase exactly as it does today.

### 5.2 Routes

| Method | Route | Behaviour |
|---|---|---|
| `GET` | `/destinations` | Rows with a non-null `slug`, sorted by `name`. Returns `{ "items": LocationRow[] }`. |
| `GET` | `/destinations/{slug}/activities?category=&limit=50` | Places with `parent_id=slug` and non-null `category`. Optional category filter. Sort: `rating` desc, `rating_count` desc, `name` asc. `limit` 1-200, default 50. |
| `GET` | `/locations/search?q=&lat=&lng=&limit=100` | Token AND match over `name_lower`; places only. If `lat` and `lng` are present, keep rows within 75 km. Sort: `rating` desc, `rating_count` desc, `name` asc. `limit` 1-100, default 100. Empty `q` returns `{ "items": [] }`. |
| `GET` | `/locations/{id}` | Single row by `id`; `404` when absent. |
| `GET` | `/locations/by-place/{placeId}` | Single row by `place_id`; `404` when absent. |
| `GET` | `/locations/by-data/{dataId}` | Single row by `data_id`; `404` when absent. |
| `POST` | `/locations` | Guarded upsert, deduping by `place_id`, `data_id` then `id`. Used by the seed and future ingestion. Returns `{ "item": LocationRow }`. |
| `POST` | `/seed` | Re-runs the committed dataset seed. Returns `{ "seeded": number }`. Disabled when `SEED_CATALOGUE=false`; `403 {"error":"SEED_DISABLED"}`. |

Search does **not** apply favorites. The API keeps favorites in Postgres,
re-ranks candidates favorites-first, and slices to 20 so the current product
behaviour is unchanged. The service returns up to 100 candidates for that
reason.

## 6. Data ownership

| Data | Owner after M6 | Store |
|---|---|---|
| Destinations, places, activities | locations | MongoDB `triplanner.locations` |
| Toronto seed + local images | locations (seed) / API (uploads proxy) | committed JSON + `backend/db/seed-images` |
| Favorites, trips, items, members, users | API | PostgreSQL |
| Presence | API | in-memory |
| LLM/email settings | agent/email services | their PVCs |

The API must not open a MongoDB connection in remote mode. The `mongodb`
dependency is removed from the API in M6e, after acceptance.

## 7. Configuration

### 7.1 Locations service

| Env var | Default | Purpose |
|---|---|---|
| `PORT` | `4300` | HTTP listen port |
| `MONGODB_URL` | `mongodb://localhost:27017/triplanner` | Mongo connection |
| `MONGODB_DB` | derived from the URL | Database name override |
| `MONGODB_COLLECTION` | `locations` | Collection name |
| `INTERNAL_TOKEN` | required | `x-internal-token` value |
| `SEED_CATALOGUE` | `true` | Idempotent startup seed |
| `SEED_DATA_PATH` | `/app/db/toronto-locations.json` | Committed dataset |
| `SEED_ON_STARTUP_TIMEOUT_MS` | `30000` | Seed/readiness bound |

The service runs as a non-root user with a read-only root filesystem; it writes
only to Mongo.

### 7.2 API

| Env var | Default | Purpose |
|---|---|---|
| `LOCATIONS_MODE` | `local` until M6c, then `remote` | `remote` calls the service; `local` keeps the in-process adapter for rollback |
| `LOCATIONS_URL` | `http://localhost:4300` | Service base URL |
| `LOCATIONS_TIMEOUT_MS` | `2000` | Client timeout |
| `INTERNAL_TOKEN` | existing | Shared internal token |

### 7.3 Compose

- New `locations` service, built from `backend/locations-service`.
- `depends_on: mongo: condition: service_healthy`.
- Healthcheck: `curl -f http://localhost:4300/ready`.
- API gets `LOCATIONS_MODE=remote`, `LOCATIONS_URL=http://locations:4300` and
  `depends_on: locations: condition: service_healthy`.
- After M6e, the API no longer receives `MONGODB_URL` and no longer depends on
  `mongo`.

### 7.4 Helm values

```yaml
mongo:
  enabled: true
  image: mongo:7
  replicaCount: 1
  service:
    port: 27017
  persistence:
    enabled: true
    size: 2Gi
    storageClass: ""

locationsService:
  enabled: true
  replicaCount: 1
  image:
    name: marcojr13/triplanner-locations
    tag: "0.1.0"
  service:
    type: ClusterIP
    port: 4300
  mongo:
    url: mongodb://triplanner-mongo:27017/triplanner
  seed:
    enabled: true
    dataPath: /app/db/toronto-locations.json
  internalToken:
    existingSecret: triplanner-internal
    key: INTERNAL_TOKEN
  rbacProxy:
    enabled: true
    port: 8443

api:
  locations:
    serviceUrl: http://triplanner-locations:4300
    mode: remote
```

## 8. MongoDB StatefulSet

- `apps/v1` StatefulSet `triplanner-mongo`, one replica, `serviceName:
  triplanner-mongo`.
- Headless Service `triplanner-mongo` on `27017`; clients use
  `mongodb://triplanner-mongo:27017/triplanner`.
- `volumeClaimTemplates` named `data`, mounted at `/data/db`; size from
  `mongo.persistence.size`.
- Image `mongo:7`, `runAsNonRoot: true`, `runAsUser: 999`, `fsGroup: 999`,
  `readOnlyRootFilesystem: true`, `allowPrivilegeEscalation: false`, all
  capabilities dropped. Writable mounts: `/data/db` (PVC) and `/tmp`
  (`emptyDir`).
- Probes use `mongosh --quiet --eval "db.adminCommand('ping').ok"`.
- No Mongo auth in the local demo. The Service is ClusterIP-only and the
  NetworkPolicy allows ingress only from the locations pod. A hosted profile
  must add auth/TLS before exposing it.
- `helm test` for locations calls `/ready` from a busybox pod.

## 9. Migration stages

| Stage | Deliverable | Evidence |
|---|---|---|
| M6 | Baseline inventory, v1 contract, service skeleton + seed | API/locations tests, typecheck, image build, this doc |
| M6b | API client, `LOCATIONS_MODE`, resolver + agent façade cutover | Both-mode tests, typecheck, agent tests unchanged |
| M6c | Compose service, seed ownership, e2e | `compose ps` healthy + search/activities/details/favorite/agent/invite smoke |
| M6d | Mongo StatefulSet + locations workload in Helm | `helm lint`, kubeconform, `helm test`, cluster acceptance |
| M6e | Remove API Mongo adapter/dependency, docs, acceptance | grep proves one Mongo owner; full test matrix |

## 10. Test matrix

Locations service:

- Unit: tokenizer, ranking/limits, radius filter, seed mapping, DTO shape.
- MongoDB integration: indexes, get by id/place id, search, destinations,
  activities by parent/category, upsert dedupe, seed idempotency (run twice,
  same count, no duplicates).
- HTTP: `/health`, `/ready`, 401 without token, 400 invalid params, 404
  missing id, 403 seed disabled, graceful shutdown.

API:

- Remote mode against a fake locations server: destinations, activities,
  search, by id, by place id; favorites-first ranking; 20/10 limits.
- Local mode still passes the existing catalogue tests until M6e.
- Transport failure maps to `LOCATIONS_UNAVAILABLE` without leaking the URL or
  token.
- Internal agent endpoints keep their response shapes.

End-to-end:

- Compose search for a Toronto place, category filter, details, favorite,
  add item, agent suggestion, invite/email (sink).
- Helm: Mongo ready, locations 2/2, API search through the service, proxy
  401/403/200, invite path still works.

## 11. Rollback

- Before M6e: set `LOCATIONS_MODE=local` on the API and keep `MONGODB_URL`
  configured. The in-process adapter still exists for exactly this case.
- After M6e: redeploy the previous API image tag with `LOCATIONS_MODE=local`
  and the previous Compose/Helm values. Document the tag in the release notes.
- The locations service is additive: disabling `locationsService` must not
  break the email pipeline.

## 12. Risks and open decisions

- **Cross-store ranking**: moving favorites ranking into the service would
  couple Mongo to Postgres. Keep it in the API; the service returns candidates.
- **Seed race**: demo trip items reference stable place ids. If the API serves
  before the seed finishes, the first search can be empty. `depends_on`
  readiness (Compose) and `/ready` (Helm) mitigate this; the smoke test asserts
  a non-empty search after boot.
- **Shared internal token**: one token covers broker, email, agent and
  locations. Per-service tokens are a follow-up hardening task, not part of
  this migration.
- **Mongo permissions**: read-only root plus a PVC requires `fsGroup: 999`.
  Verify on Docker Desktop before claiming M6d done.
- **Dataset duplication**: the locations image must copy
  `backend/db/toronto-locations.json` and the seed images stay with the API for
  `/uploads/seed/*`. Keep the JSON as the single source of truth.
- **gRPC**: deferred. Revisit after the locations HTTP contract has run in the
  demo for a release.

## 13. Local evidence (M6c, 2026-11-21)

- `backend/locations-service`: 16 tests pass, `bunx tsc --noEmit` clean; image
  builds and starts as non-root.
- `backend/server`: 77 tests pass, typecheck clean; 8 of those cover the remote
  client and the GraphQL guard.
- Compose: `locations` healthy, API logs `catálogo remoto
  (http://locations:4300)` and seeds Postgres only.
- GraphQL through the web proxy: destinations, search, activities and details
  return Toronto data with `isFavorite` flags.
- Agent path: `/internal/search-places`, `/internal/place-details` and
  `/internal/places-cache/demo-trip` (186 places) work; `auto-suggest` and
  suggestions pass in demo mode.
- Failure injection: stopping `locations` returns
  `LOCATIONS_UNAVAILABLE` in GraphQL and `503 LOCATIONS_UNAVAILABLE` on the
  internal route; restart recovers.
- `scripts/smoke.ps1` passes all checks, including the new activities and
  details checks.
- Port 4300 is used because the agent already owns 4100.

### M6d Helm acceptance (2026-11-21)

- Chart `0.3.0`: `helm lint` clean; kubeconform strict 24/24 on the default
  render, 28/28 with NetworkPolicies enabled and 21/21 in proxy-disabled Role
  mode.
- Namespace audit: 22 namespaced objects, 0 without
  `metadata.namespace`; ClusterRole/Binding are the only cluster-scoped
  objects.
- Docker Desktop: `triplanner-mongo-0` 1/1 and `triplanner-locations` 2/2
  (app + sidecar); both `/ready` checks pass and the service reports 187
  seeded places.
- `helm test`: email and locations suites both `Succeeded`.
- Locations proxy: 401 without a token, 403 with an authenticated unauthorized
  token, 200 with a client SA allowed `get services/proxy`.
- API cutover against the cluster: with the Compose locations container
  stopped, the API reached the chart service through
  `host.docker.internal:4300` and served destinations, search and activities;
  normal Compose smoke passes after restoring the local service.
- Mongo runs as non-root with a read-only root filesystem, `/data/db` on the
  `data-triplanner-mongo-0` PVC and `/tmp` on emptyDir.
