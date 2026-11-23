# AGENTS.md — local_triplanner

Project: **local_triplanner** — a recruiter-ready, local-only Triplanner demo.
Collaborative travel planning app (itinerary, budgets, attachments, real-time
collaboration, AI suggestions, routes/Uber deep links). Product UI is **English
by default**, with an es/en switch.

Orkai category id: `ba4c49a10fa15dd100c16c61383f6529`.
Owner: Marco (GitHub `MarcoJr1312`).
Working branch: current delivery branch; never push to `main`.

**Call `overview()` and read `project_preferences` for the category above before
project work.** The Orkai plan is **Local Recruiter Demo — v1** with milestones
M1–M6.

## Goal

A recruiter with Docker Desktop only can run:

```bash
git clone <repo>
cd local_triplanner
docker compose -f deploy/docker-compose.yml up --build
```

and use the app at http://localhost:3000 with no Firebase, HasData or AWS
account. Optional LLM providers and the recruiter-supplied Resend key (BYOK) are
the only external integrations.

## Target architecture

| Area | Target |
|---|---|
| Web | Next.js 15 App Router, React 19, Tailwind v4, shadcn/ui |
| API | Bun + graphql-yoga |
| Relational | PostgreSQL 17 + pgvector |
| Locations | Bun/TS `locations` service + MongoDB 7, optional HasData BYOK with Mongo cache |
| Trips | Bun/TS `trips` service + PostgreSQL 17, own credentials and outbox |
| Users | Bun/TS `users` service + PostgreSQL 17, Argon2id login and local-invite notifications |
| Agent | Python 3.12 + FastAPI + Agno + pgvector |
| Orchestration | Docker Compose and Helm, built from source |

Runtime services: `web`, `api`, `locations`, `trips`, `users`, `agent`, `postgres`,
`trips-postgres`, `users-postgres`, `mongo`.

## Hard constraints

- **No Firebase** at runtime. Accounts live in the users service with
  username + password (Argon2id) and fixed demo UUIDs
  `11111111-1111-4111-8111-111111111111` (`demo` / `demo123`) and
  `22222222-2222-4222-8222-222222222222` (`demo-friend` / `demo123`). Requests
  carry `x-user-id: <uuid>`; there is no JWT.
- **HasData is optional BYOK at runtime.** The default is the committed Toronto
  catalogue in MongoDB. A recruiter-supplied key lives on the locations PVC and
  HasData results are cached in MongoDB with a 5-day TTL; no key ships in the
  repo or chart. The one-time ingestion script still refreshes the committed
  dataset.
- **One MongoDB owner**: `backend/locations-service` owns the catalogue. The API
  and agent must call its internal REST v1 contract, never MongoDB directly.
- **MongoDB auth is on.** Demo credentials live in `values.yaml`, render into
  the `triplanner-mongo-credentials` Secret, and are demo-only. Production must
  use `mongo.auth.existingSecret` managed by HashiCorp Vault, External Secrets
  or an equivalent secret store; never commit real credentials.
- **Email is optional and off by default.** `EMAIL_MODE=disabled` keeps the
  demo key-free; invitations expose a copyable join link. The recruiter can add
  their own Resend key in Settings → Email delivery (BYOK); no key ships with the
  repo or chart. The email service consumes `TripInvitation` from the Go demo
  broker.
- **Broker**: `backend/kafka` is a Go HTTP topic/offset/ack demo broker with
  SQLite. It is not Kafka wire-compatible; gRPC is the next transport. The API
  is the producer and the email service is the consumer.
- **No AWS**: no Terraform, ECS, S3, DynamoDB, Secrets Manager or OIDC.
- **No emulators**: no Firebase emulator, no SMTP catcher, no HasData mock.
- **LLM providers are optional**: `LLM_PROVIDER=none` by default; `deepseek`,
  `openai`, `anthropic`, `ollama` via env only.
- No secrets in the repo, images, logs or browser. Non-root containers.
- Only `web` is published by default; data stores stay on the Compose network.

## Current migration state

The repo was cloned from `dev_triplanner` and fast-forwarded to the
`aws_triplanner` main history to inherit the tested Postgres data layer, demo
auth and Dockerfiles.

