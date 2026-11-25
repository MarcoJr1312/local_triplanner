# 0027 — Prometheus data-load QA

| Field | Value |
|---|---|
| Status | **Completed locally (2026-11-25); P3 coverage gaps recorded** |
| QA workflow | `c14512b2-f67c-42b4-98b9-97c8ad950387` — QA / Migration Verification |
| Environment | `kind-triplanner-cilium`, Gateway `http://triplanner.localhost:9080` |
| Load driver | `scripts/qa-load-traffic.ps1` (public web GraphQL + agent proxy) |
| Cleanup | Temporary trips deleted; demo trip unchanged |

## 1. QA matrix

| Operation | Public surface | Metrics expected |
|---|---|---|
| Login | `POST /api/graphql` → users | web `/api/graphql`, API `/graphql`; users login is gRPC |
| List/get trip | `POST /api/graphql` → trips | web/API; trips is gRPC |
| Search locations | `POST /api/graphql` → locations | web/API; locations search is gRPC |
| Agent suggestions | `POST /api/agent/suggestions` | web `/api/agent/*`, agent `/api/agent/suggestions` |
| Agent day plan | `POST /api/agent/day-plan` | web `/api/agent/*`, agent `/api/agent/day-plan` |
| Email invitation | `sendTripInvite` → trips outbox → broker → email | broker publish/fetch/ack |
| Health/readiness | kubelet probes | every service `/health`, `/ready` |

The load used a temporary Toronto trip and deleted it at the end. The demo trip
was read-only.

## 2. Load profile

**Main run — 3 minutes, 200 ms delay, 3 invitations:**

```text
attempts 1346, errors 0, iterations 310
login 310, listMyTrips 310, getTrip 310, searchLocations 310
requestSuggestions 31, listDestinations 20, listActivities 20
myNotifications 15, getMyProfile 15, sendTripInvite 3
createTrip 1, deleteTrip 1
```

**Agent-focused run — 90 seconds, 150 ms delay:**

```text
attempts 736, errors 0, iterations 164
agentSuggestions 20, agentDayPlan 6
login 164, listMyTrips 164, getTrip 164, searchLocations 164
requestSuggestions 16, listDestinations 10, listActivities 10
myNotifications 8, getMyProfile 8
createTrip 1, deleteTrip 1
```

## 3. Prometheus evidence

Before/after counters from the main run:

| Service | Before | After | Delta |
|---|---:|---:|---:|
| web | 471 | 1889 | **+1418** |
| api | 676 | 2142 | **+1466** |
| broker | 412 | 514 | **+102** |
| users | 310 | 382 | +72 |
| trips | 313 | 385 | +72 |
| agent | 312 | 384 | +72 |
| email | 313 | 385 | +72 |
| locations | 318 | 392 | +74 |

Web routes: `/api/graphql` **+1346**, `/api/agent/*` **+26**,
`/api/health` +24, `/api/ready` +48.

Broker routes: `/v1/topics/{topic}/messages` **+27**,
`/v1/topics/{topic}/ack` **+3**, plus probes.

Agent routes after the agent run: `/api/agent/suggestions` **20**,
`/api/agent/day-plan` **6**. p95: suggestions 67.5 ms, day plan 48 ms.

Dashboard screenshots:

- [Overview after load](../images/dashboard-overview-loaded.png)
- [Web after load](../images/dashboard-web-loaded.png)
- [API after load](../images/dashboard-api-loaded.png)
- [Agent after load](../images/dashboard-agent-loaded.png)
- [Users, probe-only](../images/dashboard-users-probes.png)

Observed rates on the loaded dashboards:

```text
web     2.81 req/s, p95 227 ms
api     3.08 req/s, p95 220 ms
agent   0.125 req/s suggestions, 0.039 req/s day plan
```

## 4. Findings

### P1/P2

None. All load calls returned `200`; the app, auth, trips, search, agent and
invitation paths worked. No 5xx was generated.

### P3 — gRPC traffic is missing from the users/trips/locations dashboards

The API calls `users`, `trips` and `locations` over **gRPC** in the Helm stack.
The current `triplanner_http_*` metrics only count HTTP, so those dashboards
show only `/health` and `/ready` probes (the `+72` counters above), not logins,
trip reads or searches.
**Recommendation:** add gRPC server interceptors with
`triplanner_grpc_requests_total{service,method,status}` and
`triplanner_grpc_request_duration_seconds`, then add the corresponding
dashboard panels.

### P3 — email dashboard only sees HTTP probes

The email consumer is a broker loop, not an HTTP request path. Its dashboard
shows `/health`/`/ready` only. Domain counters (`triplanner_email_deliveries_total`)
are already listed as M20 future work.

### P3 — broker p95 includes long-poll fetches

The broker fetch endpoint long-polls (up to 20 s). The p95 panel reported about
50 s during the load because deliberate waits are included. The broker
dashboard should label this as a long-poll path or separate fetch wait from
request processing.

## 5. Cleanup and safety

- Temporary trips `3a8b6e6d…` and `0f2499ad…` were deleted; `getTrip` returns
  `TRIP_NOT_FOUND` for both.
- The demo trip remains **Dec 4–6, 2026**.
- A pre-existing “This is my new trip” trip was left untouched; it was not
  created by this QA run.
- No secrets were printed; the load used the demo user UUID and the public web
  proxy. Email invitations used `qa-load-*@example.test` and the sink provider.
- Grafana and Prometheus remain ClusterIP-only.

## 6. QA recommendation

Accept the data-load exercise. The Web, API, Agent and Broker dashboards now
show real traffic; the invitation path populated the broker. The gRPC coverage
gap is the main follow-up and should be scheduled before relying on the
Users/Trips/Locations dashboards for application traffic.
