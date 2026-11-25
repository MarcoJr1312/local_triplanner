# 0026 — Grafana skills and dashboard redesign

| Field | Value |
|---|---|
| Status | **Accepted locally (2026-11-25)** |
| Area | SRE workflow, Grafana dashboards |
| Chart | `helm-triplanner` 0.18.0 |
| Helm release | `triplanner` revision 20 |
| Cluster | `kind-triplanner-cilium` / `monitoring` |

## 1. Skill integration

The upstream [grafana/skills](https://github.com/grafana/skills) repository was
vendored at commit `8fb72a5` (Apache-2.0):

- `.opencode/skills/grafana-dashboarding/` — dashboard JSON, panel types,
  24-column layout, variables, transformations, thresholds and links.
- `.opencode/skills/grafana-promql/` — rate windows, aggregation order,
  `histogram_quantile` with `le`, error-ratio guards and cardinality patterns.

They are wired into:

- `.opencode/agents/sre-devops.md` — dashboard work must load both skills.
- The Orkai **SRE / DevOps - Kubernetes Service Delivery** workflow
  (`9cbce416-d411-4f69-bbe5-4bcaf4bd4a1b`): a new **Grafana dashboards** node
  between observability and the lint/render gate.
- `AGENTS.md` working rules.

## 2. Dashboard redesign

All nine dashboards were regenerated from `scripts/generate-dashboards.py`:

- `schemaVersion: 41`.
- A `${datasource}` variable on every dashboard.
- A `service` variable on the overview and a `route` variable on each service
  dashboard; queries use `$__rate_interval`.
- Dashboard links: overview → each service; each service → overview.
- 24-column layout with Overview, Traffic, Health, Runtime and Routes/build
  rows.
- Panel descriptions, units, thresholds and no-data handling.
- Table legends for route panels; list legends for runtime and overview
  panels.
- `organize` transformations on the route/build tables.
- A **5xx ratio by route** bar gauge with the route label.
- 5xx ratios include a zero fallback so healthy services render `0%` instead
  of “No data”.
- The overview service-health table no longer shows the duplicate Kubernetes
  `service` column; all 8 services fit in the table.

## 3. Verification

- `helm lint` passes; chart 0.18.0 deployed as revision 20.
- The Grafana sidecar wrote all 9 JSON files to `/tmp/dashboards`.
- Grafana API:
  - `triplanner-users`: schema 41, 19 panels, variables `datasource,route`,
    1 dashboard link, panel types include `bargauge`.
  - `triplanner-overview`: schema 41, 9 panels, variables
    `datasource,service`, 8 service links.
  - Search returns 9 Triplanner dashboards.
- Headless Grafana at `http://127.0.0.1:3001`:
  - Users: 14 grid items; expected titles present; no console errors.
  - Overview: 6 grid items; expected titles present; no console errors.
  - Screenshots: `docs/images/dashboard-users.png` and
    `docs/images/dashboard-overview.png`.
- New PromQL queries return data:
  - users RPS, p95, memory and CPU;
  - users 5xx ratio = 0 with the zero fallback;
  - overview RPS/5xx series = 8 services.
- Metrics smoke 8/8, Gateway `/metrics` 302, Helm tests 7/7, Prometheus
  targets 8/8 up.

## 4. Files

- `.opencode/skills/` — vendored Grafana skills and attribution.
- `.opencode/agents/sre-devops.md` — dashboard requirements.
- `scripts/generate-dashboards.py`
- `helm/helm-triplanner/dashboards/*.json`
- `helm/helm-triplanner/Chart.yaml` — 0.18.0.
- `docs/images/dashboard-users.png`, `docs/images/dashboard-overview.png`.

No application, database or ServiceMonitor changes; Grafana and Prometheus
remain ClusterIP-only.