- M1.3 done (`d901d9b`): Firebase removed, `demo-user` + `demo-friend`.
- M1.4 done (`0d042e9`): Resend removed; invitations return a copyable join
  link and the reminder email sweep is disabled.
- M1.5 done (`c3657ad`): HasData runtime removed; place search is catalogue-only.
- M1.6 done: AWS surface removed; runtime is Postgres + MongoDB + local disk.
- M2 data layer done: `MongoLocationCatalogue`, catalogue-only search, and the
  Postgres + Mongo integration suites (59 tests).
- M3 done (`d8211de`): 186 real Toronto places and 80 local images seeded from
  HasData; the demo trip mixes sight, food, activity and nightlife.
- M4 done: full Compose stack (web, api, agent, Postgres, MongoDB) is healthy;
  `docker compose -f deploy/docker-compose.yml up --build` boots and seeds the demo in one command.
- M5 done (`a283eff`): optional LLM providers, deterministic demo AI and the
  AI demo-mode badge.
- M6 done (`0a84de3`): tour, troubleshooting, smoke scripts, CI, Windows
  clean-clone QA and the `v1.0.0` tag.
- CI/CD upgrade (`v1.1.0`): per-service workflows in `.github/workflows/`,
  multi-arch Docker Hub images and `deploy/docker-compose.hub.yml`.
- Trips release (`v1.3.0`): trips service + remote-only API, chart 0.6.1.
  Images `marcojr13/triplanner-trips:0.1.0`/`latest` (`sha256:dab2803…`),
  `marcojr13/triplanner-api:1.2.0`/`latest` (`sha256:783b54c…`) and
  `marcojr13/triplanner-email:0.1.1`/`latest` (`sha256:e5319f4…`), all amd64 +
  arm64. `v1.3.1` is the email patch that enables `email.member.joined.v1`.
  The published Hub stack passed the demo smoke.
- CI/CD verified: 8/8 GitHub Actions runs passed; published images
  `marcojr13/triplanner-{web,api,agent}` (tags `latest`, `1.1`, `1.1.0`,
  `sha-e335779`) and the published stack passed the smoke test.
- Email microservice: Resend/sink with BYOK settings, 0600 runtime overrides
  on a PVC, GraphQL proxy and Profile UI; images `marcojr13/triplanner-email`.
- Go broker: `backend/kafka` (HTTP topic/offset/ack + SQLite) with topic
  `TripInvitation`; API producer, email consumer and DLQ `TripInvitation.dlq`.
- Helm chart: deploys the Go broker + email service with PVCs, probes,
  `triplanner-internal`, per-service ServiceAccounts and ClusterRoles for the
  kube-rbac-proxy sidecars (TokenReview/SAR; HTTP 8443 local-only); accepted on
  Docker Desktop (both pods ready, invite consumed, BYOK persisted, DLQ verified).
- Locations service: `backend/locations-service` (Bun/TS, internal REST v1,
  `:4300`) owns MongoDB and the 187-row Toronto seed. The API delegates
  GraphQL/agent reads and keeps favorites/limits in Postgres; the agent still
  calls the API facade. Helm chart 0.5.0 adds the locations workload and a
  single-node MongoDB StatefulSet; accepted on Docker Desktop. Image
  `marcojr13/triplanner-locations:0.2.1`.
- HasData BYOK: Settings → Places data stores a service-wide key on the
  locations PVC (0600). `provider=preloaded` uses the committed catalogue;
  `provider=hasdata` calls HasData and caches results in MongoDB with a 5-day
  TTL (`expires_at_ttl`). HasData failures fall back to cache.
- MongoDB auth: root credentials are rendered into the
  `triplanner-mongo-credentials` Secret from the demo `values.yaml`; production
  overrides `mongo.auth.existingSecret` with Vault/External Secrets.
- Known limitation: macOS clean-clone QA is pending.
- M9 (trips service, PostgreSQL) complete: contract, schema/migrations,
  trips/members/items, invitations + transactional outbox, API cutover,
  idempotent legacy import, Compose stack (`trips` + `trips-postgres`) and Helm
  chart 0.6.1 accepted on Docker Desktop. `TRIPS_MODE` and the legacy trip
  tables were removed in M9.11; the API is remote-only. Evidence:
  `docs/migrations/0006-trips-service.md` and `0007-trips-qa.md`.
