# 0032 — Argo CD GitOps for helm-triplanner (plan)

| Field | Value |
|---|---|
| Status | **Gate 1 approved (2026-11-25); implemented in `0033-argocd-gitops.md`** |
| Cycle | Kubernetes Manifest Delivery |
| Slice | M28 — Argo CD and GitOps |
| Argo CD chart | `argo/argo-cd` **10.20.0** (app v3.6.3) |
| Namespace | `triplanner-agrocd` (as requested; conventional spelling is `triplanner-argocd`) |
| Application namespace | `triplanner` |
| Git source | `https://github.com/MarcoJr1312/local_triplanner` |
| Git path | `helm/helm-triplanner` |
| Git revision | `refactor/helm` |
| Sync | automated, `selfHeal: true`, `prune: false` initially |

## 1. Goal

Put the Triplanner Helm chart under Argo CD control:

- Argo CD runs in its own `triplanner-agrocd` namespace.
- One Argo CD `Application` watches the public GitHub repo at
  `helm/helm-triplanner`.
- Changes pushed to the tracked branch are applied automatically.
- Manual drift is corrected by `selfHeal`.
- The Argo CD UI stays ClusterIP-only and is reached with `kubectl
  port-forward` unless a Gateway route is explicitly approved.

## 2. Current state and blocker

The chart is at `0.21.0`, release `triplanner` revision 29, with 13 Prometheus
targets and 11 dashboards. All application resources carry
`app.kubernetes.io/instance: triplanner`.

**Blocker:** branch `refactor/helm` has no upstream. `git ls-remote origin
refactor/helm` returns nothing. Argo CD cannot sync a branch that only exists
on this workstation.

The first implementation step is therefore:

```bash
git push -u origin refactor/helm
```

This requires explicit approval because the release has been held local until
now. Argo CD also needs the branch to contain the current chart (`0.21.0`) and
the `deploy/kind/triplanner-values.yaml` overlay.

## 3. Architecture

```text
GitHub: MarcoJr1312/local_triplanner
  branch: refactor/helm
  path:   helm/helm-triplanner
        |
        |  poll every ~2-3 min (no GitHub webhook to a local kind cluster)
        v
Argo CD (namespace triplanner-agrocd)
  Application: triplanner
  AppProject:  triplanner
        |
        v
namespace triplanner
  Helm-rendered application resources
```

Argo CD is installed by Helm, not by itself. Self-management (an app-of-apps
for Argo CD and the exporters) is a follow-up, not this slice.

The PostgreSQL/MongoDB exporter releases are **not** in this Application: the
requested path is only `helm/helm-triplanner`, and the exporter releases are
separate upstream charts. They remain manually managed for now.

## 4. Argo CD installation

Use the hosted Helm index generated from `github.com/argoproj/argo-helm`:

```bash
helm repo add argo https://argoproj.github.io/argo-helm
helm repo update
helm upgrade --install argocd argo/argo-cd \
  --version 10.20.0 \
  --namespace triplanner-agrocd \
  --create-namespace \
  --values deploy/argocd/values.yaml \
  --wait
```

Proposed `deploy/argocd/values.yaml`:

```yaml
crds:
  install: true
  keep: true

configs:
  cm:
    application.instanceLabelKey: argocd.argoproj.io/instance
    timeout.reconciliation: 120s
    timeout.reconciliation.jitter: 30s
  params:
    server.insecure: false

dex:
  enabled: false
notifications:
  enabled: false

server:
  service:
    type: ClusterIP
  resources:
    requests: { cpu: 50m, memory: 64Mi }
    limits: { cpu: 200m, memory: 256Mi }

controller:
  resources:
    requests: { cpu: 100m, memory: 256Mi }
    limits: { cpu: 500m, memory: 512Mi }

repoServer:
  resources:
    requests: { cpu: 50m, memory: 128Mi }
    limits: { cpu: 300m, memory: 512Mi }

redis:
  resources:
    requests: { cpu: 25m, memory: 32Mi }
    limits: { cpu: 100m, memory: 128Mi }

applicationSet:
  replicas: 1
  resources:
    requests: { cpu: 25m, memory: 32Mi }
    limits: { cpu: 100m, memory: 128Mi }
```

Resource budget: about **250m CPU / 512Mi requests**, **1.2 CPU / 1.5Gi
limits**. Dex and the notifications controller are disabled. The
ApplicationSet controller stays installed for a future app-of-apps but is not
used yet.

`server.insecure` stays `false`; the UI remains HTTPS and ClusterIP-only.

## 5. GitOps resources

### 5.1 AppProject

```yaml
apiVersion: argoproj.io/v1alpha1
kind: AppProject
metadata:
  name: triplanner
  namespace: triplanner-agrocd
spec:
  sourceRepos:
    - https://github.com/MarcoJr1312/local_triplanner
  destinations:
    - server: https://kubernetes.default.svc
      namespace: triplanner
  clusterResourceWhitelist:
    - group: rbac.authorization.k8s.io
      kind: ClusterRole
    - group: rbac.authorization.k8s.io
      kind: ClusterRoleBinding
```

The chart creates ClusterRole/ClusterRoleBinding objects for the
kube-rbac-proxy sidecars. Everything else is namespaced.

### 5.2 Application

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: triplanner
  namespace: triplanner-agrocd
