# Triplanner — Local Recruiter Demo

Collaborative travel planning web app. Plan a trip with your team: build a
day-by-day itinerary, organize activities and budgets, invite collaborators,
attach tickets with per-file visibility, get AI suggestions, and jump straight
to Google Maps routes or an Uber deep link.

The product UI is **English by default**, with an **es/en** switch in the
profile settings.

> **Status:** **v1.2.2** - one-command Docker Compose demo plus per-service
> CI/CD and multi-arch Docker Hub publishing. The cloud dependencies (Firebase,
> HasData, Resend, AWS) are removed from the runtime; place search reads a local
> MongoDB catalogue seeded with 186 real Toronto places.

## Documentation

- [10-minute demo tour](docs/DEMO_TOUR.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Release notes v1.1.0](docs/RELEASE_NOTES_v1.1.0.md)
- [Release notes v1.0.0](docs/RELEASE_NOTES_v1.0.0.md)
- [QA matrix](docs/QA_MATRIX.md)
- [CI/CD and Docker Hub](docs/CICD.md)

## What works now

- **Demo auth** — two seeded identities: `Demo` (owner) and `Demo Friend`
  (collaborator). No Firebase, no password, no external account.
- **Trips and itineraries** — day-by-day plans, categories, costs and budgets.
- **Collaboration** — invitations produce a copyable join link; the second demo
  identity can join the trip. No email is sent in this demo.
- **Places** — catalogue-only search over the seeded Toronto data in MongoDB.
- **Uploads** — avatars, covers and attachments on local disk.
- **AI agent** — deterministic demo mode by default, optional DeepSeek /
  OpenAI / Anthropic / Ollama providers.
- **Routes / Uber** — Google Maps multi-stop links and Uber deep links.

## Architecture

```
Browser
  │ http://localhost:3000
  ▼
web (Next.js 15)
  ├─ /api/graphql ──▶ api (Bun + graphql-yoga :4000)
  │                     ├─▶ postgres:5432 (relational + pgvector)
  │                     └─▶ mongo:27017 (locations)
  ├─ /api/agent/* ──▶ agent (FastAPI :4100)
  │                     ├─▶ postgres (pgvector embeddings)
  │                     └─▶ optional LLM provider
  └─ /uploads/* ─────▶ api :4000 ──▶ local uploads
```

The browser only talks to the Next.js origin. Backend URLs and keys never reach
the client.

## Tech stack

| Area | Stack |
|---|---|
| Frontend (`frontend-next/`) | Next.js 15 App Router, React 19, TypeScript, shadcn/ui on Radix, Tailwind v4 |
| Backend (`backend/server/`) | TypeScript on Bun, graphql-yoga, Postgres (`pg`), MongoDB (`mongodb`) |
| Agent (`backend/agent-service/`) | Python 3.12, uv, FastAPI, Agno, pgvector |
| Data (`backend/db/`) | Postgres `pg/schema.sql` + idempotent seed; MongoDB Toronto catalogue |
| Local infra | Docker Compose: web, api, agent, PostgreSQL 17 + pgvector, MongoDB 7 |

## Repository layout

```
.
├── frontend-next/          Next.js app (App Router, shadcn/ui, i18n)
├── backend/
│   ├── server/             GraphQL API, demo auth, uploads
│   ├── agent-service/      FastAPI suggestion agent (pgvector)
│   ├── db/                 Postgres schema + seed data
│   ├── graphql/            base schema
│   └── .env.example        backend configuration template
├── docker-compose.yml      web + api + agent + Postgres + MongoDB
└── AGENTS.md               working agreement for AI agents
```

## Quickstart (recruiter)

**Prerequisite:** Docker Desktop (4 GB RAM recommended).

```bash
git clone https://github.com/MarcoJr1312/local_triplanner.git
cd local_triplanner
docker compose up --build
```

Open http://localhost:3000/login and choose **Demo (owner)** or **Demo Friend**.

The first build takes a few minutes. All five services become healthy:

```bash
docker compose ps
```

| Service | Purpose |
|---|---|
| `web` | Next.js UI on http://localhost:3000 |
| `api` | GraphQL API (internal) |
| `agent` | FastAPI suggestions (internal) |
| `postgres` | Relational data + pgvector |
| `mongo` | Toronto location catalogue |

Useful commands:

```bash
docker compose down       # stop, keep data
docker compose down -v    # reset data, re-seed on next start
docker compose logs -f api
```

### What to try

1. Open the seeded Toronto trip (Dec 4–6, 2026).
2. Search for **CN Tower**, **ROM** or a restaurant.
3. Invite **Demo Friend** from the trip and open the copied link in an
   incognito window.
