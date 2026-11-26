# 0030 — PostgreSQL and MongoDB exporters (plan)

| Field | Value |
|---|---|
| Status | **Plan — Gate 1 pending** |
| Cycle | Kubernetes Manifest Delivery |
| Slice | M27 — database exporters and dashboards |
| Chart target | `helm-triplanner` 0.21.0 (dashboards only) |
| Exporter charts | `prometheus-community/prometheus-postgres-exporter` 8.3.0 (app v0.21.1) |
|  | `prometheus-community/prometheus-mongodb-exporter` 3.23.2 (app 0.54.0) |
| Namespace | `triplanner` |
| Monitoring | `prometheus` in `monitoring`, ServiceMonitor selector `release: prometheus` |

## 1. Goal

Add database-level observability to the local Helm stack:

- PostgreSQL: connections, transactions, cache hit ratio, locks, temp files,
  database size, deadlocks and exporter health for **each** Triplanner
  PostgreSQL instance.
- MongoDB: connections, op counters, memory, WiredTiger cache, network, locks,
  document counts and exporter health for the locations catalogue.
- Two Grafana dashboards provisioned the same way as the existing nine.

This closes the “PostgreSQL/MongoDB exporters” follow-up listed in
`0023-monitoring.md` and `0022-metrics.md` §10.

## 2. Current state

| Database | StatefulSet | Service | Secret | Owner |
|---|---|---|---|---|
| users | `triplanner-users-postgres` | `triplanner-users-postgres:5432` | `triplanner-users-postgres-credentials` | users service |
| trips | `triplanner-trips-postgres` | `triplanner-trips-postgres:5432` | `triplanner-trips-postgres-credentials` | trips service |
| API | `triplanner-api-postgres` | `triplanner-api-postgres:5432` | `triplanner-api-postgres-credentials` | API facade |
| agent | `triplanner-agent-postgres` | `triplanner-agent-postgres:5432` | `triplanner-agent-postgres-credentials` | agent service |
| locations | `triplanner-mongo` | `triplanner-mongo:27017` | `triplanner-mongo-credentials` | locations service |

All are ClusterIP-only. MongoDB auth is enabled. The monitoring stack is
installed as release `prometheus` in `monitoring`; its Prometheus selects
ServiceMonitors from all namespaces with `release: prometheus`, and the Grafana
sidecar watches `grafana_dashboard=1` ConfigMaps in all namespaces.

Docker Desktop is currently stopped; the kind cluster is not reachable. The
implementation slice must start Docker Desktop and `kind-triplanner-cilium`
first, then refresh the Cilium `k8sServiceHost` if the node IP changed.

## 3. Topology decision

The PostgreSQL exporter connects to **one DSN per process** unless it is run in
`/probe` multi-target mode. Triplanner has four isolated PostgreSQL instances,
so one exporter cannot represent all four without extra target/auth-module
configuration.

### Option A — one exporter per PostgreSQL instance (recommended)

| Release | Scrapes | ServiceMonitor job |
|---|---|---|
| `triplanner-postgres-users` | users | `triplanner-postgres-users` |
| `triplanner-postgres-trips` | trips | `triplanner-postgres-trips` |
| `triplanner-postgres-api` | API | `triplanner-postgres-api` |
| `triplanner-postgres-agent` | agent | `triplanner-postgres-agent` |
| `triplanner-mongodb` | locations Mongo | `triplanner-mongodb` |

- Pros: unambiguous `service`/`job` per database, failure isolation, no
  multi-target relabeling, simple dashboard variables, one chart release per
  instance with clear rollback.
- Cons: five small pods and four PostgreSQL credential sets.
- Budget: 4 × 20m CPU / 32Mi requests (100m/64Mi limits) + Mongo
  20m/32Mi requests (100m/64Mi limits). Total **100m CPU / 160Mi requests**,
  **500m / 320Mi limits**.

