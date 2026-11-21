# Locations service

MongoDB-backed catalogue for Triplanner destinations, places and activities.
This service is the only MongoDB owner after migration 0003; the API and agent
call it through the internal HTTP contract.

## Local run

```bash
cd backend/locations-service
bun install
MONGODB_URL=mongodb://127.0.0.1:27017/triplanner \
INTERNAL_TOKEN=dev-internal-token \
SEED_CATALOGUE=true \
bun src/index.ts
```

It listens on `:4300`. The Toronto seed is loaded from
`backend/db/toronto-locations.json` on startup and is idempotent.

## Endpoints

| Route | Notes |
|---|---|
| `GET /health` | Liveness |
| `GET /ready` | Mongo ping + seed state |
| `GET /internal/v1/destinations` | Rows with a slug |
| `GET /internal/v1/destinations/{slug}/activities` | Optional `category`, `limit` |
| `GET /internal/v1/locations/search` | `q`, optional `lat`/`lng`, `limit` |
| `GET /internal/v1/locations` | All places (agent places cache) |
| `GET /internal/v1/locations/{id}` | By id |
| `GET /internal/v1/locations/by-place/{placeId}` | By place id |
| `POST /internal/v1/locations` | Guarded upsert |
| `POST /internal/v1/seed` | Re-run the committed seed |

All `/internal/v1/*` routes require `x-internal-token`. Port 4300 stays on the
Compose network / cluster; never publish it.

## Tests

```bash
bun test          # Mongo integration tests skip when Mongo is unreachable
bunx tsc --noEmit
```

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `PORT` | `4300` | HTTP port |
| `MONGODB_URL` | `mongodb://127.0.0.1:27017/triplanner` | Mongo connection |
| `MONGODB_COLLECTION` | `locations` | Collection |
| `INTERNAL_TOKEN` | `dev-internal-token` | Internal auth |
| `SEED_CATALOGUE` | `true` | Startup seed |
| `SEED_DATA_PATH` | repo/container dataset | Seed file |
| `SEED_ON_STARTUP_TIMEOUT_MS` | `30000` | Seed bound |

The migration plan and full REST contract live in
[`docs/migrations/0003-locations-service.md`](../../docs/migrations/0003-locations-service.md).
