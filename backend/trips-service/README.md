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
| POST | `/internal/v1/trips` | create; actor becomes owner |
| GET | `/internal/v1/trips` | summaries for the actor |
| GET | `/internal/v1/trips/{id}` | aggregate + `my_role` + stats |
| PATCH | `/internal/v1/trips/{id}` | settings, budget, cover metadata |
| DELETE | `/internal/v1/trips/{id}` | owner only |
| GET/POST | `/internal/v1/trips/{id}/members` | list / add |
| PATCH/DELETE | `/internal/v1/trips/{id}/members/{userId}` | role / remove |
| POST | `/internal/v1/trips/{id}/invitations` | create invitation + queue email |
| GET | `/internal/v1/invitations/by-code/{code}` | preview, no actor (code is the secret) |
| POST | `/internal/v1/trips/{id}/join` | atomic join + owner notification |
| POST | `/internal/v1/trips/{id}/leave` | owner must transfer |
| GET/POST | `/internal/v1/trips/{id}/items` | list / add |
| PATCH/DELETE | `/internal/v1/trips/{id}/items/{itemId}` | update / remove |
| POST | `/internal/v1/trips/{id}/items/{itemId}/move` | day + order |
| POST | `/internal/v1/trips/{id}/items/{itemId}/reminder` | toggle |
| GET | `/internal/v1/items/{itemId}` | resolve item → trip (attachments) |
| GET | `/internal/v1/trips/{id}/context` | agent context |

All `/internal/v1` routes require `x-internal-token`; actor-scoped routes add
`x-actor-id`. The invitation preview is the only actor-less route: the invite
code is the secret.

Authorization is enforced here: viewers read only; editors edit items, settings
and invitations; owners change roles, delete and transfer. Cover metadata is
owner-only. Locations lookups are best-effort: a failure keeps the supplied text
and reports `place_resolved: false` instead of blocking the write.

## Outbox

`email.invite.v1` and `email.member.joined.v1` are written to `outbox` in the
same transaction as the invitation or join. The relay publishes every
`OUTBOX_INTERVAL_MS` in batches of `OUTBOX_BATCH_SIZE`, then stamps
`published_at` and `broker_offset`. A failure increments `attempts`, stores
`last_error` and retries; the row stays pending. `/ready` reports
`outbox_pending`.

Replay one row by id (the relay republishes it; the email service deduplicates
by event id):

```bash
bun run db:replay-outbox <outbox-id>
```

## Commands

```bash
cd backend/trips-service
bun install
bunx tsc --noEmit
bun test
bun run db:migrate
bun run db:seed
bun src/index.ts
```

Tests use `TEST_TRIPS_DATABASE_URL`, then `TRIPS_DATABASE_URL`, then a local
throwaway Postgres on `127.0.0.1:55432`. They skip when no database answers.

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
