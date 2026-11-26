# Release notes — v1.8.0 (GitOps, CI images and monitoring)

| Field | Value |
|---|---|
| Status | **Released; tagged `v1.8.0` on 2026-11-26** |
| Chart | `helm-triplanner` 0.21.0 (`appVersion` 1.8.0) |
| Argo CD | Application `triplanner`, `targetRevision: HEAD`, **Synced / Healthy** |
| Published images | six `marcojr13/triplanner-*:sha-e377c12`, broker/email `sha-714d97a` |
| Release images | the `v1.8.0` tag publishes `1.8.0` and `1.8` for all eight images |
| Evidence | `docs/migrations/0033`–`0036` and `docs/CICD.md` |

`v1.8.0` is the first release since `v1.7.0`. It keeps the local-only product
contract: Docker Compose is still the recruiter quickstart, the Helm/Cilium
stack is the advanced local path, and there is no Firebase, AWS or mandatory
third-party account.

## Highlights

- **Argo CD GitOps.** Argo CD runs in `triplanner-agrocd` and owns the
  `triplanner` Application from `helm/helm-triplanner` at `targetRevision:
  HEAD`, with automated sync and self-heal. The UI stays ClusterIP-only.
- **CI coverage for all eight services.** The Go demo broker and the Bun email
  service now have their own test/publish workflows. Every image publishes
  `sha-<short>`, semver on `v*` tags and `latest` on `main`, for `amd64` and
  `arm64`.
- **Immutable image pins.** The chart deploys published SHA tags, not mutable
  tags: six services at `sha-e377c12` and broker/email at `sha-714d97a`.
- **GitOps image-tag automation.** `.github/workflows/gitops-image-tags.yml`
  updates the chart after a service publish. `workflow_dispatch` with
  `service` + `tag` inputs is the verified fallback.
- **Monitoring.** Four PostgreSQL exporters and one MongoDB exporter, eight
  per-service ServiceMonitors, 13/13 Prometheus targets and 11 Grafana
  dashboards. Latency panels show p50 and p95; users, trips and locations also
  expose gRPC request metrics.
- **Platform hardening.** Every internal service (`api`, `users`, `trips`,
  `locations`, `agent`, `email`, `broker`) has a `kube-rbac-proxy` sidecar on
  8443. The web remains the only public Cilium Gateway entry.
- **Runner and docs.** The kind cluster runs Cilium with the Gateway API; the
  demo, troubleshooting and CI/CD docs cover the published-image path and the
  node-IP recovery after a Docker Desktop restart.

## Images

| Service | Docker Hub repository | Chart pin |
|---|---|---|
| Web | `marcojr13/triplanner-web` | `sha-e377c12` |
| API | `marcojr13/triplanner-api` | `sha-e377c12` |
| Users | `marcojr13/triplanner-users` | `sha-e377c12` |
| Trips | `marcojr13/triplanner-trips` | `sha-e377c12` |
| Locations | `marcojr13/triplanner-locations` | `sha-e377c12` |
| Agent | `marcojr13/triplanner-agent` | `sha-e377c12` |
| Broker | `marcojr13/triplanner-kafka` | `sha-714d97a` |
| Email | `marcojr13/triplanner-email` | `sha-714d97a` |

The `1.8.0`/`1.8` tags are rebuilt from the tagged commit and are available for
manual pinning. The chart intentionally keeps the tested SHA pins, so an Argo CD
sync does not move the running demo onto a mutable or semver tag.

## Upgrade

The recruiter quickstart is unchanged:

```bash
docker compose -f deploy/docker-compose.yml up --build
```

For the Helm/Cilium stack:

```bash
kubectl --context kind-triplanner-cilium -n triplanner-agrocd annotate \
  application triplanner argocd.argoproj.io/refresh=normal --overwrite
# or, without Argo CD:
helm upgrade triplanner helm/helm-triplanner -n triplanner --wait
```

To run the release tags explicitly, set `images.*.tag=1.8.0` (the broker/email
keys are `images.broker.tag` and `images.email.tag`). Local source builds still
use `deploy/kind/triplanner-local-images.yaml`.

## Verification

```text
Argo CD:     Synced / Healthy at b13366e
Images:      all eight services from Docker Hub (six sha-e377c12, broker/email sha-714d97a)
Live:        /api/ready {"status":"ready","backend":"ok"}
Prometheus:  13/13 targets
Grafana:     11 dashboards
```

The eight service workflows and the Compose smoke run on the `v1.8.0` tag; the
run IDs and published tags are recorded in
[`docs/CICD.md`](../CICD.md).

## Known limitations

- macOS clean-clone QA is still pending.
- The automatic `workflow_run` trigger for the GitOps tag updater was skipped
  for the new broker/email workflows; the manual `workflow_dispatch` path is
  verified and remains available.
- A Docker Desktop restart can change the kind node IP. Re-run
  `deploy/kind/setup-cilium.ps1` and delete stale `Unknown` pods; PVC data is
  preserved.
- The release tag rebuilds images from one commit, while the chart pins two
  earlier per-service SHAs. Both represent the same source state; the SHA pins
  remain the tested deployment.

## Rollback

Argo CD keeps the previous synced revision; use **History and rollback** for the
Application. Without Argo CD, redeploy the previous chart revision or pin the
previous `images.*.tag` values. The databases are unchanged by this release, so
no data migration rollback is required. Compose users can return to the previous
checkout and run `docker compose -f deploy/docker-compose.yml up --build`.
