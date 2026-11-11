# Triplanner

Collaborative travel planning web app. Plan a trip with your team: build a
day-by-day itinerary, organize activities and budgets, invite collaborators,
attach tickets with per-file visibility, get AI suggestions, and jump straight
to Google Maps routes or an Uber deep link.

The product UI is **Spanish by default**, with an **es/en** switch.

**Live:** https://gathered.woky.dev (behind Basic Auth)

## Features

- **Trips and itineraries** — multiple trips, day-by-day plans, activity
  categories (`sight`, `food`, `activity`, `nightlife`), costs and budgets.
- **Collaboration** — invitations by email, owner / editor / viewer roles,
  real-time trip updates and presence.
- **AI suggestions** — a suggestion agent that knows the trip context, plus
  interest-based automatic suggestions and one-day trip templates.
- **Calendar view** — every day of the trip in a monthly grid.
- **Attachments** — tickets and documents per activity; the uploader chooses
  who can see each file. PDFs render inline.
- **Places search** — cache-first HasData search with favorites first.
- **Routes** — multi-stop Google Maps route ordered by start time (max 10
  stops), with an optional current-location origin.
- **Uber** — per-activity deep link with the destination preloaded.
- **Email** — invitations and activity reminders via Resend.
- **Profiles** — name, avatar, language and light/dark theme.
- **Auth** — Firebase Auth (email + password and Google) with email
  verification.

## Architecture

```
Browser
  │
  ▼
Next.js frontend (:3000 dev, :3001 prod)
  ├─ /api/graphql ─────────── proxy ──▶ GraphQL server (:4000) ──▶ SQLite
  ├─ /api/agent/* ─────────── proxy ──▶ Agent service (:4100)  ──▶ ChromaDB + DeepSeek
  └─ /uploads/* ──────────── rewrite ─▶ GraphQL server static uploads
```

- The browser only talks to the Next.js origin. It never sees backend URLs or
  credentials.
- The HasData and Resend keys live **server-side only**, in `local/.env`.
- No sensitive value is ever exposed through `NEXT_PUBLIC_*`.

## Tech stack

| Area | Stack |
|---|---|
| Frontend (`frontend-next/`) | Next.js 15 App Router, React 19, TypeScript, shadcn/ui on Radix, Tailwind v4, next-themes, sonner |
| Backend (`local/server/`) | TypeScript on Bun, graphql-yoga, SQLite (`node:sqlite`), `firebase-admin`, `jose` |
| Agent (`local/agent-service/`) | Python 3.12, uv, FastAPI, Agno, ChromaDB, DeepSeek |
| Data (`local/db/`) | Versioned `schema.sql` + idempotent `seed.js` |
| Infrastructure | nginx at `gathered.woky.dev`, Basic Auth, no AWS |

## Repository layout

```
.
├── frontend-next/          Next.js app (App Router, shadcn/ui, i18n)
│   ├── app/                routes, layout, API proxies
│   ├── components/         UI components
│   ├── hooks/              auth, query, store hooks
│   └── lib/                API client, i18n, routes, formatting, types
├── local/
│   ├── server/             GraphQL API, auth, uploads, HasData, email
│   ├── agent-service/      FastAPI suggestion agent
│   ├── db/                 schema.sql + seed.js
│   └── .env.example        backend configuration template
├── AGENTS.md               project conventions for AI agents
└── .orkai.yaml             project memory configuration
```

### Frontend routes

| Route | Screen |
|---|---|
| `/` | My trips dashboard |
| `/trip/[id]` | Trip detail: days, activities, budget, members, calendar, search |
| `/login` | Sign in / sign up |
| `/join` | Accept a trip invitation |
| `/verify` | Email verification |
| `/api/graphql` | GraphQL proxy to the backend |
| `/api/agent/[...path]` | Proxy to the agent service |

## Prerequisites

