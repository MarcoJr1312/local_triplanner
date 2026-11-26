# 0031 — PostgreSQL and MongoDB exporters

| Field | Value |
|---|---|
| Status | **Gate 2 approved locally (2026-11-25); release deferred** |
| Cycle | Kubernetes Manifest Delivery |
| Slice | M27 — database exporters and dashboards |
| Chart | `helm-triplanner` 0.21.0, revision 29 |
| Images | unchanged at `kind-0.19.0` |
| Exporter charts | `prometheus-postgres-exporter` 8.3.0 (v0.21.1) |
|  | `prometheus-mongodb-exporter` 3.23.2 (0.54.0) |

## 1. Result

Five separate upstream Helm releases run in `triplanner`:

| Release | Target | ServiceMonitor job |
|---|---|---|
| `triplanner-postgres-users` | users | `triplanner-postgres-users` |
| `triplanner-postgres-trips` | trips | `triplanner-postgres-trips` |
| `triplanner-postgres-api` | API facade | `triplanner-postgres-api` |
| `triplanner-postgres-agent` | agent pgvector | `triplanner-postgres-agent` |
| `triplanner-mongodb` | locations catalogue | `triplanner-mongodb` |

All use the upstream prometheus-community charts unmodified, with values under
`deploy/exporters/`. The Triplanner chart owns only the two dashboards, the
NetworkPolicy rules and the Mongo exporter ServiceAccount.

## 2. Credentials

`scripts/bootstrap-exporters.ps1` and `.sh` are idempotent and create:

- PostgreSQL role `postgres_exporter` with `pg_monitor` and `CONNECT` on each
  of the four databases.
- MongoDB user `mongodb_exporter` with `clusterMonitor` on `admin` and `read`
  on `local`.
- Secrets `triplanner-postgres-<service>-exporter` (`username`, `password`) and
  `triplanner-mongodb-exporter` (`mongodb-uri`, `password`).

The exporter Deployments reference the Secrets (verified for users:
`DATA_SOURCE_USER`/`DATA_SOURCE_PASS` point at
`triplanner-postgres-users-exporter`). No password or URI is committed.

## 3. Exposure and security

- All five exporter Services are **ClusterIP only**.
- No Gateway, HTTPRoute, Ingress or NodePort.
- No `kube-rbac-proxy` sidecar; this is recorded as a monitoring exemption in
  `docs/decisions/0001-kube-rbac-proxy-standard.md`.
- PostgreSQL exports run with `runAsNonRoot`, read-only root filesystem,
  `allowPrivilegeEscalation: false`, all capabilities dropped and
  `seccompProfile: RuntimeDefault`; the pod sets
  `automountServiceAccountToken: false`.
- The MongoDB exporter has the same container hardening; the Triplanner chart
  now creates its `triplanner-mongodb` ServiceAccount with
  `automountServiceAccountToken: false`. The running pod has no volumes and no
  service-account token mount.
- Resource budget per exporter: requests `20m / 32Mi`, limits `100m / 64Mi`.
  Total: **100m CPU / 160Mi requests**, **500m / 320Mi limits**.
- NetworkPolicy templates add five exporter policies and five database ingress
  policies (23 CiliumNetworkPolicies total when enabled). Locally
  `networkPolicy.enabled` remains `false` because the WSL2 kernel lacks
  `xt_socket`; the templates render cleanly.

## 4. Dashboards

Two new generated dashboards bring the total to eleven:

- `triplanner-postgres` — 28 panels: up, connections, max connections, database
  size, cache hit ratio, deadlocks, sessions by state, transactions, rollback
  ratio, top databases, blocks read, temp bytes, WAL size, locks by mode,
  longest transaction, top databases by size, exporter scrape/CPU/memory.
- `triplanner-mongodb` — 22 panels: up, uptime, connections, current/available,
  connection usage, opcounters, document operations, memory, WiredTiger cache,
  cache usage, dirty bytes, network in/out, global lock queue, objects by
  database, exporter CPU/memory/goroutines.

Both use schema 41, `${datasource}`, a `$service` variable (and
`$datname`/`$database`), `$__rate_interval`, units, thresholds, descriptions
and links to the overview and the other database dashboard. The overview now
links to both.

Screenshots:

- [PostgreSQL](../images/dashboard-postgres-exporters.png)
- [MongoDB](../images/dashboard-mongodb-exporter.png)

Headless Grafana check: overview + PostgreSQL + MongoDB render, all expected
panel titles present, **0 console errors**.

## 5. Prometheus evidence

After deployment and the rollback drill:

```text
targets: 13 (8 application + 5 exporter)
pg_up:
  triplanner-postgres-users 1
  triplanner-postgres-trips 1
  triplanner-postgres-api 1
  triplanner-postgres-agent 1
mongodb_up:
  triplanner-mongodb 1
```

Metric volume:

```text
pg_* samples:      2,706
mongodb_* samples: 2,828 across ~2,390 families
```

The MongoDB `--collect-all` default is broad but the dashboard uses only
serverStatus/dbstats families. No collection-level labels are displayed.

Verified queries:

```text
pg connection usage: users 3%, trips 3%, api 2%, agent 3%
pg wal size:         48 MiB / 32 MiB / 16 MiB / 32 MiB
mongo connections:   6 current, 6.55k available
mongo cache:         349 KiB in cache, 0 dirty, 256 MiB maximum
mongo objects:       triplanner 561, local 18, config 4, admin 4
```

## 6. Failure and rollback drills

**Failure injection** — scaled `triplanner-postgres-users` to zero:

```text
endpoints triplanner-postgres-users: <none>
active target triplanner-postgres-users: absent
```

Scaled back to 1 → target `up`. Prometheus retains the last `up=1` sample for
the staleness window, so the target list and endpoint state are the reliable
failure signals; an alert should use `absent()` or a sustained `up == 0`.

**Rollback** — uninstalled one release:

```text
helm uninstall triplanner-postgres-users
target triplanner-postgres-users: absent
helm upgrade --install triplanner-postgres-users ... --version 8.3.0
target triplanner-postgres-users: up
```

No database schema was changed by the rollback.

## 7. Commands

```bash
powershell -ExecutionPolicy Bypass -File scripts/bootstrap-exporters.ps1
powershell -ExecutionPolicy Bypass -File scripts/deploy-exporters.ps1
# or
bash scripts/bootstrap-exporters.sh
bash scripts/deploy-exporters.sh
```

Dashboards deploy with the Triplanner chart:

```bash
helm upgrade triplanner helm/helm-triplanner -n triplanner \
  -f deploy/kind/triplanner-values.yaml
```

## 8. Residual risks

| Risk | Mitigation |
|---|---|
| MongoDB `--collect-all` exposes ~2,390 families | Dashboard uses a small subset; can switch to selected collectors later |
| NetworkPolicy runtime not exercised locally | Rendered and lint-clean; enable on a kernel with `xt_socket` |
| No `pg_stat_statements` | Query-level latency is a separate follow-up |
| Prometheus keeps stale `up=1` for ~5 min after target removal | Alert on `absent()` or sustained `up == 0` |
| Mongo exporter has no scrape-error metric | `mongodb_up` plus process/Go metrics cover health |

## 9. Gate 2 decision

**Approved locally on 2026-11-25: accept M27 and hold the release.**
The five exporters, read-only identities, NetworkPolicy templates and two
dashboards are accepted on the local kind stack. `git push`, image publication
and release tagging remain deferred.