spec:
  project: triplanner
  sources:
    - repoURL: https://github.com/MarcoJr1312/local_triplanner
      targetRevision: refactor/helm
      path: helm/helm-triplanner
      helm:
        valueFiles:
          - $values/deploy/kind/triplanner-values.yaml
    - repoURL: https://github.com/MarcoJr1312/local_triplanner
      targetRevision: refactor/helm
      ref: values
  destination:
    server: https://kubernetes.default.svc
    namespace: triplanner
  syncPolicy:
    automated:
      prune: false
      selfHeal: true
    syncOptions:
      - CreateNamespace=false
      - ApplyOutOfSyncOnly=true
  revisionHistoryLimit: 5
```

The multi-source `$values` reference lets Argo CD use the existing kind overlay
without copying it into the chart. The overlay already supplies:

- `images.*.tag: kind-0.19.0` (images are preloaded into kind)
- `metrics.serviceMonitor.enabled: true` with `release: prometheus`
- `metrics.dashboards.enabled: true`
- `networkPolicy.enabled: false` (WSL2 kernel constraint)

`prune: false` is deliberate for the adoption slice: Argo CD can update and
self-heal but will not delete resources (PVCs, Secrets) until a later explicit
prune decision.

## 6. Ownership and cutover

The app is currently owned by Helm release `triplanner` revision 29. Argo CD
renders Helm directly and does not import the Helm release.

**Recommended: adopt in place.**

1. Keep the Helm release and all PVCs/data intact.
2. Create the Application with **manual sync first**.
3. Run `argocd app diff triplanner` (or inspect the UI diff) and confirm no
   destructive changes.
4. Enable automated sync / self-heal.
5. Freeze `helm upgrade`, `helm rollback` and `helm uninstall` for `triplanner`;
   Argo CD becomes the source of truth.

Why not `helm uninstall` first: it may delete the uploads/email/locations PVCs
and causes avoidable downtime. Adoption is reversible by deleting the Argo CD
Application; Helm state remains.

Argo CD adds its tracking label `argocd.argoproj.io/instance: triplanner`;
the chart's `app.kubernetes.io/instance: triplanner` selectors are untouched.

## 7. Bootstrap prerequisites

Argo CD cannot build or load images, and the chart does not create the shared
`triplanner-internal` Secret. The first cluster bootstrap still needs:

```powershell
deploy/kind/setup-cilium.ps1          # new cluster only
deploy/kind/deploy-demo.ps1           # namespace, images, internal token, app
```

or the equivalent existing scripts. After that, Argo CD takes over the app.

Monitoring (`prometheus` in `monitoring`) remains a prerequisite for the
ServiceMonitors and dashboards, as documented in `deploy/kind/README.md`.

## 8. UI access

Default, ClusterIP-only:

```powershell
kubectl -n triplanner-agrocd port-forward svc/argocd-server 8080:443
# https://localhost:8080  (self-signed certificate)
```

The initial admin password is read from the `argocd-initial-admin-secret`
Secret; it is never committed or printed by the scripts.

A future option is a Cilium Gateway host such as `argocd.localhost:9080` with
`server.insecure: true`, but that is a separate exposure/security decision and
is **out of scope** for this slice.

## 9. Verification matrix

| Check | Expected |
|---|---|
| Argo CD pods | `argocd-server`, `repo-server`, `application-controller`, `redis`, `application-set` ready |
| Application status | `Synced` / `Healthy` after the first sync |
| Diff after adoption | only Argo CD tracking metadata, no workload changes |
| Manual drift | `kubectl scale deploy triplanner-web --replicas=2` reverts to 1 via selfHeal |
| Git drift | a harmless commit to the tracked branch auto-syncs within ~3 min |
| Helm freeze | no `helm upgrade/uninstall` on `triplanner` after cutover |
| UI | port-forward HTTPS works; admin login succeeds |
| Security | UI ClusterIP-only; no admin password in Git/logs; `prune: false` |
| Rollback | delete the Application or sync a previous Git revision; app remains Helm-adoptable |

## 10. Risks

| Risk | Mitigation |
|---|---|
| Branch not pushed | Gate 1 approval, then `git push -u origin refactor/helm` |
| Argo CD and Helm both manage the app | Adopt in place, freeze Helm, document the cutover |
| Argo CD prune deletes PVCs/Secrets | `prune: false`; enable only after a separate review |
| Images `kind-0.19.0` absent on a fresh node | bootstrap builds/loads images before first sync |
| `triplanner-internal` Secret missing | create it in the bootstrap; keep it out of Git |
| Argo CD UI exposed | ClusterIP + port-forward; no Gateway in this slice |
| Argo CD resource pressure | requests/limits above; dex/notifications disabled |
| GitHub unreachable from repo-server | verify egress; public repo needs no credentials |
| Chart path/tag drift | `targetRevision: refactor/helm`; `helm lint` before push |

## 11. Out of scope

- Argo CD self-management (app-of-apps).
- Argo CD Applications for the PostgreSQL/MongoDB exporters.
- Image build/publish or registry credentials.
- Public Argo CD UI, SSO/Dex, notifications.
- Argo CD monitoring dashboards/alerts.
- Enabling `prune: true`.

## 12. Gate 1 decision

**Pending.** Approve or change:

1. **Push** `refactor/helm` to `origin` so Argo CD can read the chart.
2. **Cutover** — adopt the existing Helm release in place, `prune: false`
   (recommended), or uninstall Helm first.
3. **UI** — ClusterIP + port-forward (recommended), or add a Cilium Gateway
   host.
4. **Namespace** — `triplanner-agrocd` exactly as requested, or correct to
   `triplanner-argocd`.

No Argo CD installation, push or application cutover happens before this
approval.
