# Release notes — v1.7.0 (agent pgvector + activity intelligence)

| Field | Value |
|---|---|
| Status | Release candidate; Docker Hub publish and published-stack smoke pending |
| Chart | `helm-triplanner` 0.11.0 (`appVersion` 1.7.0) |
| Images | web, API, users, trips, locations and agent `1.7.0`; email `0.1.1`, broker `0.1.0` unchanged |
| Contracts | `docs/migrations/0017-agent-service.md` (plus 0013 favorites and 0014 reminders) |
| QA | `docs/migrations/0018-agent-qa.md` (Gate 2 approved; no P1/P2) |
| Supersedes | `v1.6.0`, `v1.5.0` and `v1.4.0`, which were never published |

## Highlights

### Agent-owned pgvector database (M14)

- The agent now owns a dedicated PostgreSQL 17 + pgvector database and no
  longer stores vectors in the platform PostgreSQL.
- The locations service versions places, writes a Mongo outbox and publishes
  `LocationChanged` to the Go HTTP broker. The agent bootstraps from the full
  locations snapshot, consumes the topic with a per-consumer offset, skips
  stale/duplicate versions, tombstones deletes and reconciles every five
  minutes. This is eventual consistency with a repair path, not synchronous
  replication.
- Weak prompt matches (score below 60/100 or fewer than K results) ask the
  locations service once for up to 20 places, index them and re-query. Strong
  prompts and auto-suggest do not call locations.
- The agent reconciles user interests from the API context, including an
  explicit clear, so Compose API and Helm agent stay aligned during the
  transition.
- Compose and Helm include the agent and its pgvector database; the Helm web
  points at the Helm agent. The API remains external until its own Helm slice.
- The platform `agent_embeddings`/`agent_index_state` tables and the platform
  `vector` extension are decommissioned; `/internal/places-cache` is removed.

### Previous features in this release

- Private favorites in the users service (M12), including legacy demo IDs and
  the heart error path.
- Owner/editor activity reminders with selected recipients, lead time and live
  in-app `onNotification` delivery (M13).
- Next.js web on Helm behind nginx ingress with `/api/health` and
  `/api/ready`, and per-service ConfigMaps for non-secret environment (M11).

## Upgrade

Compose (published images):

```bash
cd local_triplanner
DOCKERHUB_USERNAME=marcojr13 IMAGE_TAG=1.7.0 \
  docker compose -f deploy/docker-compose.hub.yml up -d
```

Helm (API/agent host ports published for the transitional web/agent):

```bash
docker compose -f deploy/docker-compose.yml \
  -f deploy/docker-compose.frontend-helm.yml up -d api agent

helm upgrade triplanner ./helm/helm-triplanner \
  --namespace triplanner \
  --set images.web.tag=1.7.0 \
  --set images.users.tag=1.7.0 \
  --set images.trips.tag=1.7.0 \
  --set images.locations.tag=1.7.0 \
  --set images.agent.tag=1.7.0 \
  --wait
```

The agent Postgres is a new StatefulSet/PVC. On Docker Desktop the agent pod
needs `host.docker.internal` for the still-Compose API; if DNS returns only
IPv6, set `agentService.hostAliases` to `192.168.65.254`. If the Helm internal
token differs from the Compose API token, create a Secret with `INTERNAL_TOKEN`
and set `agentService.backend.internalToken.existingSecret`.

## Behavior changes

- **Agent vectors are separate.** Platform backups no longer contain the vector
  index; the agent rebuilds it from the locations snapshot.
- **Locations now publishes events.** Compose includes the Go broker; the
  locations outbox retries until the broker accepts the event.
- **Interests are reconciled on read.** The agent compares its local interest
  rows with the API trip context and updates them, including clearing them.
- **Platform agent tables and extension are gone.** A database created before
  M14 should run `backend/db/pg/decommission-agent-vectors.sql`.
- **Hub Compose is migrated** for the kafka/agent-postgres workloads; run one
  Hub runtime smoke after the images are published.

## Verification

- Suites: locations 38/38, agent 14/14 + settings 7/7, users 67/67, trips 67/67,
  API 73/73, frontend 33/33; typechecks clean; `helm lint` clean;
  `helm test` 6/6 including the agent hook.
- Live Compose and Helm: locations snapshot (186 active places), event update,
  delete tombstone, stale/duplicate skip, broker outage retry, agent restart
  reconcile, DB-down readiness.
- Enrichment: weak prompt triggers exactly one locations search, indexes and
  re-queries; strong score and auto-suggest do not enrich.
- Auto-suggest survives a locations outage; interests add/remove/clear propagate
  to the Helm agent.
- Regression: invitations, favorites, reminders, uploads and ingress UI.
- Security: agent and agent Postgres are ClusterIP-only, non-root, no kube API,
  secrets stay out of ConfigMaps/logs.

## Publication checklist

1. Push `refactor/helm` (or merge to `main`) and tag `v1.7.0`; CI publishes
   `marcojr13/triplanner-{web,api,users,trips,locations,agent}:1.7.0` plus `1.7`
   and `sha-…` (amd64 + arm64).
2. Run the published-stack smoke: login/auto-suggest, send a suggestion prompt,
   heart a place, set a reminder, invite by username, and one Hub runtime boot.
3. Record the digests below and confirm the Helm release runs the `1.7.0` tags.
4. macOS clean-clone QA remains pending.

| Image | Digest |
|---|---|
| `marcojr13/triplanner-web:1.7.0` | TBD (CI) |
| `marcojr13/triplanner-api:1.7.0` | TBD (CI) |
| `marcojr13/triplanner-users:1.7.0` | TBD (CI) |
| `marcojr13/triplanner-trips:1.7.0` | TBD (CI) |
| `marcojr13/triplanner-locations:1.7.0` | TBD (CI) |
| `marcojr13/triplanner-agent:1.7.0` | TBD (CI) |