- M10 (users service, PostgreSQL) through Gate 2: accounts, Argon2id login,
  search/batch, protected soft delete, notifications, local invites by username,
  accept/decline, `onNotification`, fixed-UUID migration, users +
  users-postgres in Compose/Helm (chart 0.7.0), and the M10.13 platform
  users/notifications decommission. No `USERS_MODE`; the API is remote-only.
  Evidence: `docs/migrations/0008-users-service.md`,
  `0009-users-cutover.md` and `0010-users-qa.md`. M10.14 (image publish,
  Helm acceptance, tag) ships in `v1.6.0`.
- M11 done (`2da2fe3`): the Next.js web is a Helm workload (`triplanner-web`)
  behind nginx ingress at `http://triplanner.localhost`, chart 0.8.0. Adds
  `/api/health` + `/api/ready` (readiness gates on config only and reports API
  reachability as `backend: ok|down`), SSE-safe ingress annotations, a
  non-root/read-only pod, an optional NetworkPolicy and the
  `deploy/docker-compose.frontend-helm.yml` transition overlay that publishes
  the still-Compose API/agent. Evidence:
  `docs/migrations/0011-frontend-service.md` and `0012-frontend-qa.md`
  (Gate 2 approved). The web image and M10.14 ship in `v1.6.0`.
- M12 (private favorites): `favorite_locations` lives in the users service
  (favorites schema v2; users is now at v3 with reminder notifications), the
  API uses a request-scoped favorite set from `UsersStore`, and the platform
  `pg/favorites` module is gone. The heart works for legacy trip IDs and
  catalogue IDs, manual activities have no heart, and failures show a localized
  error. Contract `docs/migrations/0013-user-favorites.md`; migration script
  `backend/users-service/scripts/migrate-favorites.ts`.
- M13 done (`52190cc`): activity reminders. Trips owns one reminder per
  activity (owner/editor only, selected member recipients, mandatory activity
  time, leads 15/30/60/120) in schema v4; the users service stores
  `activity_reminder` notifications with a per-user dedupe key; the API sweeps
  due reminders every 30 s, applies a 15-minute grace, publishes
  `onNotification` and marks recipients sent. The bell opens a configuration
  dialog; viewers see read-only state. Demo trip uses `America/Toronto`.
  Evidence: `docs/migrations/0014-activity-reminders.md` and
  `0016-reminders-qa.md` (Gate 2 approved). Release `v1.6.0` covers M12 + M13.
- M14 done (`5c7c8f6`): the agent owns a dedicated PostgreSQL 17 + pgvector
  database and syncs places from the locations service through a Mongo outbox
  and broker topic `LocationChanged`, with snapshot bootstrap and periodic
  reconcile. Weak prompt matches call the locations service once, index the
  extra places and re-query. Compose/Helm include the agent and its database;
  the platform agent tables and vector extension are decommissioned. Evidence:
  `docs/migrations/0017-agent-service.md` and `0018-agent-qa.md` (Gate 2
  approved). Release `v1.7.0`.
- Helm chart 0.12.0: every application workload reads non-secret environment
  from `triplanner-<service>-config` via `envFrom.configMapRef`; secrets stay as
  `secretKeyRef` entries. A `checksum/config` annotation rolls the pod when a
  value changes. The chart includes the agent and its pgvector PostgreSQL.
- M15 done (`feature/grpc-api`): native gRPC between the API facade and the
  users/trips/locations services, with `x-internal-token`/`x-actor-id`
  metadata, `grpc.health.v1.Health`, stable `x-error-code` mapping and
  `*_TRANSPORT=grpc` Compose defaults after Gate 2. HTTP internal routes remain
  one release for rollback; agent/broker/email stay HTTP. Chart 0.12.0 exposes
  ClusterIP gRPC ports 50051–50053. Evidence:
  `docs/migrations/0019-grpc-api.md` and `0020-grpc-qa.md`.
- Test databases: users tests default to `users_test` and trips tests to
  `trips_test` on `127.0.0.1:55433`/`55432` (never the live `users`/`trips`
  databases).
