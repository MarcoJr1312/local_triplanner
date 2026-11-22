# Trips service

Owns trips, memberships, itinerary items and invitations in its own PostgreSQL
database. The public GraphQL contract, users, attachments, presence, chats,
favorites and AI composition stay in the API.

Contract: [`docs/migrations/0006-trips-service.md`](../../docs/migrations/0006-trips-service.md).

## Runtime surface

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | liveness, no token |
| GET | `/ready` | Postgres ping + migrated; 503 until ready |
| * | `/internal/v1/*` | `x-internal-token`; actor routes add `x-actor-id` |

Planned v1 routes (M9.4/M9.5): trips, members, items, invitations, `/join` and
the agent context. The service never reads the platform database and has no
foreign keys to `users`.

## Commands

```bash
cd backend/trips-service
bun install
bunx tsc --noEmit
bun test
bun src/index.ts
```

## Configuration

See [`.env.example`](./.env.example). Production values come from the
`triplanner-trips-postgres-credentials` Secret (`POSTGRES_USER`,
`POSTGRES_PASSWORD`, `POSTGRES_DB`) and the shared `triplanner-internal` Secret
(`INTERNAL_TOKEN`).

## Rules

- Service owns its store. No cross-store queries, no platform `users` table.
- Membership and role checks are enforced here, not only in the API.
- Stable error codes in a flat `{error, message}` envelope.
- Non-root container, read-only root filesystem, `/health` + `/ready`.
- SIGTERM drains the server and closes the pool with a bounded timeout.
