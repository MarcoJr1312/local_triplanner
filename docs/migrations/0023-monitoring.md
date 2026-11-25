# 0023 — ServiceMonitors and Grafana dashboards

| Field | Value |
|---|---|
| Status | **Accepted locally — Gate 2 approved (2026-11-25)** |
| Cycle | Kubernetes Manifest Delivery |
| Slice | M20 — ServiceMonitors and Grafana dashboards |
| Triplanner chart | `helm-triplanner` 0.16.0 |
| Monitoring release | `prometheus` / `kube-prometheus-stack-93.11.0` |
| Monitoring cluster | `kind-triplanner-cilium` |
| Monitoring namespace | `monitoring` |

## 1. Live stack findings

The stack is installed as Helm release `prometheus` in `monitoring` on
`kind-triplanner-cilium`, where the live Triplanner 0.16.0 services run.

The stack was initially installed in `docker-desktop/monitoring`. ServiceMonitors
cannot cross clusters, and the Docker Desktop cluster only has the old chart
0.12.0 fallback without `/metrics`. It was uninstalled there and installed in
the kind cluster.

The kind node also restarted during the slice; its API-server port mapping was
refreshed and Cilium `k8sServiceHost` was updated to the current node IP
`172.19.0.4`. The app was recreated and `/api/ready` is green.

Prometheus CR (`prometheus-kube-prometheus-prometheus`):

```yaml
serviceMonitorNamespaceSelector: {}
serviceMonitorSelector:
  matchLabels:
    release: prometheus
scrapeInterval: 30s
```

Grafana (`prometheus-grafana`):

- Sidecar label: `grafana_dashboard=1`
- Sidecar namespace scope: `ALL`
- Sidecar folder: `/tmp/dashboards`
- Provisioning folder: empty (General), `foldersFromFilesStructure: false`
- Datasource UID: `prometheus` (default Prometheus datasource)
- Service: `prometheus-grafana:80`, ClusterIP only

This means:

- The Triplanner ServiceMonitors can stay in the `triplanner` namespace; Prometheus
  selects ServiceMonitors from all namespaces.
- Each ServiceMonitor must carry `release: prometheus`.
- Dashboard ConfigMaps can stay in the `triplanner` namespace; the Grafana
  sidecar watches all namespaces.
- No change to the `prometheus` Helm release is required.

## 2. Scope

1. Enable the existing 8 ServiceMonitors in the Triplanner chart:
   `web`, `api`, `users`, `trips`, `locations`, `agent`, `email`, `broker`.
2. Add 8 per-service Grafana dashboards and 1 Triplanner overview dashboard as
   ConfigMaps in the `triplanner` namespace.
3. Wire the dashboards into the chart with a `dashboards/*.json` asset and a
   `templates/monitoring/dashboards.yaml` ConfigMap template.
4. Verify Prometheus targets and Grafana provisioning against the live stack.
5. Keep Prometheus and Grafana ClusterIP-only; no Gateway/HTTPRoute exposure.

Out of scope:

- Alert rules, Alertmanager routing and recording rules.
- PostgreSQL, MongoDB or Cilium/Hubble exporters.
- Grafana persistence or SQL-backed dashboard storage.
- Public Grafana exposure.
- Changing the `prometheus` Helm release.
- Business/domain counters beyond the M19 HTTP/runtime metrics.

## 3. ServiceMonitor wiring

`deploy/kind/triplanner-values.yaml` enables the chart's ServiceMonitors:

```yaml
metrics:
  enabled: true
  serviceMonitor:
    enabled: true
    labels:
      release: prometheus
```

The chart keeps `metrics.serviceMonitor.enabled: false` as the portable
default. The local kind values enable it because the `prometheus` release is
installed.

Expected result:

```text
kubectl -n triplanner get servicemonitors
triplanner-web
triplanner-api
triplanner-users
triplanner-trips
triplanner-locations
triplanner-agent
triplanner-email
triplanner-kafka
```

Each ServiceMonitor selects the corresponding Service, scrapes `port: http` at
`path: /metrics` every 30 s, and sets `jobLabel: app.kubernetes.io/name`.
The resulting Prometheus jobs are `triplanner-web`, `triplanner-api`,
`triplanner-users`, `triplanner-trips`, `triplanner-locations`,
`triplanner-agent`, `triplanner-email` and `triplanner-kafka`.

Each endpoint also sets `honorLabels: true`. Kubernetes target discovery adds a
`service` label (the Service name), which collides with the application
`service="users"` label used by the custom metrics. Honoring the metric labels
preserves `service` for the dashboards; the `job` label still identifies the
Kubernetes Service.

The web ServiceMonitor scrapes the web Service directly; the Cilium Gateway
still redirects public `/metrics` to `/`.

## 4. Dashboard contract

One dashboard per runtime plus an overview:

| Dashboard | UID | ConfigMap | Custom metric label | Prometheus job |
|---|---|---|---|---|
| Overview | `triplanner-overview` | `triplanner-overview-dashboard` | all | `triplanner-*` |
| API | `triplanner-api` | `triplanner-api-dashboard` | `api` | `triplanner-api` |
| Users | `triplanner-users` | `triplanner-users-dashboard` | `users` | `triplanner-users` |
| Trips | `triplanner-trips` | `triplanner-trips-dashboard` | `trips` | `triplanner-trips` |
| Locations | `triplanner-locations` | `triplanner-locations-dashboard` | `locations` | `triplanner-locations` |
| Agent | `triplanner-agent` | `triplanner-agent-dashboard` | `agent` | `triplanner-agent` |
| Email | `triplanner-email` | `triplanner-email-dashboard` | `email` | `triplanner-email` |
| Broker | `triplanner-broker` | `triplanner-broker-dashboard` | `broker` | `triplanner-kafka` |
| Web | `triplanner-web` | `triplanner-web-dashboard` | `web` | `triplanner-web` |