Do not assume the target architecture is already implemented — check the
current tree.

## Product conventions (do not regress)

- English UI default with mirrored es/en i18n keys; every string goes through
  `t()`, API errors use stable codes.
- Membership checks on every read/mutation; attachments are gated by per-file
  visibility and short-lived HMAC URLs.
- Avatars and attachments are served same-origin through the web proxy.
- Routes use Google Maps deep links; Uber deep links never preload a pickup.
- Every Helm manifest for a namespaced kind sets
  `metadata.namespace: {{ .Release.Namespace }}`. Cluster-scoped objects
  (ClusterRole, ClusterRoleBinding) are the only exception and omit it.
- Package manager is **bun** for JS projects; Python uses **uv**.

## Local commands

```bash
docker compose -f deploy/docker-compose.yml up --build        # full demo
docker compose -f deploy/docker-compose.yml down              # stop, keep volumes
docker compose -f deploy/docker-compose.yml down -v           # reset data
cd backend/server && bun test      # API tests (needs Postgres)
cd backend/server && bunx tsc --noEmit
cd backend/trips-service && bun test        # needs trips PostgreSQL
cd backend/trips-service && bunx tsc --noEmit
cd backend/users-service && bun test        # needs users PostgreSQL
cd backend/users-service && bunx tsc --noEmit
cd backend/locations-service && bun test    # needs MongoDB
cd backend/locations-service && bunx tsc --noEmit
cd frontend-next && bun test
cd frontend-next && bunx tsc --noEmit
cd backend/agent-service && uv run python tests/test_m2.py
```

## Working rules

- One branch per delivery: `feature/*` or `fix/*`. Commit at the end of every
  finished unit of work; ship tests in the same commit.
- Run tests and typecheck before claiming a slice is done. Report command output
  as evidence.
- Update the Orkai task/milestone status when work moves.
- Do not invent owners, dates or acceptance evidence; use `TBD`.

## Delivery cycles (human-in-the-loop)

Migration work runs through one of two Orkai cycles. Name the cycle and the
slice in the session header before starting. Both cycles stop at explicit human
gates — a green test run, a prior approval or silence is **not** consent.

| Cycle | Steps | Use for |
|---|---|---|
| **Microservice Code Migration** (`19455fa3-28ea-4f03-b195-973c5ddf595e`) | PM → **Gate 1** (contract) → Backend → QA → **Gate 2** (merge) → decommission | Service extraction, cutover, decommission, event schema, data-ownership changes |
| **Kubernetes Manifest Delivery** (`bf155f51-737c-4138-a439-01d547450118`) | PM → **Gate 1** (scope/exposure) → QA verification plan → Backend readiness → SRE → **Gate 2** (readiness) → QA sign-off | Chart, image, RBAC, Secret, PVC, probe, NetworkPolicy, cluster acceptance |

Role workflows:

- Microservice PM — `0350c390-ead3-46d6-b99a-e1b5bff119a6`
- Senior Backend Engineer — `269bc7be-73ff-4eab-8b63-b13de4ff33c9`
- SRE / DevOps — `9cbce416-d411-4f69-bbe5-4bcaf4bd4a1b`
- QA — `c14512b2-f67c-42b4-98b9-97c8ad950387`
- Human Decision Gate — `52d858fd-af66-4ca8-ad23-b38235b44c5d` (one decision,
  evidence, max three options, a recommendation, explicit answer)

Both cycles are invocable in OpenCode as subagents: `ms-pm`,
`senior-backend`, `sre-devops`, `qa-migration` under `.opencode/agents/`.

Rules: a contract or scope change re-enters Gate 1; P1/P2 defects block
sign-off; no merge, image publication, decommission or security relaxation
without explicit human approval.

## Orkai workflow

1. `overview(category_id: "ba4c49a10fa15dd100c16c61383f6529")`
2. `project_preferences(action: "get", category_ids: ["ba4c49a10fa15dd100c16c61383f6529"])`
3. `cycle(action: "list", status: "active", category_ids: [...])` — pick the
   cycle, then `workflow(action: "get", id: ...)` per step.
4. `plan` / `milestone` / `tasks` for the active slice.
5. Search Orkai before reading large files; re-index after source changes.
