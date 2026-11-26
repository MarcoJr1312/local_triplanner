# Locations service

MongoDB-backed catalogue for Triplanner destinations, places and activities.
This service is the only MongoDB owner after migration 0003; the API and agent
call it through the internal HTTP contract.

## Local run

```bash
cd backend/locations-service
bun install
MONGODB_HOST=127.0.0.1:27017 \
MONGODB_DB=triplanner \
MONGODB_USERNAME=triplanner \
MONGODB_PASSWORD=triplanner \
MONGODB_AUTH_SOURCE=admin \
INTERNAL_TOKEN=dev-internal-token \
SEED_CATALOGUE=true \
SETTINGS_FILE=.data/locations.json \
bun src/index.ts
```

It listens on `:4300`. The Toronto seed is loaded from
`backend/db/toronto-locations.json` on startup and is idempotent. The `.data`
directory is created on the first settings save and is gitignored.

## Places data (BYOK)

The service has two providers:

- `preloaded` (default): reads the committed Toronto catalogue from MongoDB.
  No external key is needed.
- `hasdata`: uses the recruiter's HasData key. Search and place details are
  cached in MongoDB; fresh cached rows are served without an API call. If
  HasData fails, the service serves the cache. The key is stored at
  `SETTINGS_FILE` with mode `0600` and is never returned to the browser.

Cached HasData rows carry `expires_at = now + 5 days`. A MongoDB TTL index
(`expires_at_ttl`, `expireAfterSeconds: 0`) removes them about a minute after
expiry. Preloaded rows have `expires_at: null` and never expire.

The recruiter changes the provider and key in the app at **Settings → Places
data**. The shared `INTERNAL_TOKEN` guards the write route; reads are public so
the settings page can show the current state without exposing the key.

## Endpoints

| Route | Notes |
|---|---|
| `GET /health` | Liveness |
| `GET /ready` | Mongo ping + seed state + provider |
| `GET /api/locations/config` | Public settings: provider, hasKey, ready, cachedPlaces |
| `POST /api/locations/config` | Guarded update; `x-internal-token` |
| `GET /internal/v1/destinations` | Rows with a slug |
| `GET /internal/v1/destinations/{slug}/activities` | Optional `category`, `limit` |
| `GET /internal/v1/locations/search` | `q`, optional `lat`/`lng`, `limit` |
| `GET /internal/v1/locations` | All places (agent places cache) |
| `GET /internal/v1/locations/{id}` | By id |
| `GET /internal/v1/locations/by-place/{placeId}` | By place id |
| `GET /internal/v1/locations/by-data/{dataId}` | By data id |
| `POST /internal/v1/locations` | Guarded upsert |
| `POST /internal/v1/seed` | Re-run the committed seed |

All `/internal/v1/*` routes require `x-internal-token`. Port 4300 stays on the
Compose network / cluster; never publish it.

## Tests

```bash
bun test          # Mongo integration tests skip when Mongo is unreachable
bunx tsc --noEmit
```

The HasData client and cache orchestration tests use mocked fetch/in-memory
fakes, so they do not consume credits or need a key.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `PORT` | `4300` | HTTP port |
| `MONGODB_URL` | built from host/user/password | Optional full URL override |
| `MONGODB_HOST` | `127.0.0.1:27017` | Mongo host |
| `MONGODB_DB` | `triplanner` | Database |
| `MONGODB_USERNAME` | empty | Mongo user |
| `MONGODB_PASSWORD` | empty | Mongo password |
| `MONGODB_AUTH_SOURCE` | `admin` | Auth database |
| `MONGODB_COLLECTION` | `locations` | Collection |
| `INTERNAL_TOKEN` | `dev-internal-token` | Internal auth |
| `SEED_CATALOGUE` | `true` | Startup seed |
| `SEED_DATA_PATH` | repo/container dataset | Seed file |
| `SEED_ON_STARTUP_TIMEOUT_MS` | `30000` | Seed bound |
| `SETTINGS_FILE` | `.data/locations.json` | BYOK settings file |
| `HASDATA_API_KEY` | empty | Optional seed key; Settings UI overrides |
| `HASDATA_API_BASE` | `https://api.hasdata.com/scrape/google-maps` | API base |
| `HASDATA_CACHE_TTL_HOURS` | `120` | Cache expiry (5 days) |
| `HASDATA_TIMEOUT_MS` | `8000` | HasData request timeout |
| `HASDATA_HL` / `HASDATA_GL` | `en` / `ca` | Language / country |

The migration plan and full REST contract live in
[`docs/migrations/0003-locations-service.md`](../../docs/migrations/0003-locations-service.md).