Each per-service dashboard uses:

- Service `up` stat: `up{job="<job>"}`.
- Request rate: `sum(rate(triplanner_http_requests_total{service="<service>"}[5m]))`.
- 5xx ratio: `sum(rate(...status=~"5.."...)) / clamp_min(sum(rate(...)), 0.001)`.
- p95 latency:
  `histogram_quantile(0.95, sum by (le) (rate(triplanner_http_request_duration_seconds_bucket{service="<service>"}[5m])))`.
- In-flight: `sum(triplanner_http_requests_in_flight{service="<service>"})`.
- Requests by route and p95 by route.
- CPU: `rate(process_cpu_seconds_total{job="<job>"}[5m])`.
- Memory: `process_resident_memory_bytes{job="<job>"}`.
- Top routes table: `topk(10, sum by (route) (rate(...[5m])))`.
- Build info: `triplanner_build_info{service="<service>"}`.

The overview dashboard uses:

- `up{job=~"triplanner-.*"}` per runtime.
- Request rate by `service`.
- 5xx ratio by `service`.
- p95 latency by `service`.
- Build info table.

Runtime metrics use the `job` label; custom `triplanner_*` metrics use the
`service` label. This keeps the queries correct for Node/Bun, Python and Go
collectors without changing the collectors.

## 5. Dashboard ConfigMaps

`templates/monitoring/dashboards.yaml` renders one ConfigMap per dashboard:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: triplanner-<name>-dashboard
  namespace: {{ .Release.Namespace }}
  labels:
    grafana_dashboard: "1"
  annotations:
    grafana_folder: Triplanner
data:
  <name>.json: |-
    {{ .Files.Get "dashboards/<name>.json" | nindent 4 }}
```

- The sidecar already watches `grafana_dashboard=1` in all namespaces.
- The `grafana_folder: Triplanner` annotation groups the dashboards when the
  sidecar supports folder annotations; otherwise they appear in General.
- The JSON assets live in `helm/helm-triplanner/dashboards/` and are generated
  by `scripts/generate-dashboards.py` (stdlib only).
- The dashboard datasource UID is `prometheus`, matching the installed stack.

## 6. Verification

1. `helm upgrade triplanner ... --values deploy/kind/triplanner-values.yaml`.
2. `kubectl -n triplanner get servicemonitors` → 8 resources.
3. Port-forward Prometheus `9090`; query `/api/v1/targets` and confirm all
   `triplanner-*` jobs are `up`.
4. Query Prometheus for `up{job=~"triplanner-.*"}` and
   `triplanner_build_info`.
5. Port-forward Grafana `3001:80` (3000 is the Compose web); use the admin
   Secret to call `/api/search?query=Triplanner` and confirm 9 dashboards.
6. Fetch `triplanner-overview` and at least one per-service dashboard through
   the Grafana API; verify the panels and datasource.
7. Confirm the public Cilium Gateway still returns `302` for `/metrics`.
8. Confirm Grafana and Prometheus remain ClusterIP-only.

### 6.1 Observed evidence (2026-11-25)

- Stack moved to `kind-triplanner-cilium/monitoring`; release `prometheus`,
  chart 93.11.0, all pods ready.
- Triplanner chart 0.16.0, revision 15: 8 ServiceMonitors and 9 dashboard
  ConfigMaps.
- Prometheus active targets: 25 total, **8 `triplanner-*` targets, all `up`**.
- `up{job=~"triplanner-.*"}` returns 8 series with value `1`.
- `triplanner_build_info` returns 8 series, all `version="1.8.0"`.
- `honorLabels: true` verified: `triplanner_http_requests_total{service="users"}`
  returns data with `job="triplanner-users"`; `service="triplanner-users"` and
  `exported_service="users"` return no series.
- Dashboard sidecar wrote 9 JSON files to `/tmp/dashboards`.
- Grafana `/api/search?query=Triplanner` returns 9 dashboards; the overview has
  7 panels and the users dashboard 16 panels.
- Dashboard queries for request rate, p95, memory and in-flight return data from
  Prometheus.
- `scripts/metrics-smoke.ps1 -Target helm`: 8/8 services and the Gateway `302`
  still pass; `helm test` 7/7 suites pass; `/api/ready` is `backend: ok`.

## 7. Rollout and rollback

- Chart 0.16.0; no image changes required by this slice.
- Enable ServiceMonitors and dashboards in the local kind values.
- Rollback: set `metrics.serviceMonitor.enabled=false` and
  `metrics.dashboards.enabled=false`; delete the dashboard ConfigMaps if
  needed. The stack is unaffected.

## 8. Gate 1 decision

**Approved on 2026-11-25: option 1, amended to move the stack into the kind
cluster.** The original install was in `docker-desktop`; the monitoring cluster
was corrected to `kind-triplanner-cilium` so ServiceMonitors can reach the live
services.

## 9. Gate 2

**Approved on 2026-11-25.** The ServiceMonitor and dashboard slice is accepted;
image publication and release tagging are not part of this slice.