### Option B — one multi-target PostgreSQL exporter

- One exporter, `config.postgresExporter` with four auth modules, one
  ServiceMonitor with four `/probe` targets, `target`/`instance` relabeling.
- Pros: one PostgreSQL pod.
- Cons: more moving parts, duplicate default `/metrics` target unless carefully
  disabled, single point of failure, dashboard queries depend on `target`
  labels, harder failure diagnosis.
- Effort: roughly one extra day versus A for this demo.

### Option C — one exporter for a single database

- Cheapest, but three PostgreSQL instances remain unmonitored. Not recommended.

**Recommendation: Option A.** The extra 80m CPU / 128Mi requests are well
within the single-node budget and keep each database’s telemetry independent.

## 4. Credentials and secret strategy

Use dedicated read-only monitoring identities, not the application/superuser
credentials.

### PostgreSQL

Per instance, create role `postgres_exporter`:

```sql
-- idempotent bootstrap; password supplied from a generated Secret
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'postgres_exporter') THEN
    CREATE ROLE postgres_exporter LOGIN PASSWORD :'password';
  ELSE
    ALTER ROLE postgres_exporter WITH PASSWORD :'password';
  END IF;
END
$$;
GRANT pg_monitor TO postgres_exporter;
GRANT CONNECT ON DATABASE <database> TO postgres_exporter;
```

- The exporter chart supports `config.datasource.userSecret` and
  `passwordSecret`, so each release references
  `triplanner-postgres-<service>-exporter` keys `username` / `password`.
- No DSN password is written to `values.yaml`.
- Bootstrap is idempotent and reuses the existing exporter Secret when present.

### MongoDB

Create user `mongodb_exporter` in `admin`:

```js
db.getSiblingDB("admin").createUser({
  user: "mongodb_exporter",
  pwd: password,
  roles: [
    { role: "clusterMonitor", db: "admin" },
    { role: "read", db: "local" }
  ]
});
```

- The Mongo exporter chart uses `existingSecret.name` +
  key `mongodb-uri`; the Secret holds
  `mongodb://mongodb_exporter:<password>@triplanner-mongo:27017/admin?authSource=admin`.
- The URI Secret is created by the bootstrap script, never committed.

### Bootstrap automation

`scripts/bootstrap-exporters.ps1` and `.sh`:

1. Read the existing database admin credentials from the Kubernetes Secrets.
2. `kubectl exec` the idempotent SQL / `mongosh` statements.
3. Create/reuse the exporter Secrets with generated 32-character passwords.
4. Never print a password.

Production overrides the generated Secrets with Vault/External Secrets and
keeps the same role grants. This is a demo-only bootstrap path.

## 5. Exposure, RBAC and security

- Exporter Services are **ClusterIP only**. No Gateway, HTTPRoute, Ingress or
  NodePort. Prometheus scrapes them in-cluster.
- No `kube-rbac-proxy` sidecar on the exporters. They are Prometheus-only
  scrape targets, like the existing unauthenticated `/metrics` ports; adding
  rbac-proxy would require Prometheus bearer tokens and is not supported by the
  upstream charts. This is an explicit exception to
  `docs/decisions/0001-kube-rbac-proxy-standard.md` and gets an ADR amendment
  at implementation time.
- Both charts already default to non-root, no privilege escalation, dropped
  capabilities and a read-only root filesystem. Set
  `podSecurityContext.seccompProfile.type: RuntimeDefault` on MongoDB.
- No ClusterRole, ClusterRoleBinding or broad RBAC. The charts create a
  ServiceAccount; token automount stays off where supported.
- NetworkPolicy (rendered, disabled locally because the WSL2 kernel lacks
  `xt_socket`):
  - exporters may egress to the four PostgreSQL Services on `5432`, Mongo on
    `27017` and DNS;
  - PostgreSQL/Mongo CNPs allow ingress from the exporter pods;
  - Prometheus in `monitoring` may scrape the exporter ports `9187` / `9216`.
