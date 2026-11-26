# Argo CD GitOps

Argo CD watches the public GitHub repository and keeps the Triplanner Helm
chart in sync.

| Item | Value |
|---|---|
| Argo CD chart | `argo/argo-cd` **10.20.0** (app v3.6.3) |
| Namespace | `triplanner-agrocd` |
| Application | `triplanner` |
| Git repo | `https://github.com/MarcoJr1312/local_triplanner` |
| Revision | **`HEAD`** (default branch `main`) |
| Chart path | `helm/helm-triplanner` |
| Values | `$values/deploy/kind/triplanner-values.yaml` |
| Sync | automated, `selfHeal: true`, `prune: false` |
| UI | ClusterIP + `kubectl port-forward` |

## Install

```powershell
helm repo add argo https://argoproj.github.io/argo-helm
helm repo update

helm upgrade --install argocd argo/argo-cd `
  --version 10.20.0 `
  --kube-context kind-triplanner-cilium `
  --namespace triplanner-agrocd `
  --create-namespace `
  --values deploy/argocd/values.yaml `
  --wait --timeout 10m

kubectl --context kind-triplanner-cilium apply `
  -f deploy/argocd/project.yaml `
  -f deploy/argocd/application.yaml
```

The chart policies are disabled in `values.yaml` because the Docker Desktop
WSL2 kernel does not allow the kubelet probes through the chart's repo-server
NetworkPolicy. The Argo CD UI is ClusterIP-only.

## Open the UI

```powershell
kubectl --context kind-triplanner-cilium -n triplanner-agrocd `
  port-forward svc/argocd-server 8080:443
# https://localhost:8080  (self-signed certificate)
```

The initial admin password is in the `argocd-initial-admin-secret` Secret. It
is never committed.

## Images

Argo CD renders the chart but does not build or load images. The six
CI-published services use the chart defaults:

```yaml
images:
  web:
    tag: sha-e377c12
```

`broker` and `email` have no publish workflows yet, so
`deploy/kind/triplanner-values.yaml` keeps them on local
`triplanner-local/*:sha-5247619` images. `deploy/kind/deploy-demo.ps1` and
`.sh` also pass `deploy/kind/triplanner-local-images.yaml` for a full local
source build.

The chart source revision is the Git commit Argo CD synced; the image SHA is
the service-image build commit and can be older when only docs/chart files
changed.

## Pod egress prerequisite

The Argo CD repo-server must reach GitHub. On Docker Desktop WSL2, Cilium's
iptables NAT chain can remain empty; `deploy/kind/setup-cilium.ps1` and
`deploy-demo.ps1` add an idempotent masquerade rule for `10.244.0.0/24`.
Re-run `deploy-demo.ps1` after a Docker Desktop restart if GitHub cloning
fails with `context deadline exceeded`.

## Current cutover state

PR #1 is merged and the Application tracks `HEAD` (the default branch).

- Six services: `marcojr13/triplanner-*:sha-e377c12`, pulled from Docker Hub.
- Broker/email: local `triplanner-local/*:sha-5247619`.
- The `GitOps image tags` workflow has `workflow_dispatch` as a manual fallback;
  its first `workflow_run` was not observed for the merge commit.
- The kind node has egress after the NAT fix.

## Operating rules

- Argo CD owns `triplanner` after the first sync. **Do not run
  `helm upgrade`, `helm rollback` or `helm uninstall` for `triplanner`.**
- `prune: false` protects PVCs and Secrets from accidental deletion. Enable
  pruning only after a separate review.
- Manual drift is corrected by `selfHeal`; changes must go through Git.
- To pause reconciliation, suspend the Application:

  ```powershell
  kubectl --context kind-triplanner-cilium -n triplanner-agrocd `
    patch application triplanner --type merge `
    -p '{"spec":{"syncPolicy":{"automated":null}}}'
  ```

- Rollback through Git (revert the commit) or the Argo CD history. Deleting
  the Application does not delete the namespace resources by default.

## Files

- `values.yaml` — Argo CD Helm values (containers, resources, no dex/notifications)
- `project.yaml` — AppProject restricted to this repo and the `triplanner` namespace
- `application.yaml` — Application with multi-source Helm values
