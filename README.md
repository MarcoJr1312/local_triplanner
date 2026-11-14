# Triplanner — Local Recruiter Demo

Collaborative travel planning web app. Plan a trip with your team: build a
day-by-day itinerary, organize activities and budgets, invite collaborators,
attach tickets with per-file visibility, get AI suggestions, and jump straight
to Google Maps routes or an Uber deep link.

The product UI is **Spanish by default**, with an **es/en** switch.

> **Status:** local-first demo in progress. The cloud dependencies (Firebase,
> HasData, Resend, AWS) have been removed from the runtime; place search now
> reads a local MongoDB catalogue. Docker Compose packaging and the recruiter
> quickstart are the next milestones.

## What works now

- **Demo auth** — two seeded identities: `Demo` (owner) and `Demo Friend`
  (collaborator). No Firebase, no password, no external account.
- **Trips and itineraries** — day-by-day plans, categories, costs and budgets.
- **Collaboration** — invitations produce a copyable join link; the second demo
  identity can join the trip. No email is sent in this demo.
- **Places** — catalogue-only search over the seeded Toronto data in MongoDB.
- **Uploads** — avatars, covers and attachments on local disk.
- **AI agent** — FastAPI service with deterministic auto-suggest; the chat
  suggestion endpoint is being wired for the local demo.
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
| Local infra | Docker Compose: PostgreSQL 17 + pgvector, MongoDB 7 |

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
├── docker-compose.yml      local Postgres + MongoDB
└── AGENTS.md               working agreement for AI agents
```

## Prerequisites (current development)

- [Bun](https://bun.sh/)
- [Docker](https://www.docker.com/) for Postgres and MongoDB
- [uv](https://docs.astral.sh/uv/) and Python 3.12+ for the agent

The target recruiter flow will require **Docker Desktop only**; host installs
are temporary until the Compose packaging milestone lands.

## Run locally

### 1. Data stores

```bash
docker compose up -d
cp backend/.env.example backend/.env
```

### 2. Backend

```bash
cd backend/server
bun install
bun run db:migrate
bun run db:seed
bun run dev
```

GraphQL: http://localhost:4000/graphql (GraphiQL enabled).

### 3. Frontend

```bash
cd frontend-next
bun install
bun run dev
```

App: http://localhost:3000/login — choose **Demo (owner)** or **Demo Friend**.

### 4. Agent

```bash
cd backend/agent-service
uv sync
uv run uvicorn tripsuggest.main:app --host 127.0.0.1 --port 4100
```

Health: http://localhost:4100/health

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

### Agent (`backend/agent-service/.env`)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres with pgvector (same database as the backend) |
| `BACKEND_URL` | Internal backend base URL |
| `INTERNAL_TOKEN` | Shared secret with the backend |
| `DEEPSEEK_API_KEY` | Optional LLM key |
| `AGENT_LLM_MODEL`, `AGENT_LLM_BASE_URL` | Optional model/endpoint |

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

# Frontend helpers
cd frontend-next && bun test
```

## Roadmap

1. **M1 (done)** — remove Firebase, Resend, HasData and AWS from the runtime.
2. **M2 (done)** — Postgres + MongoDB data layer and integration tests.
3. **M3 (next)** — commit a curated Toronto dataset fetched once from HasData.
4. **M4** — Dockerfiles and one-command Compose stack for web/api/agent.
5. **M5** — demo identity switcher, invite link polish, optional LLM providers.
6. **M6** — recruiter README, demo tour, smoke script, CI and v1.0.0.

## Security

- Demo auth only; no production identity provider is wired.
- Membership checks on every read and mutation.
- Attachments are gated by per-file visibility and short-lived HMAC URLs.
- No secrets in the client bundle or the repository.
