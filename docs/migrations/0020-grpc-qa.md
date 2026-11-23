# 0020 — gRPC API facade QA

| Field | Value |
|---|---|
| Status | **Gate 2 approved (2026-11-23) — option 1: gRPC default, HTTP kept one release** |
| Cycle | Microservice Code Migration (`19455fa3-28ea-4f03-b195-973c5ddf595e`) |
| Contract | [`0019-grpc-api.md`](./0019-grpc-api.md) |
| Branch | `feature/grpc-api` |
| Date | 2026-11-23 |
| Chart | `helm-triplanner` 0.12.0 |

## 1. Scope verified

The API facade calls users, trips and locations over native gRPC. GraphQL and
the frontend are unchanged. Agent, broker and email remain HTTP. Compose
transport defaults are still `http`; every live test below ran with
`USERS_TRANSPORT=grpc`, `TRIPS_TRANSPORT=grpc` and
`LOCATIONS_TRANSPORT=grpc`.

## 2. Automated suites

| Suite | Result | Notes |
|---|---|---|
| `backend/users-service` | **71 pass, 0 fail** | Includes gRPC server, health, auth, partial profile update and favorites. |
| `backend/trips-service` | **72 pass, 0 fail** | Includes gRPC server, health, trip/item/reminder flows, auth and domain codes. |
| `backend/locations-service` | **44 pass, 0 fail** | Includes gRPC server, health, nullable mapping, radius validation and NOT_FOUND. |
| `backend/server` | **97 pass, 0 fail** | Includes gRPC users/trips/locations adapters, health, request shapes, clear flags, deadlines and error mapping. |
| TypeScript | clean | `bunx tsc --noEmit` in all four projects. |

Total: **284 tests, 0 failures**.

## 3. Compose acceptance (gRPC)

`docker compose -f deploy/docker-compose.yml up` with all three transports set
to `grpc`, then GraphQL through `http://localhost:4000/graphql`:

- login and `getMyProfile` (users gRPC);
- `listMyTrips`, `getTrip`, `listDestinations`, `listActivities`,
  `searchLocations`;
- favorite add/remove (users gRPC);
- create trip, rename, set budget, add item, update notes, move item, set cost,
  delete item, delete trip (trips gRPC);
- enable an activity reminder (15 min, demo recipient) and read it back
  (trips gRPC);
- actor mismatch: `demo-friend` reading `demo-trip` returns
  `NOT_TRIP_MEMBER`.

### Transport proof

A one-off API container ran with **all three HTTP URLs deliberately broken**
(`http://127.0.0.1:1`) and all three gRPC URLs pointing at the Compose
services. Login, `getMyProfile`, `listMyTrips`, `getTrip`, item
add/update/move/cost/remove, trip create/delete, `listDestinations`,
`listActivities` and `searchLocations` all succeeded. The only reachable
transport was gRPC.

### Failure injection

With the normal gRPC API:

| Injected failure | GraphQL code |
|---|---|
| users container stopped | `USERS_UNAVAILABLE` |
| trips container stopped | `TRIPS_UNAVAILABLE` |
| locations container stopped | `LOCATIONS_UNAVAILABLE` |

Each container was restarted and returned to healthy. Bad tokens and missing
actor metadata are covered by the server suites (`UNAUTHENTICATED`); forbidden
membership is covered by the trips suite (`PERMISSION_DENIED`).

### Deadline

The API users adapter test uses a 20 ms deadline against a deliberately slow
RPC and maps `DEADLINE_EXCEEDED` to `USERS_UNAVAILABLE`.

### Rollback

A one-off API container with `*_TRANSPORT=http`, normal HTTP URLs and broken
gRPC URLs completed login, `listMyTrips` and `searchLocations`. Rolling back is
a flag change; no data migration is involved.

## 4. Helm acceptance

Chart `0.12.0` upgraded on Docker Desktop with local images
`marcojr13/triplanner-{users,trips,locations}:grpc-0.12.1`. The users, trips and
locations Deployments rolled out 2/2 ready.

Services expose:

| Service | HTTP | gRPC |
|---|---|---|
| `triplanner-users` | 4500 | 50051 |
| `triplanner-trips` | 4400 | 50052 |
| `triplanner-locations` | 4300 | 50053 |

The gRPC ports are named `grpc`, `targetPort: grpc`, `appProtocol: grpc`, and
ClusterIP-only. No Ingress exposes them. HTTP `/health` and `/ready` remain the
probes.

Through three `kubectl port-forward`s and the real
`triplanner-internal` token:

- `grpc.health.v1.Health.Check` returned `SERVING` for all three services;
- `UsersService.GetUser(demo)` returned the demo account;
- `TripsService.ListTrips`/`GetTrip(demo-trip)` returned the seeded trip with
  9 items;
- `LocationsService.GetById(toronto)` and `Search("CN Tower")` returned the
  seeded catalogue.

`helm lint` passes. `helm template` renders the gRPC container/Service ports and
`GRPC_PORT` configmap values. `networkPolicy.enabled` is still `false` by
default; when enabled, the users/trips/locations policies allow the gRPC port
from the API selector.

## 5. Residual risks and deviations

| Item | Status |
|---|---|
| Runtime proto loading | `@grpc/proto-loader` is used instead of committed generated stubs; `buf` drift checks are deferred. The `.proto` files are committed and copied into every image. |
| Error details | Stable domain codes travel in the `x-error-code` metadata. `google.rpc.ErrorInfo`/`google.rpc.Status` details are not emitted in this slice. |
| Deadlines | Calls use the existing per-service timeout envs (users 3 s, trips 5 s, locations 2 s) for reads and writes; there are no separate read/write deadlines. |
| Request ids | `x-request-id` propagation is not implemented; no consumer reads it in this slice. |
| Locations write path | gRPC is read-only; `upsert`/`delete`/`clear`/`seed` remain HTTP-only (the API never calls them at runtime). |
| API location | The API is still a Compose workload in the Helm transition; the Helm gRPC ports are future-facing until the API joins the chart. |
| Defaults | Compose still defaults to `http`; Gate 2 decides whether to flip defaults and remove internal HTTP business routes. |
| Oversized messages | Not exercised; the grpc-js default 4 MiB limit is unchanged. |
| `bun test` channel quirk | Back-to-back success→error calls on a brand-new channel can drop in `bun test`; the real runtime returned the error immediately in a standalone script. Tests use a short settle delay. |

## 6. Gate 2 decision

**Approved 2026-11-23 (option 1).** Compose defaults are now
`USERS_TRANSPORT=grpc`, `TRIPS_TRANSPORT=grpc` and
`LOCATIONS_TRANSPORT=grpc`. The internal HTTP business routes stay for one
release as rollback; a follow-up retires them. Locations HTTP remains for the
agent and trips service regardless.
