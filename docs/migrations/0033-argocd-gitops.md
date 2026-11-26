# 0033 — Argo CD GitOps

> **Update 2026-11-26:** broker/email now have publish workflows; all eight
> services use published SHA tags (six `sha-e377c12`, broker/email
> `sha-714d97a`). See
> [`0036-broker-email-ci.md`](./0036-broker-email-ci.md). The image table below
> records the pre-broker/email-CI adoption snapshot.

| Field | Value |
|---|---|
| Status | **Gate 2 approved locally (2026-11-26); release deferred** |
| Cycle | Kubernetes Manifest Delivery |
| Slice | M28 — Argo CD and GitOps |
| Argo CD chart | `argo/argo-cd` 10.20.0 (app v3.6.3) |
| Argo CD release | `argocd` revision 3, namespace `triplanner-agrocd` |
| Application | `triplanner` — **Synced / Healthy** |
| Git source | `https://github.com/MarcoJr1312/local_triplanner` |
| Git revision | **`HEAD`** (default branch `main`) at `e377c12` |
| Chart path | `helm/helm-triplanner` |
| Image SHA | `sha-5247619` (image build commit) |
| Triplanner chart | 0.21.0, Helm release still at revision 29 (frozen) |

## 1. Result

Argo CD is installed in `triplanner-agrocd` and owns the Triplanner
application in `triplanner`:

- Repo server, application controller, server, Redis and ApplicationSet
  controller are all Ready.
- The UI is ClusterIP-only; `kubectl port-forward svc/argocd-server 8080:443`
  returns HTTP 200 with a self-signed certificate.
- Application `triplanner` uses a multi-source Helm definition:
  - chart `helm/helm-triplanner` at `HEAD`;
  - values `$values/deploy/kind/triplanner-values.yaml`.
- Automated sync is on with `selfHeal: true` and `prune: false`.
- The existing Helm release `triplanner` revision 29 was adopted in place; no
  PVCs or database data were deleted. Helm upgrades are frozen for this
  release.

## 2. Image traceability

The kind values now pin all eight application images to the image build SHA:

```yaml
images:
  web:
    tag: sha-5247619
```

The images were tagged and loaded into the kind node with the same value. All
eight running pods report `triplanner-local/<service>:sha-5247619`:

```text
triplanner-web-...        triplanner-local/web:sha-5247619
triplanner-api-...        triplanner-local/api:sha-5247619
triplanner-users-...      triplanner-local/users:sha-5247619
triplanner-trips-...      triplanner-local/trips:sha-5247619
triplanner-locations-...  triplanner-local/locations:sha-5247619
triplanner-agent-...      triplanner-local/agent:sha-5247619
triplanner-email-...      triplanner-local/email:sha-5247619
triplanner-kafka-...      triplanner-local/kafka:sha-5247619
```

The chart source revision `593e29b` is newer than the image build SHA because
the last commits only changed docs, Argo CD manifests and the kind scripts.
`deploy/kind/triplanner-values.yaml` is the source of truth for the image tag;
update it when new service images are built.

## 3. Auto-sync and self-heal

**Git sync:** pushing `593e29b` changed the image tags to `sha-5247619`. Argo CD
reconciled the Application to `593e29b` and rolled all eight Deployments to the
new image; the live app stayed healthy.

**Drift test:**

```text
before:  Deployment/triplanner-web spec.replicas = 1
manual:  kubectl scale deployment triplanner-web --replicas=2
immediate spec.replicas = 2
after 8s spec.replicas = 1
```

The Application `operationState` recorded:

```text
initiatedBy.automated: true
sync.autoHealAttemptsCount: 3
message: successfully synced (all tasks run)
resource: Deployment/triplanner-web configured
image: triplanner-local/web:sha-5247619
```

## 4. Cluster egress workaround

The Argo CD repo-server initially could not reach GitHub. The node could reach
GitHub, but Cilium’s `CILIUM_POST_nat` chain was empty on the Docker Desktop
WSL2 kernel, so pod egress was not masqueraded.

- A direct `MASQUERADE` rule for `10.244.0.0/24` restored pod egress.
- Enabling Cilium BPF masquerade fixed NAT but broke CoreDNS egress to Docker
  Desktop’s DNS (`192.168.65.254`), so it was reverted.
- `deploy/kind/setup-cilium.ps1/.sh` and `deploy-demo.ps1/.sh` now install the
  idempotent direct rule. Re-run `deploy-demo` after a Docker Desktop restart
  if the repo-server reports `context deadline exceeded`.

## 5. Verification

| Check | Result |
|---|---|
| Argo CD pods | 5/5 Ready |
| Application | **Synced / Healthy** |
| Git revision | `593e29b` |
| Image tags | 8/8 `sha-5247619` |
| Live app | `/api/health` ok, `/api/ready` ok |
| Grafana dashboards | 11 |
| Prometheus targets | 13/13 |
| UI | HTTPS 200 via port-forward, ClusterIP only |
| Self-heal | 2 → 1 replicas in 8 s |
| Secrets | admin secret not printed; no secrets committed |
| Helm | `triplanner` release 29 preserved and frozen |

## 6. Security and operational notes

- AppProject `triplanner` restricts sources to the GitHub repo and destinations
  to the `triplanner` namespace; ClusterRole/ClusterRoleBinding are the only
  allowed cluster-scoped kinds.
- `prune: false` protects PVCs, Secrets and other stateful resources.
- The Argo CD chart NetworkPolicies are disabled because the WSL2 kernel does
  not allow kubelet probes through the repo-server policy. The Argo CD UI
  remains ClusterIP-only.
- Dex, notifications and public exposure are disabled.
- Argo CD is installed by Helm, not self-managed yet.
- The PostgreSQL/MongoDB exporters remain separate releases and are not yet
  Argo CD Applications.

## 7. Rollout and rollback

Install/upgrade Argo CD:

```powershell
helm upgrade --install argocd argo/argo-cd --version 10.20.0 `
  --kube-context kind-triplanner-cilium -n triplanner-agrocd `
  --create-namespace -f deploy/argocd/values.yaml --wait
```

Apply the project and app:

```powershell
kubectl --context kind-triplanner-cilium apply `
  -f deploy/argocd/project.yaml -f deploy/argocd/application.yaml
```

Rollback the app through Git (revert the commit) or Argo CD history. Deleting
the Application does not delete the namespace resources by default; `prune` is
off. Do not run `helm upgrade/uninstall` for `triplanner`.

## 8. Residual risks

| Risk | Mitigation |
|---|---|
| Pod egress depends on a WSL2 NAT workaround | Setup/deploy scripts apply it; documented; re-run after Docker restart |
| Argo CD is not self-managed | Future app-of-apps |
| Exporters are not Argo CD Applications | Separate follow-up |
| Image SHA tag is local-only | Publish `sha-*` images from CI before a fresh-cluster GitOps bootstrap |
| Argo CD chart NetworkPolicies disabled | Local WSL2 probe limitation; UI ClusterIP-only |

## 9. Gate 2 decision

**Approved locally on 2026-11-26: accept M28 and hold the release.** The
automatic `workflow_run` residual is accepted; no release tag was created.
