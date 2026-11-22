# Users service

Owns user accounts (UUID, username, display name, optional email, language) and
the local notification inbox. Local credentials are **username + password**
(Argon2id), with no JWT: a successful login returns the profile and the client
sends `x-user-id` on later requests.

Contract: [`docs/migrations/0008-users-service.md`](../../docs/migrations/0008-users-service.md).

## Runtime surface

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | liveness, no token |
| GET | `/ready` | Postgres ping + migrated; 503 until ready |
| * | `/internal/v1/*` | `x-internal-token`; actor routes add `x-actor-id` |

Planned v1 (M10.4/M10.5): user CRUD/search/batch, `auth/login`, notifications.
The service never reads the platform database and has no foreign keys to trips.

## Commands

```bash
cd backend/users-service
bun install
bunx tsc --noEmit
bun test
bun src/index.ts
```

## Configuration

See [`.env.example`](./.env.example). Production values come from the
`triplanner-users-postgres-credentials` Secret (`POSTGRES_USER`,
`POSTGRES_PASSWORD`, `POSTGRES_DB`) and the shared `triplanner-internal` Secret
(`INTERNAL_TOKEN`).

## Rules

- Service owns its store. No cross-store queries.
- Passwords are hashed with Argon2id and never returned.
- Stable error codes in a flat `{error, message}` envelope.
- Non-root container, read-only root filesystem, `/health` + `/ready`.
- SIGTERM drains the server and closes the pool with a bounded timeout.
