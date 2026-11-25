# 0022 — Metrics endpoints and Prometheus scrape contract

| Field | Value |
|---|---|
| Status | **Accepted locally — Gate 2 approved (2026-11-25); release deferred** |
| Cycle | Kubernetes Manifest Delivery |
| Slice | M19 — Metrics endpoints and scrape contract |
| Chart | `helm-triplanner` 0.15.0 |
| App version | 1.8.0 |

## 1. Goal

Every Triplanner runtime exposes a Prometheus-scrapeable endpoint so a later
`kube-prometheus-stack` can collect service and HTTP metrics without changing
the services again. The monitoring stack is **not** part of this slice.

## 2. Scope

In scope:

- `web` (Next.js)
- `api` (GraphQL facade)
- `users`
- `trips`
- `locations`
- `agent`
- `email`
- `broker`

Out of scope:

- Deploying `kube-prometheus-stack`, Grafana, Alertmanager or Prometheus itself.
- PostgreSQL, MongoDB or Cilium/Hubble exporters.
- Domain/business counters (candidate M20; see §10).
- Dashboards, alerts and recording rules.
- Public exposure of any metrics endpoint.
- Changing `/health`, `/ready` or probe semantics.

## 3. Endpoint contract

### 3.1 Path and port

| Runtime | Endpoint | Port |
|---|---|---|
| `web` | `GET /metrics` | existing HTTP `3000` |
| `api` | `GET /metrics` | existing HTTP `4000` |
| `users` | `GET /metrics` | existing HTTP `4500` |
| `trips` | `GET /metrics` | existing HTTP `4400` |
| `locations` | `GET /metrics` | existing HTTP `4300` |
| `agent` | `GET /metrics` | existing HTTP `4100` |
| `email` | `GET /metrics` | existing HTTP `4200` |
| `broker` | `GET /metrics` | existing HTTP `8080` |

All services share their existing HTTP listener. No new Service or container
port is added. The endpoint is unauthenticated and does not require
`x-internal-token`; Prometheus cannot supply application tokens.

`/metrics` must:

- Return `200` with
  `Content-Type: text/plain; version=0.0.4; charset=utf-8`.
- Set `Cache-Control: no-store`.
- Never query PostgreSQL, MongoDB or the broker.
- Never include secrets, tokens, user IDs, trip IDs, emails, usernames, raw
  paths, query strings, request bodies or error messages.
- Exclude itself from the HTTP counters to avoid scrape feedback noise.

### 3.2 Library per runtime

| Runtime | Client | Notes |
|---|---|---|
| `web` | `prom-client` 15.x | Next route handler, Node runtime |
| `api` | `prom-client` 15.x | `node:http` server |
| `users` | `prom-client` 15.x | Bun `createHandler` wrapper |
| `trips` | `prom-client` 15.x | Bun `createHandler` wrapper |
| `locations` | `prom-client` 15.x | Bun `createHandler` wrapper |
| `agent` | `prometheus-client` (Python) | FastAPI middleware + `/metrics` route |
| `email` | `prom-client` 15.x | `node:http` server |
| `broker` | `prometheus/client_golang` | `promhttp` + Go/process collectors |

`prom-client` default metrics and Python/Go runtime collectors are enabled.
They keep their standard names (`process_*`, `nodejs_*`, `python_*`, `go_*`).

### 3.3 Mandatory custom metrics

| Metric | Type | Labels | Meaning |
|---|---|---|---|
| `triplanner_build_info` | gauge | `service`, `version` | Constant `1`; version from `SERVICE_VERSION`, default `dev` |
| `triplanner_http_requests_total` | counter | `service`, `method`, `route`, `status` | Completed HTTP requests |
| `triplanner_http_request_duration_seconds` | histogram | `service`, `method`, `route`, `status` | Request duration |
| `triplanner_http_requests_in_flight` | gauge | `service` | Requests currently being served |

Histogram buckets:

```text
0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 15, 60
```

`service` is one of:

```text
web, api, users, trips, locations, agent, email, broker
```

### 3.4 Route label rules

`route` must be a bounded template, never the raw path.

| Raw path | `route` |
|---|---|
| `/health` | `/health` |
| `/ready` | `/ready` |
| `/metrics` | not recorded |
| `/graphql` | `/graphql` |
| `/internal/v1/users/...` | `/internal/v1/users/*` |
| `/internal/v1/trips/...` | `/internal/v1/trips/*` |
| `/internal/v1/locations/...` | `/internal/v1/locations/*` |
| `/internal/v1/destinations/...` | `/internal/v1/destinations/*` |
| `/api/email/config` | `/api/email/config` |
| `/api/agent/config` | `/api/agent/config` |
| `/api/locations/config` | `/api/locations/config` |
| `/uploads/...` | `/uploads/*` |
| `/api/graphql` | `/api/graphql` |
| `/api/agent/...` | `/api/agent/*` |
| anything else | `other` |