- No secrets in the repo, values, images, logs or dashboards. The bootstrap
  script must not echo credentials.

## 6. Chart values shape

PostgreSQL, one file per instance:

```yaml
# deploy/exporters/postgres-users.yaml
fullnameOverride: triplanner-postgres-users
config:
  datasource:
    host: triplanner-users-postgres
    port: "5432"
    database: users
    sslmode: disable
    userSecret:
      name: triplanner-postgres-users-exporter
      key: username
    passwordSecret:
      name: triplanner-postgres-users-exporter
      key: password
serviceMonitor:
  enabled: true
  interval: 30s
  timeout: 10s
  labels:
    release: prometheus
resources:
  requests: { cpu: 20m, memory: 32Mi }
  limits: { cpu: 100m, memory: 64Mi }
```

MongoDB:

```yaml
# deploy/exporters/mongodb.yaml
fullnameOverride: triplanner-mongodb
existingSecret:
  name: triplanner-mongodb-exporter
  key: mongodb-uri
serviceMonitor:
  enabled: true
  interval: 30s
  scrapeTimeout: 10s
  additionalLabels:
    release: prometheus
podSecurityContext:
  seccompProfile: { type: RuntimeDefault }
resources:
  requests: { cpu: 20m, memory: 32Mi }
  limits: { cpu: 100m, memory: 64Mi }
```

Install as separate releases, not vendored subcharts:

```bash
helm upgrade --install triplanner-postgres-users \
  prometheus-community/prometheus-postgres-exporter --version 8.3.0 \
  -n triplanner -f deploy/exporters/postgres-users.yaml
# ... trips, api, agent; then mongodb with --version 3.23.2
```

The upstream charts stay unmodified and independently upgradeable. The
Triplanner chart only gains the two dashboards.

## 7. Dashboards

Add two generated dashboards, bringing the total to eleven:

- `helm/helm-triplanner/dashboards/postgres.json` — id `triplanner-postgres`
- `helm/helm-triplanner/dashboards/mongodb.json` — id `triplanner-mongodb`

Both follow the vendored Grafana skills: `schemaVersion: 41`, `${datasource}`,
24-column grid, `$__rate_interval`, units, thresholds, panel descriptions and
links to the Triplanner overview. Variables:

- PostgreSQL: `$service` from `label_values(pg_up, service)`, `$datname` from
  `label_values(pg_stat_database_numbackends, datname)`.
- MongoDB: `$service` from `label_values(mongodb_up, service)`.

### PostgreSQL panels (candidates, verified after deployment)

| Section | Panels |
|---|---|
| Overview | `pg_up`, active connections, max connections, database size, deadlocks/s, cache hit % |
| Connections | backends by database, sessions by state, connection saturation |
| Transactions | commit/s, rollback/s, rollback ratio |
| Cache and I/O | buffer hit ratio, blocks read/s, temp files/s, temp bytes/s |
| Locks | locks by mode, deadlocks/s |
| Databases | top databases by size, size table |
| Exporter | last scrape error, scrape duration, target up |

PostgreSQL query latency is **not** available without `pg_stat_statements`.
That extension is not installed; adding it is a separate follow-up, not part of
this slice.

### MongoDB panels (candidates, verified after deployment)

| Section | Panels |
|---|---|
| Overview | `mongodb_up`, uptime, current/available connections, memory, ops/s |
| Connections | current vs available, usage % |
| Operations | insert/query/update/delete/getmore/command per second |
| Memory and cache | resident/virtual memory, WiredTiger cache bytes, dirty bytes, cache usage % |
| Network | bytes in/out per second |
| Locks and documents | global lock queues, document count |
| Exporter | scrape error, target up |

Metric names from the current Percona exporter are discovered by port-forwarding
the exporter and dumping `/metrics`; the dashboard is pinned to the names that
actually exist, not guessed.

