# Triplanner — Local Recruiter Demo

> **Repository description:** A local-only collaborative travel-planning demo
> with a one-command Docker Compose stack: Next.js 15, Bun GraphQL API, Bun
> locations/trips/users services, FastAPI agent, PostgreSQL 17 + pgvector and
> MongoDB 7.

Collaborative travel planning web app. Plan a trip with your team: build a
day-by-day itinerary, organize activities and budgets, invite collaborators,
attach tickets with per-file visibility, get AI suggestions, and jump straight
to Google Maps routes or an Uber deep link.

The product UI is **English by default**, with an **es/en** switch in the
profile settings.

> **Status:** local delivery through **M28** — chart `0.21.0`, app `1.8.0`.
> Release tagging and image publication are deferred. The Compose stack remains
> the recruiter quickstart; the Helm/Cilium stack is the advanced local path.
> Four PostgreSQL exporters, one MongoDB exporter and 11 Grafana dashboards are
> live. Argo CD GitOps is live in `triplanner-agrocd`; the application images
> are pinned to the image build SHA `sha-5247619`.

## Documentation

- [Migration evidence and delivery log](docs/migrations/README.md)
- [Database exporters and dashboards](docs/migrations/0031-database-exporters.md)
- [Argo CD GitOps plan](docs/migrations/0032-argocd-gitops-plan.md)
- [Argo CD implementation evidence](docs/migrations/0033-argocd-gitops.md)
- [10-minute demo tour](docs/DEMO_TOUR.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Security notes](docs/SECURITY.md)
- [Release notes v1.4.0](docs/RELEASE_NOTES_v1.4.0.md)
- [Release notes v1.2.2](docs/RELEASE_NOTES_v1.2.2.md)
- [Release notes v1.1.0](docs/RELEASE_NOTES_v1.1.0.md)
- [Release notes v1.0.0](docs/RELEASE_NOTES_v1.0.0.md)
- [QA matrix](docs/QA_MATRIX.md)
- [CI/CD and Docker Hub](docs/CICD.md)

## What works now

- **Demo auth** — username + password, no Firebase and no JWT. Seeded accounts:
  `demo` / `demo123` (owner) and `demo-friend` / `demo123`; the recruiter can
  create and delete local accounts from the login screen.
- **Trips and itineraries** — day-by-day plans, categories, costs and budgets.
- **Collaboration** — invite by username (the invitee gets a notification in the
  bell and accepts/declines there) or create a copyable email join link. Email is
  optional: add a Resend key in Settings → Email delivery, otherwise no email is
  sent.
- **Users service** — accounts, Argon2id password login and the notification
  inbox live in `triplanner-users` with its own PostgreSQL.
- **Async email** — `TripInvitation` messages flow from the API through the Go
  demo broker to the email service; members show the invited email with a demo
  badge.
- **Places** - catalogue-first search over the seeded Toronto data in MongoDB.
  Add a HasData key in Settings → Places data to use live results; they are
  cached in MongoDB and expire after 5 days.
- **Uploads** — avatars, covers and attachments on local disk.
- **AI agent** — deterministic demo mode by default, optional DeepSeek /
  OpenAI / Anthropic / Ollama providers.
- **Routes / Uber** — Google Maps multi-stop links and Uber deep links.
- **Observability** — `/metrics` on every runtime, gRPC server metrics,
  p50/p95 latency, four PostgreSQL exporters, one MongoDB exporter and 11
  Grafana dashboards.

## Architecture

```
Browser
  │ http://localhost:3000
  ▼
web (Next.js 15)
  ├─ /api/graphql ──▶ api (Bun + graphql-yoga :4000)
  │                     ├─▶ postgres:5432 (relational + pgvector)
  │                     ├─▶ locations:4300 (Bun) ──▶ mongo:27017 (catalogue)
  │                     ├─▶ trips:4400 (Bun) ──▶ trips-postgres:5432
  │                     ├─▶ users:4500 (Bun) ──▶ users-postgres:5432
  │                     └─▶ broker :8080 (Go) ──▶ email :4200 ──▶ Resend/sink
  ├─ /api/agent/* ──▶ agent (FastAPI :4100)
  │                     ├─▶ postgres (pgvector embeddings)
  │                     └─▶ optional LLM provider
  └─ /uploads/* ─────▶ api :4000 ──▶ local uploads
```

The browser only talks to the Next.js origin. Backend URLs and keys never reach
the client.

