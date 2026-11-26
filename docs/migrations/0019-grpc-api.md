# 0019 — gRPC for the API facade (users, trips, locations)

| Field | Value |
|---|---|
| Status | **Gate 1 approved (2026-11-23); M15.1–M15.7 complete, Gate 2 pending** |
| Cycle | Microservice Code Migration (`19455fa3-28ea-4f03-b195-973c5ddf595e`) |
| Integration branch | `refactor/helm` |
| Work branch | `feature/grpc-api` |
| Caller | `backend/server` GraphQL API |
| Callees | users `:50051`, trips `:50052`, locations `:50053` |
| Proto root | `proto/triplanner/` |
| Chart | `helm-triplanner` 0.12.0 |

## 1. Summary

Replace the API facade’s internal HTTP calls to the users, trips and locations
services with native gRPC over h2c. The GraphQL public surface and the
frontend do not change. Each service keeps its HTTP health/readiness endpoints
and gains a gRPC listener; the API gets gRPC clients behind transport flags so
the cutover is phased and reversible.

This first slice covers **API → users, trips and locations only**. Agent,
broker and email internal calls remain HTTP until a later slice. The services
are Bun/TypeScript, so their gRPC servers/clients use `@grpc/grpc-js`;
`grpc-go` is reserved for the Go broker and any future Go components. No Go
gateway or sidecar is added.

## 2. Decisions (2026-11-23)

1. **API → services first.** Users, trips and locations; agent/broker/email
   stay HTTP for now.
2. **Native per runtime.** Bun services use gRPC-js; Python/Go clients come
   later. No sidecars or extra hops.
3. **h2c + internal token.** Plaintext HTTP/2 on the private Compose/ClusterIP
   network. TLS/mTLS is out of scope for the local demo.
4. **Dual protocol, phased.** Keep HTTP internal routes and add gRPC; switch
   clients with transport flags; remove HTTP internal business routes only
   after QA and Gate 2.

### 2.1 Implementation notes (post-Gate 1)

These do not change the wire contract; they record how M15.1–M15.6 were built.

- The Bun servers and clients load the committed `.proto` files at runtime with
  `@grpc/proto-loader` (`keepCase`, no default filling). Generated stubs and
  `buf` drift checks are deferred; the `.proto` files remain the source of
  truth and are copied into every image (`PROTO_PATH` / `PROTO_ROOT`).
- The standard `grpc.health.v1.Health` service is registered in all three
  servers (`Check` returns `SERVING`). Kubernetes probes still use HTTP
  `/health` and `/ready`.
- Locations is read-only over gRPC (`GetById`, `GetByPlaceId`, `GetByDataId`,
  `Search`, `ListDestinations`, `ListByParent`, `ListPlaces`). `upsert`,
  `delete`, `clear` and `seed` stay on the internal HTTP service/seed path.
- The API is still a Compose workload in the Helm transition, so the functional
  cutover runs in Compose. The chart exposes gRPC on the three ClusterIP
  Services for the future in-cluster API.
- Gate 2 was approved on 2026-11-23: Compose defaults are now `grpc`; the
  users/trips/locations internal HTTP business routes remain for one release as
  rollback. Locations HTTP also stays for the agent and trips service.

## 3. Scope

### In scope

- Proto IDL and generated TypeScript stubs for users, trips and locations.
- gRPC servers in the three Bun services wrapping the existing domain services.
- gRPC clients in the API replacing the remote HTTP adapters.
- Stable gRPC error mapping and metadata.
- Compose and Helm gRPC ports, Services and NetworkPolicies.
- Transport flags for a phased cutover.
- Contract/parity tests, live acceptance and failure injection.

### Out of scope

- Agent, broker and email gRPC (later slices).
- Go gRPC services or gateways.
- TLS/mTLS and external gRPC exposure.
- Public GraphQL/frontend changes.
- Rewriting domain logic or changing database ownership.
- Streaming RPCs (all calls are unary in this slice).

## 4. Proto contract

Layout:

```text
proto/
  buf.yaml
  buf.gen.yaml
  triplanner/common/v1/common.proto
  triplanner/users/v1/users.proto
  triplanner/trips/v1/trips.proto
  triplanner/locations/v1/locations.proto
```

Packages: `triplanner.users.v1`, `triplanner.trips.v1`,
`triplanner.locations.v1`, `triplanner.common.v1`.

Generated TypeScript stubs are committed under each service’s
`src/grpc/generated/` and verified in CI with `buf generate` +
`git diff --exit-code`.

### 4.1 Common types

- `User`, `Profile`, `Notification`, `FavoriteLocation`
- `Trip`, `TripSummary`, `TripMember`, `TripItem`, `ItemReminder`,
  `DueReminder`, `Invitation`, `InvitationPreview`, `LocalInviteResult`
- `Location`, `Destination`, `SearchOptions`
- `Timestamp`/ISO strings where the HTTP contract already uses strings
- `google.protobuf.Empty` for deletes
- `google.rpc.ErrorInfo` for stable error details

