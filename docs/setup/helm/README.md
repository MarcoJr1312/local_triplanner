# Helm setup (kind + Cilium)

Run Triplanner on a local Kubernetes cluster. The chart deploys all eight
application services and their databases, and exposes the web through a Cilium
Gateway at [http://triplanner.localhost:9080](http://triplanner.localhost:9080).

This is the advanced local path. For the one-command recruiter demo, use
[Docker Compose](../docker-compose/README.md) instead.

[← Back to the main README](../../../README.md)

## What gets installed

- The `triplanner` namespace with web, API, users, trips, locations, agent,
  broker and email workloads.
- PostgreSQL 17 databases for the API, users, trips and agent (pgvector), plus a
  single-node MongoDB for the Toronto catalogue.
- A Cilium `Gateway` and `HTTPRoute` for the web; all other Services are
  ClusterIP-only.
- Optional: kube-prometheus-stack (Prometheus, Grafana, 13 scrape targets and
  11 dashboards) and Argo CD for GitOps.

## Prerequisites

- **Docker Desktop** with at least **8 GB** memory available.
- **Git**.
- `kind`, `kubectl` and `helm` on `PATH`.
- Windows: PowerShell 5.1+ for the `.ps1` scripts. macOS/Linux: bash for the
  `.sh` scripts.
- Free host ports **9080** (web), **8080** (Argo CD UI port-forward) and
  **3001** (Grafana port-forward).

The scripts create an isolated kind cluster named `triplanner-cilium`. They do
not modify the Docker Desktop Kubernetes cluster or its ingress-nginx install.

## Option 1 — Helm with local source images

This path builds the images locally, loads them into kind and installs the
chart. It is the closest local equivalent of a release candidate build.

### 1. Clone and build

```bash
git clone https://github.com/MarcoJr1312/local_triplanner.git
cd local_triplanner

# All application images, including the Go broker.
docker compose -f deploy/docker-compose.yml build

# The email consumer is not a Compose service; build it explicitly.
docker build -f backend/email-service/Dockerfile -t local_triplanner-email:latest .
```

### 2. Create the cluster and Cilium

```powershell
# Windows
powershell -ExecutionPolicy Bypass -File deploy/kind/setup-cilium.ps1
```

```bash
# macOS / Linux
bash deploy/kind/setup-cilium.sh
```

The script installs the Gateway API CRDs, Cilium 1.20.5, waits for the node and
adds the pod-egress masquerade rule used by Docker Desktop WSL2.

### 3. Install monitoring

The local kind values enable ServiceMonitors and dashboards, so install
kube-prometheus-stack before the chart:

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update

helm upgrade --install prometheus prometheus-community/kube-prometheus-stack \
  --kube-context kind-triplanner-cilium \
  --namespace monitoring \
  --create-namespace \
  --version 93.11.0 \
  --wait --timeout 15m
```

### 4. Deploy the chart

```powershell
# Windows
powershell -ExecutionPolicy Bypass -File deploy/kind/deploy-demo.ps1
```

```bash
# macOS / Linux
bash deploy/kind/deploy-demo.sh
```

The script tags the local images, loads them into kind, creates the namespace
and the `triplanner-internal` Secret, then runs `helm upgrade --install` with
`deploy/kind/triplanner-values.yaml` and
`deploy/kind/triplanner-local-images.yaml`.

Open [http://triplanner.localhost:9080](http://triplanner.localhost:9080) and
sign in with `demo` / `demo123`.

## Option 2 — Argo CD GitOps with published images

Argo CD watches this repository at `HEAD` and keeps the chart synced. The chart
defaults point at the published `sha-*` images, so this path does not need a
local image build.

Use a fresh `triplanner-cilium` cluster: do not run `deploy-demo` first, because
Argo CD must own the `triplanner` release.

### 1. Prepare the cluster

```powershell
powershell -ExecutionPolicy Bypass -File deploy/kind/setup-cilium.ps1
```

Install kube-prometheus-stack as in Option 1 step 3. The Argo CD Application
uses `deploy/kind/triplanner-values.yaml`, which enables ServiceMonitors and
dashboards.

### 2. Create the namespace and internal secret

```bash
kubectl --context kind-triplanner-cilium create namespace triplanner

# macOS / Linux
kubectl --context kind-triplanner-cilium -n triplanner create secret generic \
  triplanner-internal \
  --from-literal=INTERNAL_TOKEN="$(openssl rand -hex 32)"
```

Windows PowerShell:

```powershell
kubectl --context kind-triplanner-cilium create namespace triplanner
$token = -join ((48..57) + (97..102) | Get-Random -Count 64 | ForEach-Object { [char]$_ })
kubectl --context kind-triplanner-cilium -n triplanner create secret generic `
  triplanner-internal --from-literal=INTERNAL_TOKEN=$token
```

### 3. Install Argo CD

```bash
helm repo add argo https://argoproj.github.io/argo-helm
helm repo update

helm upgrade --install argocd argo/argo-cd \
  --version 10.20.0 \
  --kube-context kind-triplanner-cilium \
  --namespace triplanner-agrocd \
  --create-namespace \
  --values deploy/argocd/values.yaml \
  --wait --timeout 10m

kubectl --context kind-triplanner-cilium apply \
  -f deploy/argocd/project.yaml \
  -f deploy/argocd/application.yaml
```

Argo CD syncs `helm/helm-triplanner` from
`https://github.com/MarcoJr1312/local_triplanner` with automated sync and
`selfHeal: true`. For a fork, update the `repoURL` values in
`deploy/argocd/application.yaml` and `project.yaml` first.

### 4. Wait for the sync

```bash
kubectl --context kind-triplanner-cilium -n triplanner-agrocd \
  get application triplanner -w
```

Wait for `SYNC STATUS: Synced` and `HEALTH STATUS: Healthy`. Then open
[http://triplanner.localhost:9080](http://triplanner.localhost:9080).

## Verify

```bash
kubectl --context kind-triplanner-cilium -n triplanner get pods
kubectl --context kind-triplanner-cilium -n triplanner get gateway,httproute
helm --kube-context kind-triplanner-cilium -n triplanner test triplanner

curl -H "Host: triplanner.localhost" http://127.0.0.1:9080/api/health
curl -H "Host: triplanner.localhost" http://127.0.0.1:9080/api/ready
```

`/api/ready` should return `{"status":"ready","backend":"ok"}`, and the
`HTTPRoute` should report `Accepted=True` and `ResolvedRefs=True`.

## Monitoring

Open Grafana:

```bash
kubectl --context kind-triplanner-cilium -n monitoring \
  port-forward svc/prometheus-grafana 3001:80
# http://localhost:3001
```

Read the admin password:

```powershell
kubectl --context kind-triplanner-cilium -n monitoring get secret prometheus-grafana `
  -o jsonpath="{.data.admin-password}" |
  %{ [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($_)) }
```

```bash
kubectl --context kind-triplanner-cilium -n monitoring get secret prometheus-grafana \
  -o jsonpath='{.data.admin-password}' | base64 -d; echo
```

The local stack scrapes **13 targets** (8 runtimes plus 4 PostgreSQL exporters
and 1 MongoDB exporter) and provisions **11 dashboards**. Check the metrics
endpoints:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/metrics-smoke.ps1 -Target helm
```

```bash
bash scripts/metrics-smoke.sh --target helm
```

## Argo CD UI

```bash
kubectl --context kind-triplanner-cilium -n triplanner-agrocd \
  port-forward svc/argocd-server 8080:443
# https://localhost:8080 (self-signed certificate)
```

The initial admin password:

```powershell
kubectl --context kind-triplanner-cilium -n triplanner-agrocd get secret argocd-initial-admin-secret `
  -o jsonpath="{.data.password}" |
  %{ [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($_)) }
```

```bash
kubectl --context kind-triplanner-cilium -n triplanner-agrocd get secret argocd-initial-admin-secret \
  -o jsonpath='{.data.password}' | base64 -d; echo
```

Argo CD owns the `triplanner` release after the first sync. Do not run
`helm upgrade`, `helm rollback` or `helm uninstall` for it; make changes through
Git. See [`deploy/argocd/README.md`](../../../deploy/argocd/README.md) for
rollback and operating rules.

## Troubleshooting

- **`triplanner.localhost` does not resolve** — add
  `127.0.0.1 triplanner.localhost` to your hosts file, or test with
  `curl -H "Host: triplanner.localhost" http://127.0.0.1:9080`.
- **Docker Desktop restarted or the node IP changed** — re-run
  `deploy/kind/setup-cilium.ps1` / `.sh` (or `deploy-demo`), then delete stale
  `Unknown` pods. PVC-backed data is preserved.
- **Argo CD cannot reach GitHub** — the repo-server needs pod egress. Re-run
  `deploy/kind/deploy-demo.ps1` or `setup-cilium.ps1` to restore the masquerade
  rule.
- **Argo CD sync fails on ServiceMonitor** — install kube-prometheus-stack
  first, or set `metrics.serviceMonitor.enabled=false` in a values overlay.
- **Port 9080 is busy** — stop the process using it before recreating the
  cluster.

More detail: [Cilium kind guide](../../../deploy/kind/README.md),
[chart README](../../../helm/helm-triplanner/README.md),
[Troubleshooting](../../TROUBLESHOOTING.md).

macOS clean-clone QA is still pending; the bash scripts are provided, but the
accepted evidence so far is from Windows and Docker Desktop.

## Cleanup

```bash
kind delete cluster --name triplanner-cilium
```

This removes the kind cluster, the Triplanner workloads, Argo CD and the local
monitoring stack. It does not touch the separate Docker Desktop Kubernetes
cluster or Compose volumes.