Rules:

- Never use `:id`, `:itemId`, `:userId`, codes, emails, usernames, query
  strings or raw URL paths as labels.
- `status` is the exact HTTP status code (`200`, `404`, `503`, ...).
- `method` is the uppercase HTTP method.
- Do not add a GraphQL operation-name label: operation names are
  client-controlled and unbounded.

### 3.5 Cardinality budget

Per service:

- `triplanner_http_requests_total`: ≤ 5 methods × ~12 route templates ×
  ~6 statuses in practice.
- `triplanner_http_request_duration_seconds`: 10 buckets × the same label
  sets.
- No label may contain an unbounded value.
- A repeated request to the same route must not create new series.

## 4. Per-runtime implementation

### 4.1 `web` (Next.js)

- Add `prom-client` to `frontend-next/package.json`.
- Add `frontend-next/lib/metrics.ts` with a global registry, `withHttpMetrics`
  wrapper and `renderMetrics()`.
- If Next's bundler cannot trace `prom-client`, add
  `serverExternalPackages: ['prom-client']` to `next.config.ts`.
- Add `frontend-next/app/metrics/route.ts`:
  - `export const runtime = 'nodejs'`
  - `export const dynamic = 'force-dynamic'`
  - lazy `collectDefaultMetrics()` on first scrape
- Wrap the server routes:
  - `app/api/graphql/route.ts` → `/api/graphql`
  - `app/api/agent/[...path]/route.ts` → `/api/agent/*`
  - `app/api/health/route.ts` → `/api/health`
  - `app/api/ready/route.ts` → `/api/ready`
- The public Cilium `HTTPRoute` adds a longer-path rule for `/metrics` that
  redirects to `/` with `302`. In-cluster Prometheus scrapes the Service
  directly, bypassing the Gateway.
- Static page traffic is not instrumented in this slice; the Gateway/proxy
  metrics cover edge traffic later.

### 4.2 `api` (GraphQL facade)

- Add `prom-client` and `src/metrics.ts`.
- Handle `GET /metrics` before `/health` in `src/index.ts`.
- Wrap the request handler; normalize `/internal/v1/*`, `/uploads/*`,
  `/graphql`, `/health`, `/metrics`.
- Do not parse or buffer GraphQL bodies for labels.

### 4.3 `users`, `trips`, `locations` (Bun)

- Add `prom-client` and `src/metrics.ts` to each service.
- Add `/metrics` before `/health` in `createHandler`.
- Wrap the returned handler with `withHttpMetrics`:
  - method, normalized route, status, duration, in-flight.
- Keep existing `Route` matching unchanged; route labels are derived by the
  normalizer in §3.4.

### 4.4 `agent` (FastAPI)

- Add `prometheus-client` to `pyproject.toml` and `uv.lock`.
- Add `src/tripsuggest/metrics.py`:
  - `triplanner_build_info`
  - request counter, duration histogram, in-flight gauge
  - FastAPI/Starlette middleware that records `request.scope["route"].path`
    when available, otherwise `other`
- Add `GET /metrics` using `prometheus_client.generate_latest`.
- Skip `/metrics` in the middleware.
- Do not label by trip ID, user ID or free-text query.

### 4.5 `email` (Node HTTP)

- Add `prom-client` and `src/metrics.ts`.
- Add `/metrics` before `/health` in `src/http.ts`.
- Record `/health`, `/ready`, `/api/email/config`, `/metrics` (excluded) and
  `other`.

### 4.6 `broker` (Go)

- Add `github.com/prometheus/client_golang` to `go.mod`/`go.sum`.
- Register `GET /metrics` with `promhttp.Handler()`.
- Wrap application handlers with a middleware that records:
  - `route` from `r.Pattern` (Go 1.23 `Request.Pattern`) or a fixed label
  - method, status, duration, in-flight
- The Go and process collectors are registered by default.

## 5. Helm and Compose wiring

### 5.1 Values

```yaml
metrics:
  enabled: true
  path: /metrics
  serviceMonitor:
    # Requires the Prometheus Operator CRDs from kube-prometheus-stack.
    enabled: false
    interval: 30s
    scrapeTimeout: 10s
    labels: {}
```

- `metrics.enabled=false` removes the ServiceMonitors; the endpoints remain.
- `metrics.serviceMonitor.enabled=true` renders one ServiceMonitor per enabled
  service.
- `jobLabel: app.kubernetes.io/name` so dashboards get
  `job="triplanner-users"`, etc.
- Endpoint: `port: http`, `path: /metrics` for every service.
- No `prometheus.io/*` pod annotations: the operator path is ServiceMonitor
  only, avoiding duplicate scrapes.
