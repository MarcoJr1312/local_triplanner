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

Implemented v1: user CRUD/search/batch, `auth/login`, notifications and the
fixed-UUID migration. The service never reads the platform database and has no
foreign keys to trips.

## Commands

```bash
cd backend/users-service
bun install
bunx tsc --noEmit
bun test
bun src/index.ts
```

The service migrates its own schema and seeds the protected demo accounts on
boot (`SEED_DEMO=true`). `db:migrate` and `db:seed` run the same steps manually.

## Fixed-UUID data migration

`scripts/migrate-users.ts` copies platform users into this service and rewrites
every platform and trips reference to UUIDs. It is a dry-run by default:

```bash
LEGACY_DATABASE_URL=postgres://.../triplanner \
TRIPS_DATABASE_URL=postgres://.../trips \
USERS_DATABASE_URL=postgres://.../users \
bun scripts/migrate-users.ts

# apply (stop the API and this service first; back up both databases)
APPLY=1 ... bun scripts/migrate-users.ts
```

See [`docs/migrations/0009-users-cutover.md`](../../docs/migrations/0009-users-cutover.md).

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
