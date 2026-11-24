# 0021 — API facade as a Helm workload

| Field | Value |
|---|---|
| Status | **Implemented and accepted locally (2026-11-24)** |
| Cycle | Kubernetes Manifest Delivery |
| Chart | `helm-triplanner` 0.14.0 |
| URL | `http://triplanner.localhost:9080` |

## 1. Why

The domain capabilities were split into users, trips, locations, agent, email
and broker, but the GraphQL facade (`backend/server`) and its platform database
were still Compose-only. The Helm/Cilium web reached them through
`host.docker.internal` and a host-network socat proxy, and
`deploy/docker-compose.frontend-helm.yml` existed only to publish the API port.

This slice moves the API into the chart so the Helm demo is self-contained.

## 2. Scope

- `triplanner-api` Deployment/Service on ClusterIP `:4000`.
- Platform PostgreSQL `triplanner-api-postgres` (`postgres:17`, secret, PVC).
- Uploads PVC `triplanner-api-uploads`, mounted at `/app/uploads`.
- Init containers: wait for PostgreSQL, run `db:migrate` and `db:seed` (the
  seed copies the committed images into the uploads volume).
- API env: users/trips/locations over gRPC, agent/email HTTP, internal token,
  attachment HMAC secret, `APP_URL` from the Gateway.
- Web backend → `http://triplanner-api:4000/graphql`; agent backend →
  `http://triplanner-api:4000`.
- CiliumNetworkPolicy for the API and API Postgres.
- Remove `triplanner-host-proxy`, `webService.backendProxy`, and
  `deploy/docker-compose.frontend-helm.yml`.
- The Compose stack keeps its own API/agent/platform Postgres for the recruiter
  quickstart.

## 3. Chart details

- Image `images.api` (default `marcojr13/triplanner-api:1.7.0`).
- Secrets: `triplanner-api-postgres-credentials` (`POSTGRES_*` and
  `DATABASE_URL`) and `triplanner-api-attachments` (`ATTACHMENT_TOKEN_SECRET`).
- The API uses `triplanner-internal/INTERNAL_TOKEN`; the agent uses the same
  secret for its inbound and backend calls.
- `APP_URL` defaults to `http://<gateway host>:<gateway port>`.
- API probes use `/health`; the API connects to Postgres before listening.

## 4. Evidence

- `helm upgrade` to chart **0.14.0** on `triplanner-cilium`: all pods ready,
  including `triplanner-api` and `triplanner-api-postgres`.
- Gateway `Programmed=True`; HTTPRoute `Accepted=True`.
- `/api/ready` → `{"status":"ready","backend":"ok"}`.
- Login, `listMyTrips`, `getTrip`, `searchLocations` through the Gateway.
- `requestSuggestions` succeeded, exercising API → agent → API.
- Seed image served from the uploads PVC: `GET /uploads/seed/<file>` → 200.
- The Compose API and agent were recreated **without host ports** and then
  stopped; the Helm web still returned `backend: ok` and served GraphQL.
- `helm test` 7/7 suites succeeded (agent, API, email, locations, trips, users,
  web).
- Orkai M18.

## 5. Notes

- CiliumNetworkPolicy remains disabled on this Docker Desktop WSL2 kernel
  because `xt_socket` is missing; the API/API Postgres CNPs are included and
  validated but not enabled locally. See M17.2.
- The Helm API has a fresh platform database; the Compose API has its own. They
  are separate demo stacks.
- The `trips` demo title was updated to `Weekend in Toronto` through the Helm
  API after the new trips database seeded from the older local image. Source
  seeds already carry the English title.
- The old `docker-desktop` ingress still owns host port 80 and pointed at the
  removed host API. It now 301-redirects to `http://triplanner.localhost:9080`;
  see `deploy/kind/README.md`. Use `:9080` directly; the old release is only a
  fallback.