## 8. Files and tasks

| Work | Owner | Output |
|---|---|---|
| Gate 1 scope/exposure | Human | decision recorded |
| Bootstrap roles and Secrets | SRE/Backend | `scripts/bootstrap-exporters.ps1/.sh` |
| PostgreSQL exporter releases | SRE | 4 values files + install |
| MongoDB exporter release | SRE | values file + install |
| ServiceMonitors and targets | SRE | 5 targets `UP` |
| PostgreSQL dashboard | SRE | `postgres.json` |
| MongoDB dashboard | SRE | `mongodb.json` |
| NetworkPolicy + security review | SRE | rendered CNPs, no public port |
| Rollout, rollback, QA | QA | evidence + Gate 2 |

## 9. Verification matrix

- `helm lint` and `helm template` clean for each upstream values file.
- 5 exporter pods `1/1` Ready; non-root, no privilege escalation, read-only
  root FS; no crashloops.
- Prometheus targets 5/5 `UP`: four `pg_up 1`, one `mongodb_up 1`.
- Grafana renders both dashboards; no `No data` on the overview panels after a
  short app load; zero browser console errors.
- No exporter Service is public; `kubectl get svc` shows ClusterIP only.
- Secret grep: no password/URI in `values.yaml`, chart templates, logs or
  dashboard JSON.
- Failure injection: delete one exporter pod → target DOWN → pod recovers.
- Rollback drill: uninstall one release → target disappears; reinstall →
  target returns.

## 10. Rollout and rollback

1. Start Docker Desktop and `kind-triplanner-cilium`; verify the existing 8
   targets are `UP`.
2. Run the bootstrap script; verify roles and Secrets exist.
3. Install `triplanner-postgres-users` as the canary; verify `pg_up 1` and
   dashboards render.
4. Install the other three PostgreSQL exporters and the MongoDB exporter.
5. Upgrade the Triplanner chart to 0.21.0 for the two dashboards.
6. Run a short app load and verify non-zero database metrics.
7. Rollback: `helm uninstall` the exporter releases; `helm rollback
   triplanner` to 0.20.0. Database roles/Secrets can remain (read-only) or be
   dropped with a documented SQL/Mongo command.

## 11. Risks

| Risk | Mitigation |
|---|---|
| Docker Desktop / kind offline | Start it first; refresh Cilium `k8sServiceHost` if the node IP changes |
| Exporter credentials become a new secret leak | Dedicated read-only users, Secrets only, no logs |
| MongoDB `--collect-all` cardinality | Discover metric count first; if too high, restrict collectors or drop collection labels |
| Cilium NetworkPolicy blocks exporter egress on a compatible kernel | Render and test CNPs; add explicit egress/ingress rules |
| Four pods add resource pressure | 100m/160Mi total requests; monitor node capacity |
| Upstream chart changes break values | Pin chart versions 8.3.0 / 3.23.2; upgrade deliberately |

## 12. Out of scope

- Alerting rules and Alertmanager routing.
- PostgreSQL `pg_stat_statements`, query-level latency, slow-query logs.
- MongoDB replica-set, sharding or PBM backup metrics.
- Cilium/Hubble and node exporters.
- Grafana public exposure or persistence.
- Publishing charts/images or tagging a release.

## 13. Gate 1 decision

**Pending.** Approve or change:

1. **Topology** — four PostgreSQL exporters (one per instance) + one MongoDB
   exporter (recommended), or one multi-target PostgreSQL exporter.
2. **Credentials** — dedicated `postgres_exporter` / `mongodb_exporter` users
   (recommended), or reuse the existing application credentials for the demo.
3. **Exposure** — ClusterIP-only, no rbac-proxy sidecar, documented as a
   monitoring exception (recommended), or add the sidecar and Prometheus auth.

No manifests or cluster changes are made before this approval.
