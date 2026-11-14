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
docker compose up --build
```

and use the app at http://localhost:3000 with no Firebase, HasData, Resend or
AWS account. Optional LLM providers are the only external integration.

## Target architecture

| Area | Target |
|---|---|
| Web | Next.js 15 App Router, React 19, Tailwind v4, shadcn/ui |
| API | Bun + graphql-yoga |
| Relational | PostgreSQL 17 + pgvector |
| Locations | MongoDB 7, seeded with real Toronto data |
| Agent | Python 3.12 + FastAPI + Agno + pgvector |
| Orchestration | Docker Compose, built from source |

Runtime services: `web`, `api`, `agent`, `postgres`, `mongo`.

## Hard constraints

- **No Firebase** at runtime. Demo auth via `x-user-id`; seeded `demo-user` and
  `demo-friend`.
- **No HasData** at runtime. A one-time ingestion script writes the committed
  Toronto dataset; search reads MongoDB only.
- **No Resend** or email delivery. Invitations expose a copyable join link.
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
- Next: M3 Toronto dataset (real HasData fetch, committed JSON + images).
Do not assume the target architecture is already implemented — check the
current tree.

## Product conventions (do not regress)

- Spanish UI default with mirrored es/en i18n keys; every string goes through
  `t()`, API errors use stable codes.
- Membership checks on every read/mutation; attachments are gated by per-file
  visibility and short-lived HMAC URLs.
- Avatars and attachments are served same-origin through the web proxy.
- Routes use Google Maps deep links; Uber deep links never preload a pickup.
- Package manager is **bun** for JS projects; Python uses **uv**.

## Local commands (target)

```bash
docker compose up --build        # full demo
docker compose down              # stop, keep volumes
docker compose down -v           # reset data
cd local/server && bun test      # API tests (needs Postgres/Mongo)
cd local/server && bunx tsc --noEmit
cd frontend-next && bun test
cd local/agent-service && uv run python tests/test_m2.py
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