- Chart defaults stay `serviceMonitor.enabled: false`, so the chart installs
  without the CRDs. When the stack is installed, the operator must select
  ServiceMonitors in the `triplanner` namespace and either match the labels
  set in `metrics.serviceMonitor.labels` or use
  `serviceMonitorSelectorNilUsesHelmValues: false`.

### 5.2 Web Gateway block

`web-httproute.yaml` gets a higher-precedence rule:

```yaml
rules:
  - matches:
      - path:
          type: PathPrefix
          value: /metrics
    filters:
      - type: RequestRedirect
        requestRedirect:
          path:
            type: ReplaceFullPath
            replaceFullPath: /
          statusCode: 302
  - matches:
      - path:
          type: PathPrefix
          value: /
    backendRefs:
      - name: triplanner-web
        port: 3000
```

The web Service still serves `/metrics` on `:3000` for in-cluster scrapes.
The public Gateway returns `302` instead of metrics.

### 5.3 NetworkPolicy

- Add `networkPolicy.monitoring.namespace: monitoring` and optional
  `networkPolicy.monitoring.podLabels: {}`.
- Every service CNP gets an additive ingress rule from the monitoring
  namespace to the service HTTP port, restricted to `GET /metrics` with
  Cilium HTTP rules.
- If `networkPolicy.monitoring.namespace` is empty, the rule is skipped.
- CNPs remain disabled locally (`networkPolicy.enabled: false`) because the
  Docker Desktop WSL2 kernel lacks `xt_socket`; the rules are rendered and
  validated for a compatible cluster.
- The web CNP keeps its existing Gateway/host path for `/`; the monitoring
  rule is additive.

### 5.4 Compose

- No new ports.
- `/metrics` is available inside the Compose network.
- The web publishes `:3000`, so `http://localhost:3000/metrics` is reachable
  on the local host. This is local-only; the Helm Gateway blocks the public
  path.
- The Compose stack currently runs `web`, `api`, `users`, `trips`, `locations`,
  `agent` and `broker`; the email service is Helm-only.
- Update the smoke scripts to verify `/metrics` through `docker compose exec`.

### 5.5 Version metadata

- Set `SERVICE_VERSION` to `.Chart.AppVersion` in each service ConfigMap.
- Compose may leave it unset; `triplanner_build_info` then reports `dev`.

## 6. Security

- `/metrics` is ClusterIP-only; no Gateway listener or HTTPRoute exposes it.
- The web's public `/metrics` path is redirected at the Gateway.
- No auth token is required or emitted; the endpoint contains no secrets.
- Metrics labels are bounded; no PII, IDs or free text.
- The endpoint does not touch databases or external providers.
- Cilium HTTP rules restrict monitoring traffic to `GET /metrics` when
  NetworkPolicy is enabled.
- The existing non-root, read-only, dropped-capability container settings are
  unchanged.

## 7. Tests and acceptance

### 7.1 Unit tests

- Every runtime: `GET /metrics` → 200, Prometheus content type, contains
  `triplanner_build_info` and `triplanner_http_requests_total`.
- After `GET /health`, the counter contains `route="/health",status="200"`.
- A request with an ID (`/internal/v1/users/<unique>/...`) does not put the
  ID in the exposition.
- Scraping `/metrics` twice does not increase the `/metrics` series.
- `bun test` + `bunx tsc --noEmit` for web, api, users, trips, locations,
  email.
- Agent: add a metrics check to the existing agent test harness.
- Broker: `go test ./...` via the Go Docker image.
- Web build: `bun run build` succeeds.

### 7.2 Chart checks

- `helm lint`.
- `helm template` default: no ServiceMonitor resources.
- `helm template --set metrics.serviceMonitor.enabled=true`: 8
  ServiceMonitors, one per service, all with `path: /metrics` and
  `port: http`.
- `helm template --set networkPolicy.enabled=true`: every service CNP has the
  monitoring ingress rule restricted to `GET /metrics`.
- `helm template --set webService.enabled=true`: the `/metrics` redirect rule
  precedes the `/` backend rule.

### 7.3 Runtime acceptance

- Compose: build and start; `docker compose exec <svc> curl -fsS
  http://localhost:<port>/metrics` for the 7 Compose runtimes (email is
  Helm-only).
- Helm on `triplanner-cilium`: all pods ready; `kubectl exec` each pod and
  curl `http://localhost:<port>/metrics` for all 8 runtimes.
- `curl -I http://triplanner.localhost:9080/metrics` → `302` to `/`.
- `/api/ready`, login, trips, search and suggestions still work.
- Sample outputs show `triplanner_http_requests_total`,
  `triplanner_http_request_duration_seconds` and runtime metrics.