4. Upload an avatar or an activity attachment.
5. Ask the AI agent for suggestions.

## Development mode (optional)

Requires Bun, uv/Python 3.12 and Docker for the data stores.

```bash
docker compose up -d postgres mongo
cp backend/.env.example backend/.env

# API :4000
cd backend/server && bun install && bun run db:migrate && bun run db:seed && bun run dev

# Web :3000
cd frontend-next && bun install && bun run dev

# Agent :4100
cd backend/agent-service && uv sync
uv run uvicorn tripsuggest.main:app --host 127.0.0.1 --port 4100
```

## Invitations

There is no email provider in this demo. Open a trip → **Invite**, create the
invitation, copy the link, and open it in an incognito window. The second demo
identity joins the trip. The invite form is prefilled with
`friend@triplanner.local`.

## Configuration

### Backend (`backend/.env`)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `MONGODB_URL` | MongoDB connection string |
| `APP_URL` | Public frontend base for invitation links |
| `LOCAL_PORT` | GraphQL port (default `4000`) |
| `ATTACHMENT_TOKEN_SECRET` | HMAC secret for signed attachment URLs |
| `INTERNAL_TOKEN` | Shared secret for `/internal/*` endpoints |
| `AGENT_BASE_URL` | Agent base URL (default `http://127.0.0.1:4100`) |
| `TRIPLANNER_UPLOADS_OVERRIDE` | Optional uploads directory |

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
provider from the app: open **Profile / Settings** (gear icon) → **AI provider**,
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
docker compose up -d --build agent web
```

## CI/CD and Docker Hub

Each service has its own GitHub Actions workflow and test suite:

| Workflow | Tests | Docker image |
|---|---|---|
| `web.yml` | `frontend-next/lib/*.test.ts` | `triplanner-web` |
| `api.yml` | `backend/server/test/*.test.ts` | `triplanner-api` |
| `agent.yml` | `backend/agent-service/tests/test_m2.py` + `tests/test_settings.py` | `triplanner-agent` |
| `compose-smoke.yml` | full Compose + `scripts/smoke.sh` | no push |

Add `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` (Read & Write token) to the
GitHub repository secrets. Pushes to `main` publish `latest` + `sha-*`; tags
`v*` publish semver tags. Images are multi-arch (`amd64` + `arm64`).

Published images: `marcojr13/triplanner-{web,api,agent}` with tags
`1.2.2`, `1.2`, `latest` and `sha-3e15bed`. Run them without building:

```bash
docker compose -f docker-compose.hub.yml up -d
```

The file defaults to `DOCKERHUB_USERNAME=marcojr13` and `IMAGE_TAG=latest`.
Override them for a fork or a pinned version:

```bash
DOCKERHUB_USERNAME=youruser IMAGE_TAG=1.2.2 \
  docker compose -f docker-compose.hub.yml up -d
```

See [docs/CICD.md](docs/CICD.md) for setup, tags and release flow.

## Toronto dataset (maintainers)

The recruiter catalogue is generated once from HasData and committed:

```bash
cp backend/.env.fetch.example backend/.env.fetch
# put HASDATA_API_KEY=... in backend/.env.fetch (gitignored)
bun backend/server/scripts/fetch-toronto.ts
cd backend/server && bun run db:seed
```

The script writes `backend/db/toronto-locations.json`, optional local images under
`backend/db/seed-images/`, and `backend/db/TORONTO_DATA.md`. The API runtime
never reads the key.

## Testing

```bash
# Backend: Postgres + MongoDB integration tests
cd backend/server && bun test
cd backend/server && bunx tsc --noEmit

# Agent: deterministic tests
cd backend/agent-service && uv run python tests/test_m2.py
cd backend/agent-service && uv run python tests/test_settings.py

# Frontend helpers
cd frontend-next && bun test
```

## Roadmap

1. **M1 (done)** — remove Firebase, Resend, HasData and AWS from the runtime.
2. **M2 (done)** — Postgres + MongoDB data layer and integration tests.
3. **M3 (done)** — 186 real Toronto places + 80 local images, seeded demo trip.
4. **M4 (next)** — Dockerfiles and one-command Compose stack for web/api/agent.
5. **M5** — demo identity switcher, invite link polish, optional LLM providers.
6. **M6** — recruiter README, demo tour, smoke script, CI and v1.0.0.

## Security

- Demo auth only; no production identity provider is wired.
- Membership checks on every read and mutation.
- Attachments are gated by per-file visibility and short-lived HMAC URLs.
- No live secrets in the current tree; the only historical finding is an old
  Firebase web key documented in [docs/SECURITY.md](docs/SECURITY.md).