The Helm stack splits the API facade into its own PostgreSQL database and adds
four service PostgreSQL instances (users, trips, API, agent), MongoDB, five
database exporters, Prometheus ServiceMonitors and 11 Grafana dashboards. The
Compose stack below keeps the shared `postgres` database for the API and agent.

## Tech stack

| Area | Stack |
|---|---|
| Frontend (`frontend-next/`) | Next.js 15 App Router, React 19, TypeScript, shadcn/ui on Radix, Tailwind v4 |
| Backend (`backend/server/`) | TypeScript on Bun, graphql-yoga, Postgres (`pg`) |
| Locations (`backend/locations-service/`) | TypeScript on Bun, internal REST v1, MongoDB (`mongodb`) |
| Trips (`backend/trips-service/`) | TypeScript on Bun, internal REST v1, PostgreSQL (`pg`) |
| Users (`backend/users-service/`) | TypeScript on Bun, internal REST v1, PostgreSQL (`pg`), Argon2id (`Bun.password`) |
| Agent (`backend/agent-service/`) | Python 3.12, uv, FastAPI, Agno, pgvector |
| Observability | Prometheus `/metrics`, kube-prometheus-stack, Grafana, `prometheus-postgres-exporter`, `prometheus-mongodb-exporter` |
| GitOps | Argo CD `argo/argo-cd` 10.20.0, Application `triplanner`, automated sync + selfHeal |
| Data (`backend/db/`) | Postgres `pg/schema.sql` + idempotent seed; Toronto catalogue JSON |
| Local infra | Docker Compose: web, api, locations, trips, users, agent, PostgreSQL 17 + pgvector, two service PostgreSQL databases, MongoDB 7 |

## Repository layout

```
.
├── frontend-next/          Next.js app (App Router, shadcn/ui, i18n)
├── backend/
│   ├── server/             GraphQL API, demo auth, uploads
│   ├── locations-service/  MongoDB catalogue + activity search (:4300)
│   ├── agent-service/      FastAPI suggestion agent (pgvector)
│   ├── db/                 Postgres schema + seed data + Toronto catalogue JSON
│   ├── graphql/            base schema
│   └── .env.example        backend configuration template
├── deploy/
│   ├── docker-compose.yml        source-build stack
│   ├── docker-compose.hub.yml    published images
│   ├── exporters/                PostgreSQL/MongoDB exporter values
│   └── kind/                     Cilium kind cluster, values and deploy scripts
├── helm/
│   └── helm-triplanner/          chart, dashboards and templates
├── scripts/                      bootstrap, deploy, QA and smoke helpers
└── docs/                         migration evidence, security and runbooks
```

`AGENTS.md`, `.opencode/` and `.orkai.yaml` are local-only and gitignored; a
fresh clone does not include them.

## Quickstart (recruiter)

**Prerequisite:** Docker Desktop (4 GB RAM recommended).

```bash
git clone https://github.com/MarcoJr1312/local_triplanner.git
cd local_triplanner
docker compose -f deploy/docker-compose.yml up --build
```

Open http://localhost:3000/login and sign in with **`demo` / `demo123`** (or
**`demo-friend` / `demo123`**).

The first build takes a few minutes. All services become healthy:

```bash
docker compose -f deploy/docker-compose.yml ps
```

| Service | Purpose |
|---|---|
| `web` | Next.js UI on http://localhost:3000 |
| `api` | GraphQL API (internal) |
| `locations` | Destinations/activities catalogue (internal, owns MongoDB) |
| `trips` | Trips, members, items and invitations (internal, owns its PostgreSQL) |
| `users` | Accounts, password login and notifications (internal, owns its PostgreSQL) |
| `agent` | FastAPI suggestions (internal) |
| `postgres` | Relational data + pgvector |
| `trips-postgres` | Trips service database |
| `users-postgres` | Users service database |
| `mongo` | Toronto location catalogue |

Useful commands:

```bash
docker compose down       # stop, keep data
docker compose down -v    # reset data, re-seed on next start
docker compose logs -f api
```

### Cluster demo (optional)

The chart in `helm/helm-triplanner` runs the Next.js web app behind a Cilium
Gateway + HTTPRoute, plus the broker, email, locations, trips, users and their
PostgreSQL databases and MongoDB on a local cluster. See the
[chart README](helm/helm-triplanner/README.md) and the
[Cilium kind setup](deploy/kind/README.md), then forward the services with one
command:

