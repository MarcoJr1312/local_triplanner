# 0035 — GitOps image cutover

> **Update 2026-11-26:** broker/email now have publish workflows and all eight
> services use published SHA tags: six `sha-e377c12`, broker/email
> `sha-714d97a`. See
> [`0036-broker-email-ci.md`](./0036-broker-email-ci.md). The broker/email
> local rows below are the pre-broker/email-CI snapshot.

| Field | Value |
|---|---|
| Status | **Gate 2 approved locally (2026-11-26); release deferred** |
| Cycle | Kubernetes Manifest Delivery |
| Slice | M29.2 — published SHA images, HEAD tracking |
| Chart | `helm-triplanner` 0.21.0 |
| Argo CD | Application `triplanner`, `targetRevision: HEAD`, **Synced/Healthy** |
| Published images | `marcojr13/triplanner-*:sha-e377c12` for six services |
| Local images | `triplanner-local/{kafka,email}:sha-5247619` |
| Source | `main` at `ed582ab`; PRs #4, #5 and #6 merged |

## 1. What changed

- `helm/helm-triplanner/values.yaml` now pins the six CI-built services to
  `sha-e377c12`:
  - web, api, users, trips, locations, agent
- `deploy/kind/triplanner-values.yaml` keeps only the broker and email local
  images; the six service overrides were removed.
- `deploy/kind/triplanner-local-images.yaml` was added for full local source
  builds.
- `deploy/kind/deploy-demo.ps1` / `.sh` now pass both values files for local
  source builds.
- `deploy/argocd/application.yaml` tracks `HEAD` (applied live).
- The `GitOps image tags` workflow has a `workflow_dispatch` fallback because
  GitHub did not trigger `workflow_run` for the merge commit.

## 2. Evidence

All six published manifests exist:

```text
web sha-e377c12 OK
api sha-e377c12 OK
users sha-e377c12 OK
trips sha-e377c12 OK
locations sha-e377c12 OK
agent sha-e377c12 OK
```

Argo CD render (published values, no local overlay):

```text
marcojr13/triplanner-agent:sha-e377c12
marcojr13/triplanner-api:sha-e377c12
marcojr13/triplanner-locations:sha-e377c12
marcojr13/triplanner-trips:sha-e377c12
marcojr13/triplanner-users:sha-e377c12
marcojr13/triplanner-web:sha-e377c12
triplanner-local/email:sha-5247619
triplanner-local/kafka:sha-5247619
```

Local build render (both values files): all eight
`triplanner-local/*:sha-5247619`.

Checks:

```text
helm lint (published + local values)       OK
helm template published render             six marcojr13 sha-e377c12 + local broker/email
helm template local render                 eight triplanner-local sha-5247619
actionlint gitops-image-tags.yml           0 errors
bash -n scripts/ci-update-image-tag.sh     OK
kubectl apply --dry-run=server Application unchanged (HEAD)
```

## 3. Live state

The cutover merged to `main` at `7acfeab` and the overlay fix at `0d7e5f4`;
the CI yq permission fix is `ed582ab`.

```text
Argo CD:       Synced / Healthy
Revision:      ed582ab
Images:        six marcojr13/triplanner-*:sha-e377c12
               triplanner-local/{kafka,email}:sha-5247619
Live:          /api/health ok, /api/ready {"status":"ready","backend":"ok"}
Prometheus:    13/13 targets
Grafana:       11 dashboards
```

The kind node pulls the published images from Docker Hub through the NAT rule
added by the setup/deploy scripts.

## 4. Residual risk

| Risk | Mitigation |
|---|---|
| Automatic `workflow_run` still not observed | `workflow_dispatch` verified with run `45768988141`; next service push should exercise the automatic path |
| Docker Hub pull on kind | Public manifests verified; NAT fix applied |
| Broker/email have no publish workflows | Keep local overrides until workflows exist |
| Chart source revision newer than image SHA | Expected when only docs/CI change |

## 5. Gate

**Approved locally on 2026-11-26: accept M29.2 and hold the release.** Local
acceptance is complete; the live app runs the published SHA images for six
services and local broker/email images.
