# 0011 — Frontend service (Next.js on Helm + nginx ingress)

| Field | Value |
|---|---|
| Status | **Approved; M11.2–M11.5 implemented; M11.6 acceptance in progress** |
| Cycle | Kubernetes Manifest Delivery (`bf155f51-737c-4138-a439-01d547450118`) |
| Integration branch | `refactor/helm` |
| Work branch | `refactor/helm-frontend-service` |
| Runtime | Next.js 15 standalone, Node 22, `:3000` |
| Exposure | ClusterIP Service + nginx Ingress |
| Image | `marcojr13/triplanner-web:1.3.0` |
| Chart | `helm-triplanner` 0.8.0 |
| Depends on | external API/agent for this slice |

## 1. Summary

Move the existing Next.js web app from “Compose-only” to a first-class Helm
workload. The chart gains a hardened `triplanner-web` Deployment, a ClusterIP
Service, an nginx Ingress, a ServiceAccount, probes and an optional
NetworkPolicy. The web app keeps its current server-side proxies to the API and
agent; this slice does **not** move the API, agent or platform PostgreSQL into
the chart.

The browser continues to talk only to the Next origin. The session stays
`localStorage` UUID + `x-user-id`; there is no cookie/BFF redesign.

## 2. Decisions taken (2026-11-22)

1. **Web-only Helm slice.** Add the web workload now; API/agent/platform
   PostgreSQL remain external and migrate in later slices.
2. **ClusterIP + nginx ingress.** No NodePort. The Ingress uses
   `ingressClassName: nginx`, host `triplanner.localhost` by default, path `/`.
3. **Keep `x-user-id`.** No HttpOnly cookie session in this slice.
4. **Dedicated health API.** Add `/api/health` (liveness) and `/api/ready`
   (configuration + API reachability) and use them for Helm probes and the
   container healthcheck.

## 3. Scope

### In scope

- `/api/health` and `/api/ready` route handlers, runtime env validation and
  tests.
- Docker healthcheck switched to the health API.
- Helm: `web` Deployment, Service, Ingress, ServiceAccount, probes, optional
  NetworkPolicy and a `helm test` hook.
- Values for backend/agent URLs, Ingress host/class/TLS/annotations, image tag,
  resources and probes.
- Ingress annotations for SSE (`proxy-buffering: off`, long read/send timeouts)
  and upload body size.
- Ingress-nginx prerequisite check/install and a host-reachability spike.
- Cluster acceptance through the ingress, including login, username invite,
  bell/SSE, uploads and AI suggestions.
- Documentation, port-forward/ingress runbook and chart 0.8.0.

### Out of scope

- API, agent and platform PostgreSQL Helm workloads.
- Cookie/BFF authentication or a session service.
- Splitting the Next route handlers into a separate BFF.
- Compose retirement; the one-command Compose recruiter path stays.
- Changing the product UI or API contracts.

## 4. Runtime contract

The web image is unchanged except for health/config behavior:

| Variable | Required | Purpose |
|---|---|---|
| `NEXT_PRIVATE_BACKEND_URL` | yes | API GraphQL URL, e.g. `http://host.docker.internal:4000/graphql` |
| `NEXT_PRIVATE_BACKEND_ORIGIN` | recommended | API origin for `/uploads/*`; defaults from the GraphQL URL |
| `NEXT_PRIVATE_AGENT_URL` | yes | Agent origin, e.g. `http://host.docker.internal:4100` |
| `PORT` | no | `3000` |
| `HOSTNAME` | no | `0.0.0.0` |
| `NEXT_TELEMETRY_DISABLED` | no | `1` |

The server-side proxy contract is unchanged:

| Path | Upstream |
|---|---|
| `/api/graphql` | `NEXT_PRIVATE_BACKEND_URL` (GraphQL, including SSE) |
| `/api/agent/*` | `NEXT_PRIVATE_AGENT_URL/api/agent/*` |
| `/uploads/*` | `NEXT_PRIVATE_BACKEND_ORIGIN/uploads/*` |

### 4.1 Health endpoints

- `GET /api/health` → `200 {"status":"ok"}` with no backend call. Used for
  liveness and the container healthcheck.
- `GET /api/ready` → `200 {"status":"ready","backend":"ok"}` when the required
  env is present and `GET <backend origin>/health` answers within 2 s;
  `503 {"status":"not_ready",...}` when config is missing or the API is down.
  The agent is not part of readiness; a down agent degrades AI only.

## 5. Kubernetes contract

### 5.1 Workload

- Deployment `triplanner-web`, 1 replica by default.
- Container port `http` 3000, non-root `node` (uid 1000), read-only root FS,
  `/tmp` emptyDir, dropped capabilities, seccomp `RuntimeDefault`.
- Liveness `/api/health`, readiness `/api/ready`.
- No Kubernetes API access; ServiceAccount with
  `automountServiceAccountToken: false`. No kube-rbac-proxy sidecar for the
  user-facing web.
- Optional NetworkPolicy: ingress from the ingress-nginx namespace/controller
  to 3000; egress to the API/agent host ports and DNS.
- `helm test` hook calls `/api/health` through the Service.

### 5.2 Ingress

- `networking.k8s.io/v1`, `ingressClassName: nginx`.
- Host `triplanner.localhost`, path `/`, `pathType: Prefix`.
- Backend `triplanner-web:3000`.
- Required annotations:
  - `nginx.ingress.kubernetes.io/proxy-buffering: "off"`
  - `nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"`
  - `nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"`
  - `nginx.ingress.kubernetes.io/proxy-body-size: "20m"`