```bash
powershell -ExecutionPolicy Bypass -File scripts/port-forward.ps1 -Proxy
# or
bash scripts/port-forward.sh --proxy
```

The Helm web is at `http://triplanner.localhost:9080` through the Cilium
Gateway. The chart is self-contained: web, API facade, users, trips, locations,
agent, broker, email and their databases all run in the cluster. The Compose
stack remains a separate recruiter quickstart.

### Metrics

Every service exposes Prometheus text at `GET /metrics` on its existing HTTP
port. The endpoints are ClusterIP-only and never query a database. The Helm
web `/metrics` path redirects to `/` at the Cilium Gateway; Prometheus scrapes
the web Service directly.

```powershell
powershell -ExecutionPolicy Bypass -File scripts/metrics-smoke.ps1 -Target all
```

ServiceMonitors are disabled by default in the chart. The local
`prometheus` release in `kind-triplanner-cilium/monitoring` enables them and
scrapes **13 targets**: the 8 application runtimes plus 4 PostgreSQL exporters
and 1 MongoDB exporter. Grafana provisions **11 dashboards**: 8 per-service
dashboards, a Triplanner overview, PostgreSQL and MongoDB. Application metrics
include gRPC server counters for users, trips and locations, plus p50/p95
latency. Grafana and Prometheus stay ClusterIP-only:

```powershell
kubectl -n monitoring port-forward svc/prometheus-grafana 3001:80
# http://localhost:3001
```