Complex JSON columns stay as explicit `string` fields only where the existing
contract already stores JSON (`hours_json`, `tags_json`, `social_links_json`).

### 4.2 UsersService

| RPC | HTTP equivalent |
|---|---|
| `GetUser` | `GET /internal/v1/users/{id}` |
| `GetByUsername` | `GET .../by-username/{username}` |
| `GetByEmail` | `GET .../by-email/{email}` |
| `ListUsers` | `GET .../users?query=&limit=` |
| `BatchUsers` | `POST .../users/batch` |
| `Login` | `POST .../auth/login` |
| `CreateUser` | `POST .../users` |
| `UpdateUser` | `PATCH .../users/{id}` |
| `DeleteUser` | `DELETE .../users/{id}` |
| `CreateNotification` | `POST .../notifications` |
| `CreateReminderNotification` | reminder branch of the same route |
| `ListNotifications` | `GET .../users/{id}/notifications` |
| `GetNotification` | `GET .../notifications/{id}` |
| `UpdateNotification` | `PATCH .../notifications/{id}` |
| `ListFavoriteIds` | `GET .../users/{id}/favorites` |
| `SetFavorite` | `PUT/DELETE .../favorites/{locationId}` |

`x-actor-id` is required where the HTTP route required it; the server enforces
the same self/ownership checks.

### 4.3 TripsService

Grouped RPCs matching the current `TripsStore`:

- Trips: `ListMyTrips`, `GetTrip`, `CreateTrip`, `UpdateTrip`, `DeleteTrip`.
- Members: `AddMember`, `UpdateMemberRole`, `RemoveMember`, `LeaveTrip`,
  `GetMemberRole`, `IsMember`, `AssertMember`, `ListMemberIds`.
- Items: `AddItem`, `UpdateItem`, `SetItemCost`, `MoveItem`, `RemoveItem`,
  `GetItemForActor`.
- Reminders: `SetItemReminder`, `GetItemReminder`, `DueReminders`,
  `MarkRemindersSent`.
- Invitations: `PreviewInvitation`, `CreateInvitation`,
  `CreateLocalInvitation`, `JoinLocal`, `DeclineLocalInvitation`,
  `RevokeLocalInvitation`, `JoinTrip`.

Trip aggregates return the same nested members/items/reminder shapes as the
HTTP JSON. `Internal`-only dispatcher calls (`DueReminders`,
`MarkRemindersSent`) carry the internal token and no browser actor.

### 4.4 LocationsService

| RPC | HTTP equivalent |
|---|---|
| `GetById` | `GET /internal/v1/locations/{id}` |
| `GetByPlaceId` | `GET .../by-place/{id}` |
| `GetByDataId` | `GET .../by-data/{id}` |
| `Search` | `GET .../locations/search` |
| `ListDestinations` | `GET .../destinations` |
| `ListByParent` | `GET .../destinations/{slug}/activities` |
| `ListPlaces` | `GET .../locations` |

The API’s catalogue adapter keeps its current in-process behavior, including
favorites-first ranking where applicable. The locations service remains the
only MongoDB owner.

## 5. gRPC runtime

### 5.1 Servers

Each service starts a gRPC server on a second port beside the existing HTTP
server:

| Service | HTTP | gRPC |
|---|---|---|
| users | 4500 | 50051 |
| trips | 4400 | 50052 |
| locations | 4300 | 50053 |

- `@grpc/grpc-js` `Server` with `addService` for the generated definitions.
- Standard `grpc.health.v1.Health` service.
- Max receive/send message 4 MiB; unary only.
- Graceful shutdown: stop accepting, drain, then close.
- Health/readiness stay HTTP so Kubernetes probes do not change in this slice.

### 5.2 Clients

- API uses `@grpc/grpc-js` clients with one channel per service.
- Metadata on every call:
  - `x-internal-token`
  - `x-actor-id` when acting for a user
  - `x-request-id` (new, propagation only)
- Deadlines: 5 s users/trips reads, 10 s writes, 3 s locations search.
- Channels are reused; no per-request channel creation.
- Transport selection:

| Variable | Before Gate 2 | Current (Gate 2) |
|---|---|---|
| `USERS_TRANSPORT` | `http` | **`grpc`** |
| `TRIPS_TRANSPORT` | `http` | **`grpc`** |
| `LOCATIONS_TRANSPORT` | `http` | **`grpc`** |
| `USERS_GRPC_URL` | `users:50051` | same |
| `TRIPS_GRPC_URL` | `trips:50052` | same |
| `LOCATIONS_GRPC_URL` | `locations:50053` | same |

The HTTP adapters and internal business routes remain one release for
rollback (`*_TRANSPORT=http`); the services keep HTTP health/readiness.
Locations HTTP also remains for the agent and trips service.

### 5.3 Error model

