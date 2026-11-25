# 0029 — p50 baselines in every latency panel

| Field | Value |
|---|---|
| Status | **Implemented and verified locally (2026-11-25); Gate 2 pending** |
| Cycle | Kubernetes Manifest Delivery |
| Slice | M26 — p50 latency baselines |
| Chart | `helm-triplanner` 0.20.0 |
| App version | 1.8.0 (images unchanged at `kind-0.19.0`) |

## 1. Goal

Every panel that showed p95 now also shows **p50**, so an operator can compare
the typical request against the tail without switching dashboards.

## 2. Panels changed

| Dashboard | Panel before | Panel after |
|---|---|---|
| each service | `p95 latency` stat | `Latency p50 / p95` stat |
| each service | `p95 by route` timeseries | `Latency by route (p50 / p95)` timeseries |
| users, trips, locations | `gRPC p95` stat | `gRPC p50 / p95` stat |
| overview | `p95 latency by service` | `Latency by service (p50 / p95)` |
| overview | `gRPC p95 by service` | `gRPC latency by service (p50 / p95)` |

Both series use the same histogram, selector, route filter, rate interval and
thresholds; only the quantile changes (`0.50` vs `0.95`). The stat panels show
named `p50` and `p95` values side by side.

## 3. Implementation

`scripts/generate-dashboards.py`:

- `target()` accepts a `refId`.
- `stat()` and `timeseries()` accept an `extra` list of `(expr, legend)` pairs.
- `quantile_expr(metric, selector, quantile, by)` builds the histogram query.
- `latency_expr()` and `grpc_latency_expr()` wrap the HTTP and gRPC histograms.
- The service overview stat row was widened for the extra value:
  Up 4, Requests 5, 5xx 4, Latency 7, In flight 4 columns.
- Broker descriptions now say p50/p95 include the deliberate long-poll wait.

No service code, image, schema, proto or scrape configuration changed.

## 4. Verification

Prometheus quantiles over 6 hours:

```text
p50 web 6.11 ms      p95 web 217.59 ms
p50 api 5.72 ms      p95 api 197.16 ms
p50 users 5.01 ms    p95 users 9.52 ms
p50 trips 5.00 ms    p95 trips 9.50 ms
p50 locations 5.01 ms p95 locations 9.52 ms
p50 agent 5.12 ms    p95 agent 9.73 ms
p50 email 5.00 ms    p95 email 9.50 ms
p50 broker 6.67 ms   p95 broker 50946.64 ms (long-poll)
```

gRPC over the same window:

```text
p50 users 7.12 ms      p95 users 240.43 ms
p50 trips 5.00 ms      p95 trips 9.50 ms
p50 locations 5.01 ms  p95 locations 9.53 ms
```

A fresh 60-second load (`qa-load-traffic.ps1`, 462 calls, 0 errors) populated
the live stat windows: Users showed `gRPC p50 7.02 ms` / `p95 239 ms`, Trips
`5.02 / 9.54 ms`.

Headless Grafana check: all 8 dashboards render, every expected p50/p95 title
is present, zero console errors. Screenshots:

- [Users](../images/dashboard-users-grpc.png)
- [Trips](../images/dashboard-trips-grpc.png)
- [Locations](../images/dashboard-locations-grpc.png)
- [Overview](../images/dashboard-overview-loaded.png)
- [Web](../images/dashboard-web-loaded.png)
- [API](../images/dashboard-api-loaded.png)
- [Agent](../images/dashboard-agent-loaded.png)

## 5. Cleanup

Temporary trip `47f0df42-1f61-4f5d-99fc-3131b1c5fe49` was deleted. The demo
trip remains Dec 4–6, 2026. No secrets or IDs are used as labels.

## 6. Rollback

Revert chart 0.20.0 to 0.19.0. No service rollout is required; only the
dashboard ConfigMaps change.

## 7. Gate 2 decision

Pending. The change is local-only; nothing was pushed or published.