See the [chart README](helm/helm-triplanner/README.md#metrics) and the
[Cilium kind guide](deploy/kind/README.md#monitoring).

### Database exporters

The Helm stack runs four `prometheus-postgres-exporter` releases (users, trips,
API and agent) and one `prometheus-mongodb-exporter` release. They use dedicated
read-only database users, ClusterIP-only Services and the upstream
prometheus-community charts.

```powershell
powershell -ExecutionPolicy Bypass -File scripts/bootstrap-exporters.ps1
powershell -ExecutionPolicy Bypass -File scripts/deploy-exporters.ps1
```

Evidence and operational notes:
[database exporters](docs/migrations/0031-database-exporters.md).

### GitOps

Argo CD runs in namespace `triplanner-agrocd` and owns the application after
the first sync:

- `argo/argo-cd` **10.20.0** (app v3.6.3), ClusterIP-only UI.
- Application `triplanner` watches
  `https://github.com/MarcoJr1312/local_triplanner`, revision `refactor/helm`,
  path `helm/helm-triplanner`, with automated sync and `selfHeal`.
- The kind values are supplied through a multi-source `$values` reference to
  `deploy/kind/triplanner-values.yaml`.
- Application images are pinned to the image build SHA `sha-5247619`, not a
  mutable tag.
- `prune` is disabled so PVCs and Secrets are not deleted by a sync.
- Helm upgrades are frozen for `triplanner`; changes go through Git.

Open the UI:

```powershell
kubectl -n triplanner-agrocd port-forward svc/argocd-server 8080:443
# https://localhost:8080
```

Runbook: [`deploy/argocd/README.md`](deploy/argocd/README.md). Plan and
evidence: [`docs/migrations/0032-argocd-gitops-plan.md`](docs/migrations/0032-argocd-gitops-plan.md).


### What to try

1. Open the seeded Toronto trip (Dec 4–6, 2026).
2. Search for **CN Tower**, **ROM** or a restaurant.
3. Invite **`demo-friend`** from the trip's **Invitar → Por usuario** tab, then
   sign in as `demo-friend` / `demo123` and accept from the bell.
4. Upload an avatar or an activity attachment.
5. Ask the AI agent for suggestions.

## Development mode (optional)

Requires Bun, uv/Python 3.12 and Docker for the data stores.

```bash
docker compose -f deploy/docker-compose.yml up -d postgres mongo
cp backend/.env.example backend/.env
cp backend/locations-service/.env.example backend/locations-service/.env

# Locations :4300 (owns MongoDB and seeds the catalogue)
cd backend/locations-service && bun install && bun run dev

# API :4000 (LOCATIONS_URL defaults to http://127.0.0.1:4300)
cd backend/server && bun install && bun run db:migrate && bun run db:seed && bun run dev

# Web :3000
cd frontend-next && bun install && bun run dev

# Agent :4100
cd backend/agent-service && uv sync
uv run uvicorn tripsuggest.main:app --host 127.0.0.1 --port 4100
```

## Invitations

Open a trip → **Invite**, create the invitation, and either copy the link or let
the email pipeline deliver it. The demo starts with `EMAIL_PROVIDER=sink`, so
no email is sent until the recruiter adds a Resend key in **Settings → Email
delivery**. The invite form is prefilled with `friend@triplanner.local`; the invited
email is preserved on the membership and shown with a **Demo** badge.

If you enter your own email, configure Resend in Settings, and click the link in
the email, the invitation is accepted for **Demo Friend**; the root Demo owner
stays untouched and the Demo Friend member row shows your email. The copyable
link keeps the confirmation button.

## Places data (BYOK)

Search starts with the committed Toronto catalogue in MongoDB, so no key is
needed. Open **Settings → Places data** to switch to HasData and paste your own
key. The key is stored only on the locations-service volume
(`locations.json`, mode `0600`) and is never returned to the browser. Search and
place details are cached in MongoDB; cached rows expire after 5 days via the
`expires_at_ttl` TTL index. If HasData is unavailable, the service serves the
cache. Switch back to **Preloaded catalogue** to clear the key.

## Configuration

### Backend (`backend/.env`)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `LOCATIONS_URL` | Locations service URL (default `http://127.0.0.1:4300`) |
| `LOCATIONS_TIMEOUT_MS` | Locations client timeout (default `2000`) |
| `APP_URL` | Public frontend base for invitation links |
| `LOCAL_PORT` | GraphQL port (default `4000`) |
| `ATTACHMENT_TOKEN_SECRET` | HMAC secret for signed attachment URLs |
| `INTERNAL_TOKEN` | Shared secret for `/internal/*` endpoints |
| `AGENT_BASE_URL` | Agent base URL (default `http://127.0.0.1:4100`) |
| `TRIPLANNER_UPLOADS_OVERRIDE` | Optional uploads directory |

The locations service reads its own env (`backend/locations-service/.env`):
`MONGODB_HOST`, `MONGODB_DB`, `MONGODB_USERNAME`, `MONGODB_PASSWORD`,
`MONGODB_AUTH_SOURCE`, `SETTINGS_FILE`, and the optional `HASDATA_*` values.
Demo Mongo credentials are `triplanner` / `triplanner`; the Helm chart uses
`triplanner` / `triplanner-demo`. These are demo-only. In production use a
secret manager (HashiCorp Vault, External Secrets, Sealed Secrets) or the
chart's `mongo.auth.existingSecret`.

### Agent (`backend/agent-service/.env`) — host development

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres with pgvector (same database as the backend) |
| `BACKEND_URL` | Internal backend base URL |
| `INTERNAL_TOKEN` | Shared secret with the backend |
| `LLM_PROVIDER` | `none` (default), `deepseek`, `openai`, `anthropic`, `ollama` |
| `LLM_API_KEY` | Provider key (not needed for `none` or local Ollama) |
| `LLM_MODEL` | Provider model id |
| `LLM_BASE_URL` | Optional endpoint; Ollama uses `.../v1` |

### LLM providers (Docker demo)

The default `LLM_PROVIDER=none` uses deterministic answers from the local
catalogue and shows an **AI demo mode** badge. A recruiter can configure a
provider from the app: open **Settings** (gear icon) → **AI provider**,
choose DeepSeek, OpenAI, Anthropic or a local Ollama, and paste the API token.
The token is stored only in the agent volume (`/app/.data/llm.json`), is never
returned to the browser, and new AI requests use the saved provider without a
restart.

Environment variables remain the fallback defaults. An in-app override takes
precedence. To set the defaults, create a root `.env` from `.env.example`:

```bash
cp .env.example .env

# DeepSeek
LLM_PROVIDER=deepseek
LLM_API_KEY=...
LLM_MODEL=deepseek-v4-pro

# OpenAI
LLM_PROVIDER=openai
LLM_API_KEY=...
LLM_MODEL=gpt-4o-mini

# Anthropic
LLM_PROVIDER=anthropic
LLM_API_KEY=...
LLM_MODEL=claude-sonnet-4-5-20250929

# Ollama on the host (no key)
LLM_PROVIDER=ollama
LLM_MODEL=llama3.1
LLM_BASE_URL=http://host.docker.internal:11434/v1
```

Then:

```bash
docker compose -f deploy/docker-compose.yml up -d --build agent web
```

## CI/CD and Docker Hub

Each service has its own GitHub Actions workflow and test suite:

| Workflow | Tests | Docker image |
|---|---|---|
| `web.yml` | `frontend-next/lib/*.test.ts` | `triplanner-web` |
| `api.yml` | `backend/server/test/*.test.ts` | `triplanner-api` |
| `users.yml` | `backend/users-service/test/*.test.ts` | `triplanner-users` |
| `trips.yml` | `backend/trips-service/test/*.test.ts` | `triplanner-trips` |
| `locations.yml` | `backend/locations-service/test/*.test.ts` | `triplanner-locations` |
| `agent.yml` | `backend/agent-service/tests/test_m2.py` + `tests/test_settings.py` | `triplanner-agent` |
| `compose-smoke.yml` | full Compose + `scripts/smoke.sh` | no push |

Add `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` (Read & Write token) to the
GitHub repository secrets. Pushes to `main` publish `latest` + `sha-*`; tags
`v*` publish semver tags. Images are multi-arch (`amd64` + `arm64`).

Published images: `marcojr13/triplanner-{web,api,agent}` with release tags
`1.2.2`, `1.2`, `sha-3e15bed`; `latest` tracks the current `main`. Run them
without building:

```bash
docker compose -f deploy/docker-compose.hub.yml up -d
```

> **Current local delivery:** the current Helm images are tagged
> `sha-5247619` and loaded into the kind node. Publishing the `1.8.0` service
> images and tagging the release are deferred; the published `1.2.2` images
> above are historical.

The file defaults to `DOCKERHUB_USERNAME=marcojr13` and `IMAGE_TAG=latest`.
Override them for a fork or a pinned version:

```bash
DOCKERHUB_USERNAME=youruser IMAGE_TAG=1.2.2 \
  docker compose -f deploy/docker-compose.hub.yml up -d
```

See [docs/CICD.md](docs/CICD.md) for setup, tags and release flow.

## Toronto dataset (maintainers)

The recruiter catalogue can be regenerated once from HasData and committed:

```bash
cp backend/.env.fetch.example backend/.env.fetch
# put HASDATA_API_KEY=... in backend/.env.fetch (gitignored)
bun backend/server/scripts/fetch-toronto.ts
cd backend/server && bun run db:seed   # Postgres demo data + images
docker compose -f deploy/docker-compose.yml restart locations  # reload catalogue
```

The script writes `backend/db/toronto-locations.json`, optional local images under
`backend/db/seed-images/`, and `backend/db/TORONTO_DATA.md`. The API never reads
the key; the locations service seeds the JSON on startup. At runtime, a
different HasData key can be entered in Settings → Places data; it is stored on
the locations PVC and cached results expire after 5 days.

## Testing

```bash
# Backend: Postgres integration tests (catalogue uses an in-memory fake)
cd backend/server && bun test
cd backend/server && bunx tsc --noEmit

# Locations: MongoDB integration + HTTP tests
cd backend/locations-service && bun test
cd backend/locations-service && bunx tsc --noEmit

# Agent: deterministic tests
cd backend/agent-service && uv run python tests/test_m2.py
cd backend/agent-service && uv run python tests/test_settings.py

# Frontend helpers
cd frontend-next && bun test

# Dependency audits (also enforced in the service workflows)
cd frontend-next && bun audit
cd backend/server && bun audit
# Agent: see docs/CICD.md for the pip-audit lockfile command
```

## Security

- Demo auth only; no production identity provider is wired.
- Membership checks on every read and mutation.
- Attachments are gated by per-file visibility and short-lived HMAC URLs.
- No live secrets in the current tree. The pre-push review on 2026-11-26
  returned **GO**: no new real credential is introduced by this branch.
- Demo-only values are intentional: the PostgreSQL/MongoDB passwords,
  `dev-internal-token` and `dev-attachment-secret` are local defaults and must
  never be reused outside the demo.
- The historical Firebase **web** key in `local/.env.example` was already
  public on `origin/main`; restrict or rotate it in Google Cloud independently.
  It is not a blocker for this push and no history rewrite is required.
- `AGENTS.md`, `.opencode/` and `.orkai.yaml` are local-only and gitignored.
  `.opencode/` history contains no secrets.
- `backend/.env.fetch` is untracked and holds a live-looking HasData key; it
  must stay ignored and must never be force-added.
- Full controls, accepted risks and scan details:
  [docs/SECURITY.md](docs/SECURITY.md).
