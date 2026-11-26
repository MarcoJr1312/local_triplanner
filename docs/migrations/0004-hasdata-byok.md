# 0004 - HasData BYOK + MongoDB cache

| Field | Value |
|---|---|
| Status | M7 complete |
| Runtime | `backend/locations-service` |
| Provider | `preloaded` (default) or `hasdata` (BYOK) |
| Settings | `locations.json` on the locations PVC, mode `0600` |
| Cache | MongoDB `locations`, TTL 5 days for HasData rows |
| UI | Settings → Places data |

## 1. Summary

HasData becomes an optional runtime provider for the locations service. The
recruiter demo stays key-free: with no key (or provider `preloaded`) every
search and detail comes from the committed Toronto catalogue in MongoDB. When
the recruiter adds a HasData key in Settings, the service calls HasData for
cache misses and upserts the results into MongoDB. Fresh Mongo rows are served
without a HasData call; if HasData is down, cached data is served.

This replaces the earlier "HasData ingestion only" rule. The one-time ingestion
script remains the way the committed dataset is refreshed, but it is no longer
the only HasData path.

## 2. Provider behaviour

| Provider | Key | Search / details |
|---|---|---|
| `preloaded` | none | MongoDB only (committed catalogue + existing cache) |
| `hasdata` | required | Cache-first; HasData on a miss; upsert into MongoDB |
| `hasdata` | missing/invalid | Validation error on save; existing cached data remains readable |

The key is service-wide (shared by the demo identities), mirroring the Resend
and LLM BYOK cards. It is never returned by the settings API or GraphQL.

## 3. Cache semantics

- Every HasData search result and place detail is normalized to the existing
  `LocationRow` DTO and upserted into MongoDB.
- New HasData rows get `source: "hasdata"` and
  `expires_at = now + HASDATA_CACHE_TTL_HOURS` (default 120 hours = 5 days).
- A MongoDB TTL index `expires_at_ttl` (`expireAfterSeconds: 0`, sparse) deletes
  expired HasData rows. The TTL monitor runs about once per minute.
- Committed seed rows have `expires_at: null` and never expire. If a HasData
  detail enriches a seed row, the row stays `expires_at: null`.
- Search is cache-first: fresh cached rows are returned without an API call.
  A query with no fresh cached rows calls HasData once. On HasData failure the
  service returns the cached rows (possibly empty) and logs the failure.
- Place details refresh a stale row by `placeId`; `getById` refreshes through
  the row's `placeId` when possible.
- HasData rows are assigned the nearest destination slug within 100 km as
  `parent_id`, so `listActivities` and agent suggestions see them.

## 4. Settings contract

The locations service exposes:

| Route | Auth | Response |
|---|---|---|
| `GET /api/locations/config` | public | `{ provider, hasKey, ready, cachedPlaces }` |
| `POST /api/locations/config` | `x-internal-token` | same shape |

POST body:

```json
{ "provider": "hasdata", "apiKey": "..." }
{ "provider": "preloaded", "clearKey": true }
```

Rules:

- `provider=hasdata` requires a new or previously saved key.
- `provider=preloaded` clears the key and disables HasData, including an
  environment-provided key.
- The file is written through a temp file, `chmod 0600`, and renamed.
- The API proxies it through GraphQL:
  `getLocationsSettings` and `updateLocationsSettings`.

## 5. HasData client

- Search: `GET https://api.hasdata.com/scrape/google-maps/search`
  (`q`, `ll`, `hl`, `gl`, `start`).
- Details: `GET https://api.hasdata.com/scrape/google-maps/place`
  (`placeId`, `hl`, `fetchWebResults=false`).
- Header: `x-api-key`.
- Timeout: `HASDATA_TIMEOUT_MS` (8 s default).
- One search page per miss (20 results); cache-first keeps credit usage low.
- Normalization is tolerant of the documented `localResults`/`placeResults`
  shapes and reuses the `tor-<placeId>` id scheme from the ingestion script, so
  cached rows dedupe against the committed dataset.

## 6. Configuration

| Env var | Default | Purpose |
|---|---|---|
| `SETTINGS_FILE` | `/app/.data/locations.json` | BYOK settings |
| `HASDATA_API_KEY` | empty | Optional seed key (UI overrides) |
| `HASDATA_API_BASE` | HasData Google Maps base | Test/staging override |
| `HASDATA_CACHE_TTL_HOURS` | `120` | Cache lifetime (5 days) |
| `HASDATA_TIMEOUT_MS` | `8000` | Request timeout |
| `HASDATA_HL` / `HASDATA_GL` | `en` / `ca` | Locale |

Compose mounts `locationsdata` at `/app/.data`. Helm creates the
`triplanner-locations-settings` PVC (64Mi) and allows TCP 443 egress for
HasData. The chart values are under `locationsService.settingsFile`,
`locationsService.persistence` and `locationsService.hasdata`.

## 7. Tests and evidence

- Locations service: settings store (0600, no key in public), HasData client
  normalization/auth/errors, cache-first, stale refresh, seed rows never
  expiring, 5-day `expires_at`, TTL index.
- API: settings client proxy, token header, key not returned, error mapping.
- Web: settings card typecheck/build; i18n es/en keys.
- Compose: provider preloaded without a key; save fake key → `hasKey=true`,
  uncached search falls back to cache on HasData 401; clear key → preloaded.
- Helm: settings PVC bound, file `0600`, `/ready` reports the provider, TTL
  index present, `helm test` passes.

## 8. Rollback

Switch **Settings → Places data** to `Preloaded catalogue` (or POST
`{"provider":"preloaded","clearKey":true}`). No redeploy is needed. The key is
deleted from the PVC; cached HasData rows remain readable until their TTL.

## 9. Risks

- HasData charges 10 credits per successful search/place request. Cache-first
  and one page per miss limit usage; the UI does not show a credit balance.
- HasData image URLs are stored as remote URLs; they are not downloaded into
  the local uploads volume.
- The settings are service-wide, not per demo identity.
- Enabling HasData requires cluster/pod egress to `api.hasdata.com:443`.

## 10. Evidence (2026-11-21)

- Locations service: 35 tests pass, typecheck clean. Settings store persists
  `0600`; public responses contain only `hasKey`; cache-first/stale/fallback
  and permanent seed rows covered.
- API: 77 tests pass, typecheck clean; the settings proxy returns
  `provider/hasKey/ready/cachedPlaces` and maps errors.
- Web: 16 tests pass, typecheck clean; the Places data card is on `/settings`.
- Compose: locations reports `provider=preloaded`, `cachedPlaces=186`; saving a
  fake key returns `hasKey=true` without echoing it; an uncached search with
  HasData 401 falls back to the cache; clearing returns to preloaded. Settings
  file mode `0600`.
- Helm: `triplanner-locations-settings` PVC bound; `/ready` reports the
  provider; `expires_at_ttl` index present; `helm test` email + locations
  suites pass.
- HasData image `marcojr13/triplanner-locations:0.2.1` built and pushed
  (digest `sha256:6585b9819c05c04712dc70e80316742d722b8e8c79123ef241dd4bcb24962307`).
