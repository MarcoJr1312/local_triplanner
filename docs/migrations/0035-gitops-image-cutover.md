# 0035 — GitOps image cutover

| Field | Value |
|---|---|
| Status | **Prepared on `feature/argocd-head`; merge pending** |
| Cycle | Kubernetes Manifest Delivery |
| Slice | M29.2 — published SHA images, HEAD tracking |
| Chart | `helm-triplanner` 0.21.0 |
| Argo CD | Application `triplanner`, `targetRevision: HEAD`, Synced/Healthy |
| Published images | `marcojr13/triplanner-*:sha-e377c12` for six services |
| Local images | `triplanner-local/{kafka,email}:sha-5247619` |
| Source | `main` at `a893b9c`; branch `feature/argocd-head` |

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

Before this branch merges, Argo CD is already on `HEAD` and the live app still
uses the local `sha-5247619` images because `main` still has the old overlay.
After the cutover branch merges:

1. Argo CD syncs `main` with the six chart-default SHA images.
2. Six Deployments roll to Docker Hub `sha-e377c12` images.
3. Broker/email stay on local images already loaded in kind.
4. `/api/ready` must remain `{"status":"ready","backend":"ok"}`.

The kind node has GitHub/Docker Hub egress through the NAT rule added by the
setup/deploy scripts.

## 4. Residual risk

| Risk | Mitigation |
|---|---|
| `workflow_run` still not observed | `workflow_dispatch` fallback; next service push should exercise it |
| Docker Hub pull on kind | Public manifests verified; NAT fix applied |
| Broker/email have no publish workflows | Keep local overrides until workflows exist |
| Chart source revision newer than image SHA | Expected when only docs/CI change |
| Cutover branch not merged | Live app remains on local images; no data risk |

## 5. Gate

Gate 2 should wait for the cutover branch merge and the first published-image
rollout. Until then, the live app remains healthy on local images.