- Grep the exposition for `demo123`, `INTERNAL_TOKEN`, the demo UUIDs and a
  known trip ID; none may appear.

### 7.4 Scrape simulation

- A `scripts/metrics-smoke.ps1` / `.sh` helper checks all runtimes through
  `docker compose exec` or `kubectl exec`, prints one sample metric per
  service and fails on a non-200 or missing `triplanner_` metric.
- When `kube-prometheus-stack` is installed later, set
  `metrics.serviceMonitor.enabled=true` and verify targets are `UP` in the
  Prometheus UI. That is M20, not this slice.

### 7.5 Observed local evidence (2026-11-25)

- Compose images built for `kafka`, `locations`, `trips`, `users`, `api`,
  `agent` and `web`; the email image was built separately because the Compose
  stack does not include it.
- Unit suites: users 75/75, trips 76/76, locations 48/48, API 99/99, email
  70/70, web 36/36, agent 14/14 + 7/7 + metrics.
- Typecheck passed for all TypeScript services and the web; `next build`
  passed; `go test ./...` passed via the Go Docker image.
- Helm release `triplanner` chart 0.15.0 / app 1.8.0, revision 13, all pods
  ready.
- `scripts/metrics-smoke.ps1 -Target all`: 7/7 Compose, 8/8 Helm, Gateway
  `/metrics` → 302.
- `triplanner_build_info{version="1.8.0"}` in all Helm runtimes.
- Users cardinality: 2 counter series before and after five `/health` calls;
  no `route="/metrics"` series; no demo UUIDs, `demo123` or `INTERNAL_TOKEN` in
  the exposition.
- Gateway flows still pass: login, `listMyTrips`, `getTrip`, `searchLocations`
  and `requestSuggestions`.
- `helm template` with `metrics.serviceMonitor.enabled=true` renders 8
  ServiceMonitors; with `networkPolicy.enabled=true` every service CNP has a
  `GET /metrics` rule from the monitoring namespace.

## 8. Rollout and rollback

- Chart 0.15.0, app version 1.8.0.
- Local acceptance uses `kind-0.15.1` image tags.
- Hub images `1.8.0` are published only after Gate 2/release approval.
- Rollback: revert the chart to 0.14.0. The `/metrics` endpoints are additive
  and harmless; ServiceMonitors are disabled by default; NetworkPolicy
  monitoring rules only apply when policies are enabled.
- No database schema or data migration.

## 9. Risks and mitigations

| Risk | Mitigation |
|---|---|
| `prom-client` default metrics behave differently on Bun | Custom HTTP metrics are independent; verify on Bun during acceptance |
| Next `/metrics` is reachable on the public port | Gateway redirect rule; verify `302` in acceptance; fallback is a dedicated internal port |
| High-cardinality route labels | Normalizer + tests with unique IDs |
| Go dependency growth | Acceptable for the demo broker; verify build size |
| CNP path rules unsupported on a target cluster | Fallback to port-only monitoring rule; document |
| ServiceMonitor CRDs absent | `enabled: false` by default; chart installs without CRDs |

## 10. Future work (M20, after kube-prometheus-stack)

- Deploy `kube-prometheus-stack` in a `monitoring` namespace.
- Enable `metrics.serviceMonitor.enabled=true`.
- Verify scrape targets and add Grafana dashboards.
- Candidate domain counters:
  - `triplanner_broker_messages_published_total{topic}`
  - `triplanner_broker_messages_fetched_total{topic}`
  - `triplanner_broker_messages_acked_total{topic}`
  - `triplanner_agent_requests_total{endpoint,outcome}`
  - `triplanner_agent_llm_requests_total{provider,mode,outcome}`
  - `triplanner_email_deliveries_total{provider,outcome}`
  - `triplanner_users_logins_total{result}`
  - `triplanner_trips_created_total`
  - `triplanner_locations_searches_total{provider}`
- Add PostgreSQL/MongoDB exporters and Cilium/Hubble scrape configs.
- Alerts and recording rules.

## 11. Gate 1 decision

**Approved on 2026-11-24: option 1.**

1. **Recommended**: all 8 runtimes, `/metrics` on existing HTTP ports, web
   `/metrics` blocked at the Cilium Gateway, ServiceMonitor scaffold disabled
   by default, CNP monitoring rules, tests and smoke script. No monitoring
   stack deployment.
2. **Backends only**: users, trips, locations, agent, email, broker and api;
   defer web and ServiceMonitor wiring.
3. **Full observability slice**: option 1 plus domain counters, a Compose
   Prometheus/Grafana stack and dashboards now.

Option 1 was selected. Gate 2 was approved on 2026-11-25. The slice is accepted
locally; image publication and release tagging are deferred until M20, when
`kube-prometheus-stack` is deployed and the ServiceMonitors are enabled and
verified.