- Domain `AppError`/`GraphQLError` codes map to gRPC status codes:
  - `INVALID_ARGUMENT` → `INVALID_ARGUMENT`
  - `NOT_FOUND`, `USER_NOT_FOUND`, `TRIP_NOT_FOUND`, `ITEM_NOT_FOUND` →
    `NOT_FOUND`
  - `FORBIDDEN*`, `NOT_TRIP_MEMBER`, `NOT_TRIP_OWNER` → `PERMISSION_DENIED`
  - `UNAUTHORIZED`, `ACTOR_REQUIRED` → `UNAUTHENTICATED`
  - `UNAVAILABLE`, `USERS_UNAVAILABLE`, `TRIPS_UNAVAILABLE`,
    `LOCATIONS_UNAVAILABLE` → `UNAVAILABLE`
  - `ALREADY_*`, `OWNER_*` conflicts → `ABORTED`/`FAILED_PRECONDITION`
  - everything else → `INTERNAL`
- `google.rpc.ErrorInfo` carries `reason` = the stable domain code and
  `domain = "triplanner"`.
- The API maps the status/info back to the existing GraphQL error code so the
  frontend behavior and i18n keys do not change.

## 6. Deployment

### 6.1 Compose

- Services expose gRPC ports only on the Compose network; no host publishing by
  default.
- API gets `*_GRPC_URL` and transport flags.
- Healthchecks remain HTTP.
- Add a smoke that calls each service over gRPC from the API container.

### 6.2 Helm

- Containers add `grpc` container ports; Services add named `grpc` ports
  (`appProtocol: grpc`) for users/trips/locations.
- NetworkPolicies allow the API consumer (Compose in the transition; in-cluster
  when the API joins) and the existing service-to-service calls.
- No Ingress for gRPC.
- Chart 0.12.0; no image tag changes beyond the release tag.

### 6.3 Transition

The API is still a Compose workload, so the functional gRPC cutover is in
Compose. Helm services expose gRPC for the future in-cluster API; the Helm web
continues to use the Compose API in this slice.

## 7. Testing and acceptance

- Proto: `buf lint`, `buf breaking` against the previous commit, generated-code
  drift check.
- Server units: each RPC maps to the domain method, authorization metadata is
  enforced, error/status mapping is exact.
- Client units: transport flag selects HTTP/gRPC, deadlines, metadata,
  channel reuse, error mapping to GraphQL codes.
- Parity: for a fixture set, HTTP and gRPC responses are byte-equivalent after
  normalization (same IDs, timestamps, order).
- Compose: login, trips, members, items, reminders, invites, favorites,
  locations search through gRPC; HTTP health still works.
- Failure: gRPC service down → `UNAVAILABLE`/`TRIPS_UNAVAILABLE`; bad token →
  `UNAUTHENTICATED`; actor mismatch → `PERMISSION_DENIED`; deadline exceeded;
  malformed/oversized message.
- Helm: gRPC ports reachable by port-forward, NetworkPolicy, probes, `helm test`.
- Regression: GraphQL/frontend, agent HTTP, invitations, favorites, reminders,
  uploads.
- Rollback: set transport flags back to `http`; no data migration.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Bun/grpc-js h2 compatibility | Early spike before the full contract; fallback is a Go gateway (re-enters Gate 1) |
| Large Trip aggregate over 4 MiB | Measure; raise limit or split `GetTrip` if needed |
| Proto/JSON drift | Generated-code drift check + parity fixtures |
| Error code drift | Central map + tests for every domain code |
| API/Helm transition | Compose API + Compose services for functional cutover; Helm gRPC is future-facing |
| HTTP routes removed too early | Dual protocol until Gate 2; flags for rollback |
| Extra port exposure | ClusterIP/Compose network only; no ingress; NetworkPolicy |
| Channel leaks | Reuse channels; close on shutdown; tests |

## 9. Rollout

| Stage | Name | Owner |
|---|---|---|
| M15.1 | Proto contract, ADR and Gate 1 | PM |
| M15.2 | Buf/codegen, gRPC bootstrap, health and error model | Backend |
| M15.3 | Users gRPC server + API client, dual protocol | Backend |
| M15.4 | Trips gRPC server + API client, dual protocol | Backend |
| M15.5 | Locations gRPC server + API client, dual protocol | Backend |
| M15.6 | Compose/Helm gRPC ports, Services, NetworkPolicies, chart 0.12.0 | SRE |
| M15.7 | Parity, failure injection, Compose + Helm acceptance and QA | QA |
| M15.8 | Gate 2, default to gRPC, remove HTTP internal business routes, release | PM/SRE |

## 10. Exit criteria

- The API reads/writes users, trips and locations over gRPC by default.
- HTTP health/readiness remains; internal HTTP business routes are removed
  after Gate 2.
- Parity, auth, errors, deadlines and failure paths are verified.
- Compose and Helm expose only ClusterIP/internal gRPC ports.
- `helm test`, all suites and the demo flow are green.
- Gate 2 recorded before release.
