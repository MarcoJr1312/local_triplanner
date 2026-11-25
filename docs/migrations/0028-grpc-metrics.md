# 0028 — gRPC server metrics for users, trips and locations

| Field | Value |
|---|---|
| Status | **Gate 2 approved locally (2026-11-25); release deferred** |
| Cycle | Kubernetes Manifest Delivery |
| Slice | M25 — close the M24 gRPC coverage finding |
| Chart | `helm-triplanner` 0.19.0 |
| App version | 1.8.0 (local images `kind-0.19.0`) |
| Contract | [`0022-metrics.md`](./0022-metrics.md) §3.6 |

## 1. Why

The M24 app-driven load proved that the Web, API, Agent and Broker dashboards
receive real traffic, but the Users, Trips and Locations dashboards only showed
`/health` and `/ready` probes. The API facade calls those three services over
gRPC, and the existing metrics only counted HTTP.

The user selected **Add gRPC metrics next** at the M24 QA gate.

## 2. Contract

New metrics on `users`, `trips` and `locations`:

| Metric | Type | Labels |
|---|---|---|
| `triplanner_grpc_requests_total` | counter | `service`, `method`, `status` |
| `triplanner_grpc_request_duration_seconds` | histogram | `service`, `method`, `status` |

- `method` is the proto method name, e.g. `Login`, `GetTrip`, `Search`. The set
  is bounded by the proto contract.
- `status` is the canonical gRPC name (`OK`, `NOT_FOUND`, `UNAUTHENTICATED`,
  ...), never the raw error message.
- Buckets match the HTTP histogram:
  `0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 15, 60`.
- `grpc.health.v1.Health/Check` is not instrumented, so kubelet probes do not
  appear as application traffic.
- The API, Agent, Web, Email and Broker are HTTP-only and do not expose these
  series.

## 3. Implementation

Each service keeps its own copy of the pattern, matching the existing
duplicated `metrics.ts` convention:

1. `src/metrics.ts` registers the counter and histogram on the shared registry.
2. `src/grpc/server.ts` wraps every unary domain handler with
   `instrumentHandlers()`:
   - records duration on the first callback invocation,
   - maps `error.code` or `OK` to a status name,
   - guards against a double callback,
   - leaves `bindAsync`, the internal token and `x-error-code` untouched.
3. Existing `AppError`/`GrpcFailure` mappings are unchanged.

No proto, schema, database or authorization change.

## 4. Dashboards

`scripts/generate-dashboards.py` adds a **gRPC** row to the Users, Trips and
Locations dashboards:

- `gRPC req/s`, `gRPC p95`, `gRPC error ratio` stats.
- `gRPC calls by method` and `gRPC calls by status` timeseries.

The Overview dashboard adds `gRPC calls by service` and `gRPC p95 by service`.

The Broker p95 descriptions now state that
`/v1/topics/{topic}/messages` is a deliberate long-poll (up to 20 s), closing
the third M24 P3 finding. All dashboards remain schema 41 with the
`${datasource}` variable and `$__rate_interval`.

## 5. Verification

### 5.1 Tests and typecheck

```text
users      bun test   76 pass, 0 fail (10 files)
trips      bun test   77 pass, 0 fail (7 files)
locations  bun test   43 pass, 1 fail (existing MongoDB catalogue suite;
                      no Mongo on the test host; gRPC + metrics 11/11 pass)
users/trips/locations  bunx tsc --noEmit  clean
```

New integration assertions call a real gRPC server and read the registry:
successful calls record `status="OK"`, rejected calls record
`status="UNAUTHENTICATED"` / `status="NOT_FOUND"`, and the label set contains
`method` and `service`.

### 5.2 Cluster

```text
helm release triplanner, chart 0.19.0, revision 22, STATUS deployed
pods 2/2 ready for users, trips and locations
Prometheus targets 8/8 UP
```

Raw pod scrapes after a login, trip read and search:

```text
triplanner_grpc_requests_total{method="Login",status="OK",service="users"} 1
triplanner_grpc_requests_total{method="ListFavoriteIds",status="OK",service="users"} 1
triplanner_grpc_requests_total{method="GetTrip",status="OK",service="trips"} 2
triplanner_grpc_requests_total{method="ListTrips",status="OK",service="trips"} 1
triplanner_grpc_requests_total{method="Search",status="OK",service="locations"} 1
```

### 5.3 App-driven load

`scripts/qa-load-traffic.ps1 -DurationSeconds 180 -DelayMs 200 -Invites 3`:

```text
attempts 1371, errors 0, iterations 304
agentSuggestions 38, agentDayPlan 12, requestSuggestions 30
sendTripInvite 3, createTrip 1, deleteTrip 1
```

Prometheus series after the load:

| Service | gRPC calls | gRPC rate (5m) | gRPC p95 |
|---|---:|---:|---:|
| users | 1,068 | 3.506 req/s | 239.73 ms |
| trips | 748 | 2.673 req/s | 9.50 ms |
| locations | 376 | 1.283 req/s | 9.53 ms |

Methods observed: `Login` (305), `ListFavoriteIds` (325), `BatchUsers` (355),
`GetUser` (68), `ListNotifications` (15), `GetTrip` (425), `ListTrips` (305),
`ListMembers` (3), `CreateInvitation` (3), `DueReminders` (10),
`CreateTrip` (1), `DeleteTrip` (1), `Search` (305), `ListByParent` (50),
`ListDestinations` (20), `GetById` (1).

The users p95 is dominated by Argon2id password verification on `Login`.

Dashboard screenshots:

- [Users with gRPC](../images/dashboard-users-grpc.png)
- [Trips with gRPC](../images/dashboard-trips-grpc.png)
- [Locations with gRPC](../images/dashboard-locations-grpc.png)
- [Overview with gRPC](../images/dashboard-overview-loaded.png)

Headless Grafana check: Users, Trips and Locations now render **19 panels**
each (14 HTTP/runtime + 5 gRPC); the Overview renders the new gRPC row; zero
browser console errors.

## 6. Cleanup and safety

- Temporary trip `2b5a91b1-b670-4a2b-a533-85b5c40d50e6` was deleted
  (`TRIP_NOT_FOUND`).
- Demo trip remains **Dec 4–6, 2026**.
- No secrets, tokens, user IDs, trip IDs, emails or usernames are used as
  labels.
- Grafana and Prometheus remain ClusterIP-only.
- Images are local `kind-0.19.0`; nothing was pushed or published.

## 7. Rollback

Revert chart 0.19.0 to 0.18.0 and deploy the previous image tag. The new
metrics are additive; dashboards referencing them would show `No data` until
the services are rolled forward again. No schema or data change is involved.

## 8. Follow-ups

- Publish images and tag the release when the human release gate opens.
- Optional domain counters remain candidates (email deliveries, broker
  published/acked, agent LLM calls).
- PostgreSQL/MongoDB exporters and alert rules remain open observability work.

## 9. Gate 2 decision

**Approved locally on 2026-11-25: accept M25 and hold the release.**
The gRPC metrics, dashboard panels and broker long-poll note are accepted on
the local kind stack. Image publication, `git push` and release tagging remain
deferred until a separate release decision.
