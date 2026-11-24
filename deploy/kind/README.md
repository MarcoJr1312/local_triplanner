# Cilium Gateway kind cluster

This directory creates an isolated kind cluster for the chart's
**Cilium Gateway API** path. It does not modify the Docker Desktop Kubernetes
cluster or its ingress-nginx installation.

## What it creates

- A single-node kind cluster named `triplanner-cilium` with kindnet disabled
  and kube-proxy set to `none`.
- Gateway API `v1.6.3` CRDs.
- Cilium `1.20.5` with kube-proxy replacement and Gateway API enabled.
- Cilium Gateway host-network mode on port `9080` (kind maps it to Windows).
- The API facade with its platform PostgreSQL and uploads PVC, all in-cluster.

The chart creates a `Gateway` (`gatewayClassName: cilium`) and an `HTTPRoute`
for `http://triplanner.localhost:9080`.

## Prerequisites

- Docker Desktop with at least 8 GB available.
- `kind`, `kubectl` and `helm`.
- Local images built:

  ```powershell
  docker compose -f deploy/docker-compose.yml build
  ```

The Cilium demo is self-contained; the Compose API/agent are not needed for it.

## Setup

```powershell
# Windows
powershell -ExecutionPolicy Bypass -File deploy/kind/setup-cilium.ps1
powershell -ExecutionPolicy Bypass -File deploy/kind/deploy-demo.ps1
```

```bash
# macOS / Linux
deploy/kind/setup-cilium.sh
deploy/kind/deploy-demo.sh
```

Open **http://triplanner.localhost:9080** and sign in with `demo` / `demo123`.

## Verify

```powershell
kubectl --context kind-triplanner-cilium -n triplanner get gateway,httproute
kubectl --context kind-triplanner-cilium -n triplanner get pods

curl.exe -H "Host: triplanner.localhost" http://127.0.0.1:9080/api/health
curl.exe -H "Host: triplanner.localhost" http://127.0.0.1:9080/api/ready
```

`/api/ready` should report `{"status":"ready","backend":"ok"}`. The
`HTTPRoute` should show `Accepted=True` and `ResolvedRefs=True`.

## Notes

- **cgroup v1:** Docker Desktop currently reports cgroup v1. The kind node
  image is pinned to `kindest/node:v1.34.0`, which works with this Docker
  Desktop version. The warning is expected; a future kind release may require
  cgroup v2.
- **No LoadBalancer:** the Gateway uses Cilium host-network mode on port 9080;
  kind maps it to Windows. There is no TLS and no external IP.
- **In-cluster API:** the chart deploys `triplanner-api`, its platform
  PostgreSQL, and the uploads PVC. The web and agent use
  `http://triplanner-api:4000`; no Compose API or host proxy is needed.
- **Compose demo is separate:** `deploy/docker-compose.yml` still runs its own
  API/agent/Postgres for the recruiter Compose quickstart.
- **Port 9080:** avoids the broker port-forward on 8080.
- **NetworkPolicy:** the chart's policies are CiliumNetworkPolicy resources.
  Docker Desktop's WSL2 kind kernel lacks `xt_socket`, which Cilium's DNS proxy
  needs for `toFQDNs`; the local values therefore keep `networkPolicy.enabled`
  false. Enable it on a kernel-compatible Cilium cluster and set
  `networkPolicy.probeCIDRs` to the node/cilium_host addresses.
- **Current cluster untouched:** ingress-nginx on `docker-desktop` remains for
  the old Helm release; the new chart does not use it.

## Cleanup

```powershell
helm --kube-context kind-triplanner-cilium -n triplanner uninstall triplanner
kind delete cluster --name triplanner-cilium
```
