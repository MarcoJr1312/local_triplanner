# Backend — Triplanner local runner

Backend services for the recruiter demo. The API runtime has no cloud
dependencies: PostgreSQL for relational data, MongoDB for the Toronto
catalogue, local disk for uploads.

## Structure

- `server/` — Bun + graphql-yoga API, demo auth, uploads, invitations.
- `agent-service/` — Python 3.12 + FastAPI agent (pgvector).
- `db/` — Postgres `pg/schema.sql` + seed data (Toronto catalogue).
- `graphql/` — base GraphQL schema.
- `.env.example` — backend configuration template.
- `.env.fetch.example` — one-time Toronto ingestion key template.

## Run

```bash
# from the repository root
docker compose up -d
cp backend/.env.example backend/.env
cd backend/server
bun install
bun run db:migrate
bun run db:seed
bun run dev
```

The API listens on http://localhost:4000/graphql.

## Agent

```bash
cd backend/agent-service
uv sync
uv run uvicorn tripsuggest.main:app --host 127.0.0.1 --port 4100
```

## Tests

```bash
cd backend/server && bun test && bunx tsc --noEmit
cd backend/agent-service && uv run python tests/test_m2.py
```

The Toronto dataset is generated once with
`backend/server/scripts/fetch-toronto.ts`; see the root README.