- Optional TLS via `webService.ingress.tls`; HTTP by default for the local demo.

### 5.3 Values sketch

```yaml
images:
  web:
    name: marcojr13/triplanner-web
    tag: "1.3.0"
    pullPolicy: IfNotPresent

webService:
  enabled: true
  replicaCount: 1
  service:
    type: ClusterIP
    port: 3000
  backend:
    url: http://host.docker.internal:4000/graphql
    origin: http://host.docker.internal:4000
  agent:
    url: http://host.docker.internal:4100
  ingress:
    enabled: true
    className: nginx
    host: triplanner.localhost
    path: /
    annotations:
      nginx.ingress.kubernetes.io/proxy-buffering: "off"
      nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
      nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
      nginx.ingress.kubernetes.io/proxy-body-size: "20m"
    tls: []
  hostAliases: []          # optional [{ip: "192.168.65.254", hostnames: ["host.docker.internal"]}]
  serviceAccount:
    create: true
  networkPolicy:
    enabled: false
  # resources, podSecurityContext, securityContext, probes, nodeSelector...
```

Chart version 0.8.0; `appVersion` 0.5.0.

## 6. Host connectivity risk

The API and agent are still Compose/host workloads. A cluster pod must reach
them through `host.docker.internal` or a configured host alias. M11.3 proved
this with the existing ingress controller and a probe pod:

- `host.docker.internal` resolves to the Docker Desktop gateway
  (`192.168.65.254`), but the Compose API/agent ports are not published by
  default, so the gateway refuses.
- Publishing them with `deploy/docker-compose.frontend-helm.yml`
  (`0.0.0.0:4000`, `0.0.0.0:4100`) makes `host.docker.internal:4000/health` and
  `:4100/health` answer from a pod. This is the accepted transitional path.
- The overlay is not the default demo stack; only `web` is published there.
- If the host IP changes, set `webService.hostAliases`; if the overlay is not
  acceptable, stop and re-enter Gate 1 with API/agent in the Helm slice.

The API’s `APP_URL` is still `http://localhost:3000` (Compose web). Email invite
links therefore point at the Compose web until the API moves to Helm. Local
username invites and notifications work through the Helm web. For acceptance,
the Compose API can be restarted with `APP_URL=http://triplanner.localhost` to
make email links coherent; this is configuration, not a code change.

## 7. Ingress prerequisite

The cluster needs an nginx ingress controller. The Docker Desktop cluster
already has `IngressClass/nginx` (controller v1.8.1). If absent, install the
upstream chart:

```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx \
  -n ingress-nginx --create-namespace
```

Docker Desktop should publish the controller on localhost:80/443. Port conflicts
(another local server on 80) block acceptance and are recorded, not hidden.

## 8. Acceptance evidence

- `helm lint`, `helm template`, server-side dry-run.
- Web pod ready, `/api/health` and `/api/ready` pass; `helm test` passes.
- `http://triplanner.localhost` serves the app; security headers/middleware
  intact.
- Browser: English default, login `demo` / `demo123`, create account, seeded
  trip, username invite, bell/SSE accept, decline, language switch.
- Uploads render through `/uploads/*`; AI panel works through `/api/agent/*`
  (or shows a clear degraded state when the agent is down).
- Failure injection: API down → `/api/ready` 503 and web recovers; agent down →
  UI degrades without crashing; ingress SSE stays unbuffered.
- No secrets in manifests/logs/browser; non-root/read-only pod; no DB Services
  exposed.
- Rollback to chart 0.7.0 leaves the existing backend release intact.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Pod cannot reach host API/agent | M11.3 spike; `hostAliases`; otherwise Gate 1 scope change |
| ingress-nginx absent or port 80 busy | check/install in M11.3; document conflicts |
| SSE buffered by nginx | proxy-buffering off and long timeouts; live notification test |
| Next writes to read-only FS | `/tmp` emptyDir; test image optimization/uploads paths |
| Email links point at Compose web | set API `APP_URL` for acceptance; API migration later |
| Web image not on Docker Hub yet | use the local 1.3.0 image for acceptance; publish with M10.14/web CI |
| Ingress host/cert drift | host is a value; TLS optional; docs and NOTES |
| Two web frontends (Compose:3000 and ingress) | document the two URLs and keep scopes separate |

## 10. Rollout

| Stage | Name | Owner |
|---|---|---|
| M11.1 | Contract, ADR and Gate 1 — **done** | PM |
| M11.2 | Web health/readiness, env contract, Docker healthcheck and tests — **done** | Backend |
| M11.3 | Ingress prerequisite and host-connectivity spike — **done** | SRE |
| M11.4 | Helm web Deployment, Service, Ingress, SA, NetworkPolicy, chart 0.8.0 — **done** | SRE |
| M11.5 | Web image/CI alignment and ingress/runbook docs — **done** | SRE |
| M11.6 | Cluster acceptance through nginx ingress | SRE |
| M11.7 | QA matrix, failure injection and Gate 2 evidence | QA |
| M11.8 | Gate 2, release notes and tag | PM/SRE |

## 11. Exit criteria

- The chart deploys the web workload and routes it through nginx at
  `http://triplanner.localhost`.
- Login, local invite + notification/SSE, uploads and AI work through the
  ingress.
- Health/readiness and failure behavior are verified.
- The Compose one-command demo remains unchanged.
- Gate 2 decision recorded before release.
