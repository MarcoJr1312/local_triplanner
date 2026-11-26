# Argo CD GitOps

Argo CD watches the public GitHub repository and keeps the Triplanner Helm
chart in sync.

| Item | Value |
|---|---|
| Argo CD chart | `argo/argo-cd` **10.20.0** (app v3.6.3) |
| Namespace | `triplanner-agrocd` |
| Application | `triplanner` |
| Git repo | `https://github.com/MarcoJr1312/local_triplanner` |
| Revision | `refactor/helm` |
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

Argo CD renders the chart but does not build or load images. The kind overlay
pins the application images to the image build SHA:

```yaml
images:
  web:
    tag: sha-5247619
```

The chart source revision is the Git commit that Argo CD synced; the image SHA
is the service-image build commit and can be older when only docs/chart files
changed.

The images must be tagged and loaded before Argo CD syncs that revision:

```powershell
docker tag triplanner-local/web:kind-0.19.0 triplanner-local/web:sha-5247619
kind load docker-image --name triplanner-cilium triplanner-local/web:sha-5247619
```

Use the same pattern for all eight application images. A future image
publication pipeline should produce `sha-<commit>` tags directly.

## Pod egress prerequisite

The Argo CD repo-server must reach GitHub. On Docker Desktop WSL2, Cilium's
iptables NAT chain can remain empty; `deploy/kind/setup-cilium.ps1` and
`deploy-demo.ps1` add an idempotent masquerade rule for `10.244.0.0/24`.
Re-run `deploy-demo.ps1` after a Docker Desktop restart if GitHub cloning
fails with `context deadline exceeded`.

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
