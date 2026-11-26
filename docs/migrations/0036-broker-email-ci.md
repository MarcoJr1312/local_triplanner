# 0036 — Broker and email CI coverage

| Field | Value |
|---|---|
| Status | **Gate 2 approved (2026-11-26); released in `v1.8.0`** |
| Cycle | Kubernetes Manifest Delivery |
| Slice | M30 — broker/email workflows and image cutover |
| Workflows | `.github/workflows/broker.yml`, `.github/workflows/email.yml` |
| Images | `marcojr13/triplanner-kafka:sha-714d97a`, `marcojr13/triplanner-email:sha-714d97a` |
| Argo CD | `HEAD`, Synced/Healthy at `b13366e` |
| App images | six `sha-e377c12`, broker/email `sha-714d97a` |

## 1. Gap closed

The broker and email had Dockerfiles but no publish workflows, so their chart
tags (`0.2.0`) were not on Docker Hub. The kind overlay kept them local, which
left the image story inconsistent with the six CI services.

New workflows:

- **Broker — test and publish**: `actions/setup-go`, `go test ./...` and a
  multi-arch build of `backend/kafka/Dockerfile`.
- **Email — test and publish**: Bun install, typecheck, 70 tests and a
  multi-arch build of `backend/email-service/Dockerfile`.
- Both publish `sha-<short>`, semver and `latest` on `main`/tags.
- The `GitOps image tags` workflow maps `broker` and `email` as well.

## 2. Evidence

Workflow runs on merge `714d97a`:

```text
Broker - test and publish   45848382919  success
Email - test and publish    45848383014  success
```

Docker Hub:

```text
marcojr13/triplanner-kafka:sha-714d97a  OK
marcojr13/triplanner-email:sha-714d97a  OK
```

The GitOps tag workflow was run manually for both services:

```text
broker dispatch  45849950476  success  -> 9d4f4f6
email dispatch   45849953619  success  -> e3d44e2
```

Chart defaults then became:

```text
images.broker.tag: sha-714d97a
images.email.tag:  sha-714d97a
```

The local `images` block was removed from
`deploy/kind/triplanner-values.yaml`; all eight services now use chart defaults.
`deploy/kind/triplanner-local-images.yaml` remains only for local source builds.

## 3. Live verification

After the cutover merged at `d090ec7` and the node recovered from a Docker
Desktop restart:

```text
Argo CD:     Synced / Healthy
Images:      six marcojr13/triplanner-*:sha-e377c12
             marcojr13/triplanner-kafka:sha-714d97a
             marcojr13/triplanner-email:sha-714d97a
Pods:        all application pods 2/2 or 1/1 Running
Live:        /api/health ok, /api/ready {"status":"ready","backend":"ok"}
Prometheus:  13/13 targets
Grafana:     11 dashboards
```

The Docker Desktop restart changed the node IP from `172.19.0.4` to
`172.19.0.2`; re-running `deploy/kind/setup-cilium.ps1` refreshed Cilium’s
`k8sServiceHost` and restored pod egress. Stale `Unknown` pods were recreated by
their controllers; PVC-backed data was preserved.

## 4. Residual risk

| Risk | Mitigation |
|---|---|
| Automatic `workflow_run` skipped for the new workflows | Manual `workflow_dispatch` verified; future pushes should trigger it |
| Docker Desktop restart changes the kind node IP | Re-run `setup-cilium.ps1` / `deploy-demo.ps1`; documented |
| Email has no Compose service | Dedicated email workflow tests and publishes it |
| Broker/email release tags differ from the six services | Both groups use their published image build SHA |
| Branch protection blocks the tag workflow push | `contents: write` + bot push; adjust protection if needed |

## 5. Gate

Gate 2 approved on 2026-11-26: the broker and email have CI, published SHA
images, chart defaults and live Argo CD pods. The docs merged at `b13366e` and
the release shipped as `v1.8.0`.
