# AGENTS.md — local_triplanner

Project: **local_triplanner** — a recruiter-ready, local-only Triplanner demo.
Collaborative travel planning app (itinerary, budgets, attachments, real-time
collaboration, AI suggestions, routes/Uber deep links). Product UI is **Spanish
by default**, with an es/en switch.

Orkai category id: `ba4c49a10fa15dd100c16c61383f6529`.
Owner: Marco (GitHub `MarcoJr1312`).
Working branch: `feature/local-runner`. Never push to `main`.

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
| Locations | Bun/TS `locations` service + MongoDB 7, seeded with real Toronto data |
| Agent | Python 3.12 + FastAPI + Agno + pgvector |
| Orchestration | Docker Compose, built from source |

Runtime services: `web`, `api`, `locations`, `agent`, `postgres`, `mongo`.

## Hard constraints

- **No Firebase** at runtime. Demo auth via `x-user-id`; seeded `demo-user` and
  `demo-friend`.
- **No HasData** at runtime. A one-time ingestion script writes the committed
  Toronto dataset; search reads MongoDB only through the locations service.
- **One MongoDB owner**: `backend/locations-service` owns the catalogue. The API
  and agent must call its internal REST v1 contract, never MongoDB directly.
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
  calls the API facade. Helm chart 0.3.0 adds the locations workload and a
  single-node MongoDB StatefulSet; accepted on Docker Desktop.
- Known limitation: macOS clean-clone QA is pending.
Do not assume the target architecture is already implemented — check the
current tree.

## Product conventions (do not regress)

- Spanish UI default with mirrored es/en i18n keys; every string goes through
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
cd backend/locations-service && bun test    # needs MongoDB
cd backend/locations-service && bunx tsc --noEmit
cd frontend-next && bun test
cd backend/agent-service && uv run python tests/test_m2.py
```

## Working rules

- One branch per delivery: `feature/*` or `fix/*`. Commit at the end of every
  finished unit of work; ship tests in the same commit.
- Run tests and typecheck before claiming a slice is done. Report command output
  as evidence.
- Update the Orkai task/milestone status when work moves.
- Do not invent owners, dates or acceptance evidence; use `TBD`.

## Orkai workflow

1. `overview(category_id: "ba4c49a10fa15dd100c16c61383f6529")`
2. `project_preferences(action: "get", category_ids: ["ba4c49a10fa15dd100c16c61383f6529"])`
3. `plan` / `milestone` / `tasks` for the active slice.
4. Search Orkai before reading large files; re-index after source changes.