- [Bun](https://bun.sh/) (JS package manager and runtime)
- Node.js 22+ (the seed script uses the built-in `node:sqlite`)
- [uv](https://docs.astral.sh/uv/) and Python 3.12+ (agent service)
- A `firebase-service-account.json` for the Firebase project
- API keys for HasData (place search), Resend (email) and DeepSeek (agent)

> The local GraphQL server loads the base schema from
> `local/graphql/schema.graphql` and the seed data from
> `local/db/seed-data.json`. Both ship with this repository, so a fresh clone
> runs without copying anything from the reference implementation.

## Getting started

### 1. Backend configuration

```bash
cp local/.env.example local/.env
# Fill in HASDATA_API_KEY, RESEND_API_KEY and the Firebase values.
```

### 2. Database

```bash
cd local/db && node seed.js
```

The seed is idempotent (`CREATE TABLE IF NOT EXISTS` + `INSERT OR IGNORE`) and
creates two destinations, their activities, and a demo user/trip.

### 3. Services

Run each service in its own terminal:

```bash
# GraphQL API — http://localhost:4000/graphql (GraphiQL enabled)
cd local/server && bun install && bun run dev

# Frontend — http://localhost:3000
cd frontend-next && bun install && bun run dev

# Agent service — http://localhost:4100
cd local/agent-service && uv sync
uv run uvicorn tripsuggest.main:app --host 127.0.0.1 --port 4100
```

Configure the agent through `local/agent-service/.env` (see
`local/agent-service/.env.example`). The agent authenticates backend calls with
the shared `INTERNAL_TOKEN`.

### 4. Verify

- Open http://localhost:3000.
- GraphiQL: http://localhost:4000/graphql.
- Agent health: `curl http://localhost:4100/health`.

## Configuration

Backend (`local/.env`) — never committed:

| Variable | Purpose |
|---|---|
| `HASDATA_API_KEY` | Places search (backend only) |
| `RESEND_API_KEY`, `RESEND_FROM` | Invitation and reminder emails |
| `APP_URL` | Public frontend base for invitation links |
| `LOCAL_PORT` | GraphQL port (default `4000`) |
| `ATTACHMENT_TOKEN_SECRET` | HMAC secret for short-lived attachment URLs |
| `INTERNAL_TOKEN` | Shared secret for `/internal/*` endpoints |
| `AGENT_BASE_URL` | Agent base URL (default `http://127.0.0.1:4100`) |
| `FIREBASE_PROJECT_ID`, `FIREBASE_WEB_API_KEY` | Firebase project config |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | Admin SDK service account JSON |

Frontend (`frontend-next/.env`):

| Variable | Purpose |
|---|---|
| `NEXT_PRIVATE_BACKEND_URL` | Server-side GraphQL backend URL |

Agent (`local/agent-service/.env`):

| Variable | Purpose |
|---|---|
| `DEEPSEEK_API_KEY` | LLM provider |
| `INTERNAL_TOKEN` | Shared secret with the backend |
| `AGENT_FIREBASE_SERVICE_ACCOUNT_PATH` | Firebase Admin service account |
| `FIREBASE_PROJECT_ID` | Project whose tokens are verified |
| `AGENT_LLM_MODEL` | Model name (optional) |

## Testing

```bash
# Backend: unit tests + strict typecheck
cd local/server && bun test
cd local/server && bunx tsc --noEmit

# Agent service
cd local/agent-service && uv run python tests/test_m2.py

# Frontend helpers (routes, geolocation, Uber links)
cd frontend-next && bun test
```

Tests must stay green before any merge.

## Production

The public app runs the production Next.js build behind nginx:

```bash
cd frontend-next
NEXT_PROD=1 bun run build   # outputs to .next-prod
NEXT_PROD=1 bun run start   # :3001
```

- nginx serves `gathered.woky.dev` and enforces Basic Auth.
- Dev and production builds use separate output directories (`.next` vs
  `.next-prod`) so `next build` never clobbers a running `next dev`.
- Redeploy after each shipped feature.

## Conventions and guardrails

- **Security** — membership checks on every read and mutation; uploads are
  gated by per-file visibility and short-lived HMAC URLs; no secrets in the
  client or the repository.
- **i18n** — every UI string goes through `t()`, with mirrored `es`/`en` keys;
  API errors travel as stable codes.
- **Data** — `local/db/schema.sql` is the single source of truth; the seed is
  idempotent; `*.sqlite`, uploads and Chroma data are gitignored.
- **Branches** — one `feature/*` branch per delivery, pushed only to that
  branch, never to `main`.
- **No AWS deploys** — the original AWS stack is reference only.

See [AGENTS.md](AGENTS.md) for the full project working agreement.
