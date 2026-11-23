# 0012 - Frontend service QA and Gate 2 evidence

| Field | Value |
|---|---|
| Date | 2026-11-22 (17:05-17:25 EST) |
| Slice | M11 frontend Helm + nginx ingress (M11.2-M11.7) |
| Branch | `refactor/helm-frontend-service` |
| HEAD | `80f25f4` (feat(helm): deploy the web frontend behind nginx ingress) |
| Contract | `0011-frontend-service.md` |
| Cycle | Kubernetes Manifest Delivery |
| Environment | Docker Desktop Kubernetes v1.34.11, namespace `triplanner`, chart `helm-triplanner` 0.8.0, release revision 24 -> 25 (rollback) -> 26 (deployed) |
| Result | **APPROVE WITH CONDITIONS** - no P1/P2; one failure-path expectation mismatch (RISK-1) and documentation defects need an explicit human decision (section 8) |

## 1. Environment and images

| Item | Observed |
|---|---|
| Kubernetes | docker-desktop context, node `desktop-control-plane`, `v1.34.11`, containerd 2.3.4 |
| Ingress controller | `ingress-nginx` namespace, `registry.k8s.io/ingress-nginx/controller:v1.8.1`, `IngressClass/nginx` |
| Controller exposure | Service `ingress-nginx-controller` type **LoadBalancer**, EXTERNAL-IP `172.19.0.2`, ports `80:32746`, `443:32179`; Docker Desktop publishes host `:80/:443` |
| Helm | v4.3.2, release `triplanner`, chart `helm-triplanner-0.8.0`, appVersion 0.5.0 |
| Revisions | 24 = 0.8.0 (start state), 25 = rollback to 23 (0.7.0), **26 = 0.8.0 deployed** (re-upgrade after rollback; content identical to 24) |
| Release overrides | `images.trips.tag=0.1.1-dev1`, `images.users.tag=0.1.0-dev2` |
| Web image | `marcojr13/triplanner-web:1.3.0`, digest `sha256:f9e2391bb7c0ca6909d8ae00d99ead05bc73f24ac1c1665bc3a5ca41bc26aa57` (local build; **not** on Docker Hub) |
| Other images | users 0.1.0-dev2, trips 0.1.1-dev1, locations 0.2.1, email 0.1.1, broker 0.1.0, MongoDB 7, PostgreSQL 17 |
| Web workload | `triplanner-web` Deployment 1/1, pod ready, 0 restarts through the whole run; ClusterIP 10.96.211.153:3000 |
| Ingress | `triplanner-web`, class `nginx`, host `triplanner.localhost`, path `/` Prefix, backend `triplanner-web:3000`, ADDRESS `172.19.0.2` |
| Compose stack | project `local_triplanner`: web `0.0.0.0:3000`, api `0.0.0.0:4000`, agent `0.0.0.0:4100` (transition overlay), locations/trips/users plus postgres, trips-postgres, users-postgres, mongo |
| Compose web image | `sha256:732cefd2...` - a local build **older than M11.2** (no `/api/health`); see D-09 |
| Host resolution | Windows resolver does not resolve `triplanner.localhost`; Chrome resolves `*.localhost` to loopback, so the browser path works without a hosts entry. CLI checks used `curl -H "Host: triplanner.localhost" http://127.0.0.1/...` (as documented in the chart README/NOTES) |

## 2. Automated suites and static checks

| Suite | Command | Result |
|---|---|---|
| Chart lint | `helm lint helm/helm-triplanner` | 1 chart linted, 0 failed (INFO: icon recommended) |
| Chart render | `helm template triplanner helm/helm-triplanner -n triplanner --set ...` | exit 0, 51 objects |
| Namespace rule | parse of the rendered output | 51/51 namespaced objects set `metadata.namespace: triplanner`; the 10 cluster-scoped objects (5 ClusterRole, 5 ClusterRoleBinding) omit it |
| Server dry-run | `helm upgrade ... --dry-run=server` | exit 0, `STATUS: pending-upgrade` |
| Helm tests | `helm test triplanner -n triplanner --logs` | **5/5 Succeeded** (email, locations, trips, users, web); web hook `wget http://triplanner-web:3000/api/health` -> `{"status":"ok"}` |
| Frontend tests | `cd frontend-next && bun test` | **30 pass / 0 fail**, 6 files, 79 expects |
| Frontend typecheck | `cd frontend-next && bunx tsc --noEmit` | pass |
| CI | `.github/workflows/web.yml` | install + `bun audit` + `tsc --noEmit` + `bun test`; image build/publish only on `main`/tags |

## 3. Verification matrix

Legend: P = pass, F = fail, B = blocked/not testable in this session. Every row was run against the live cluster and ingress (`http://triplanner.localhost`, resolved with the `Host` header).

### 3.1 Helm and cluster contract (chart 0.8.0)

| ID | Criterion | Method | Result | Evidence |
|---|---|---|---|---|
| H1 | Web Deployment ready with the contract image | `kubectl get deploy/pod` | P | `triplanner-web` 1/1; image `marcojr13/triplanner-web:1.3.0`; 0 restarts |
| H2 | Service ClusterIP only, port 3000 | `kubectl get svc triplanner-web -o wide` | P | `ClusterIP`, `10.96.211.153`, `3000/TCP`; no nodePort/externalIP |
| H3 | Ingress class/host/path/backend | `kubectl get ingress -o yaml` | P | `ingressClassName: nginx`, host `triplanner.localhost`, path `/` Prefix -> `triplanner-web:3000`; `status.loadBalancer` `172.19.0.2` |
| H4 | Required SSE/timeout/body annotations | live + rendered | P | `proxy-buffering: "off"`, `proxy-read-timeout: "3600"`, `proxy-send-timeout: "3600"`, `proxy-body-size: "20m"` (+ shipped `proxy-http-version: "1.1"`, `ssl-redirect: "false"`) |
| H5 | ServiceAccount without kube API access | `kubectl auth can-i --list --as=system:serviceaccount:triplanner:triplanner-helm-triplanner-web` + token dir check | P | only `selfsubject*reviews` + discovery URLs; `/var/run/secrets/kubernetes.io/serviceaccount` absent; `automountServiceAccountToken: false` on SA and pod |
| H6 | Non-root, read-only root FS, dropped caps, seccomp | live pod spec + `kubectl exec id` | P | `runAsNonRoot/runAsUser 1000/runAsGroup 1000/fsGroup 1000`, `seccompProfile: RuntimeDefault`; container `allowPrivilegeEscalation: false`, `readOnlyRootFilesystem: true`, `capabilities.drop: [ALL]`; `id` -> `uid=1000(node) gid=1000(node)` |
| H7 | Writable paths are volumes only | `exec touch` | P | `/app/probe` -> `Read-only file system`; `/tmp` writable (`emptyDir`), `/app/.next/cache` `emptyDir` |
| H8 | Probes and resources | live spec | P | liveness `/api/health` (10 s/3), readiness `/api/ready` (5 s/3); requests 100m/256Mi, limits 500m/512Mi |
| H9 | No kube-rbac-proxy sidecar on web | pod containers | P | single container `web` |
| H10 | `helm test` hook through the Service | `helm test` | P | 5/5 Succeeded (web hook 200 from `triplanner-web:3000`) |
| H11 | No NodePort/LoadBalancer/DB exposure in the chart | rendered services | P | 9/9 Services ClusterIP or headless; no `NodePort`/`LoadBalancer` in the chart; only the ingress controller (outside the chart) is a LoadBalancer |
| H12 | Rollout/rollback safety | see 3.7 | P | rollback + re-upgrade left every backend pod untouched |

### 3.2 Health and failure injection

| ID | Criterion | Method | Result | Evidence |
|---|---|---|---|---|
| F1 | `/api/health` 200 through ingress | `curl -H "Host: ..." http://127.0.0.1/api/health` | P | `200 {"status":"ok"}` |
| F2 | `/api/ready` 200 through ingress and inside the pod | curl + `exec node -e fetch` | P | `200 {"status":"ready","backend":"ok"}` both ways |
| F3 | API stopped -> `/api/ready` 503, no hang | `docker stop local_triplanner-api` | P | ready 503 in 0.2 s (`{"status":"not_ready","backend":"down"}`); GraphQL POST 502 in 0.013 s; no hanging request |
| F4 | Web liveness stays healthy while the API is down | pod-internal probe + kubelet events | P | container `/api/health` still `200 {"status":"ok"}`; only readiness events (`Readiness probe failed: 503`); 0 restarts |
| F5 | Ingress keeps serving `/login` while the API is down | 16-sample poll every 2 s | **F** | `/login` 200 for ~12 s, then **503** once the pod is removed from endpoints (D-01 / RISK-1) |
| F6 | Recovery after API restart | `docker start` + poll | P | ready 200 after 2.1 s (earlier run 6.7 s); pod Ready automatically; 0 restarts |
| F7 | Web pod restart recovers through the ingress | `kubectl delete pod` | P | new pod Ready ~2.4 s; `/login` 200 at ~7.1 s; ready 200 |
| F8 | Agent down is not a readiness failure | `docker stop local_triplanner-agent` | P | `/api/ready` stays 200; `/api/agent/config` 502 `AGENT_UNREACHABLE` |
| F9 | Recovery after agent restart | `docker start` + poll + UI retry | P | config 200; suggestions render again |

### 3.3 Product UI through the ingress

Two isolated Chrome contexts, live subscription open before the invite; every step through `http://triplanner.localhost`. Run twice: at revision 24 and again at revision 26 (after the rollback cycle) - both 21/21.

| ID | Criterion | Result | Evidence |
|---|---|---|---|
| U1 | English default | P | `/login` `html lang="en"`, English copy; dashboard "My trips" |
| U2 | `demo` / `demo123` login and one-click demo buttons | P | owner and demo-friend buttons both land on `/`; demo-friend correctly does not see the demo trip |
| U3 | Create account through the UI | P | new user created, auto-signed in, dashboard rendered |
| U4 | Seeded trip | P | "Fin de semana en Toronto" visible; 9 items across sight/food/activity/nightlife |
| U5 | Username invite | P | Invite -> By username -> "Invitation sent to @..." |
| U6 | **Live** `onNotification` SSE (no reload) | P | badge `1` appeared with **no navigation** (frame-navigation count unchanged); recipient page untouched between login and invite |
| U7 | Accept invitation | P | Accept -> `/trip/demo-trip` -> items render (CN Tower) |
| U8 | Decline invitation | P | second guest receives live badge, Decline -> status "Declined", no Accept button, trip absent from the dashboard |
| U9 | es/en switch | P | Settings -> Español -> Save -> `html lang="es"`, Spanish UI; persists across reload; back to English |
| U10 | Deep links | P | `/trip/demo-trip`, `/calendar`, `/search`, `/settings` 200 with chrome; unauthenticated `/trip/demo-trip` -> `/login` |
| U11 | Logout and login again | P | Sign out -> `/login`; password login -> dashboard |
| U12 | Membership gate | P | demo-friend `getTrip("demo-trip")` -> `NOT_TRIP_MEMBER`; UI invariant holds |
| U13 | SSE is not buffered by nginx | P | raw subscription: `200`, `content-type: text/event-stream`, `cache-control: no-cache, no-transform`; `onNotification` event arrived immediately after the invite mutation |

### 3.4 Uploads and attachment security

| ID | Criterion | Result | Evidence |
|---|---|---|---|
| A1 | Attach a file through the UI and render it | P | 1x1 PNG uploaded from the item drawer; rendered from `/uploads/...` with `naturalWidth=1` |
| A2 | `/uploads/*` through the ingress | P | `200 image/png` for the signed path |
| A3 | Multi-MB body through the ingress (20 m limit) | P | 8 MB PDF attached from the UI (`8388608 bytes`) - would fail on nginx's 1 m default |
| A4 | Body-size boundary | P | 19923125-byte GraphQL POST -> 200 (reached the app); 26214581-byte POST -> `413 Request Entity Too Large` from nginx |
| A5 | Signed URL is the bearer | P | URL without a session -> 200, 8388608 bytes; tampered `sig` -> 403; replayed `exp`-1 h -> 403 |
| A6 | Attachment cleanup | P | both QA attachments removed; demo trip back to 0 attachments |

### 3.5 Agent through the ingress

| ID | Criterion | Result | Evidence |
|---|---|---|---|
| G1 | `/api/agent/config` | P | `200 {"provider":"none","model":"","baseUrl":"","hasKey":false,"demo":true}` |
| G2 | Auto-suggest with the demo provider | P | `200`, 3 items (RASA, Lucie, SIMONA), `hasMore: true` |
| G3 | AI panel in the UI | P | `AI suggestions` modal opens; suggestions list renders |
| G4 | Agent down -> clear degradation, no crash | P | toast "El agente no está disponible.", page still navigable; `/api/ready` 200; single 502 console line |
| G5 | Zero keys | P | LLM `none` + demo, email `sink` with `hasKey:false`, locations `preloaded` (187 places, from the helm test log) |

### 3.6 Security

| ID | Criterion | Result | Evidence |
|---|---|---|---|
| S1 | No cookies, no token in storage or URL | P | 0 cookies; localStorage only `triplanner.local.session` (userId/username/displayName/language) and `triplanner.locale.v2`; no token/api key; URL clean |
| S2 | Demo identity model unchanged | P | browser sends `x-user-id: <fixed uuid>`; no JWT/cookie claims; API falls back to the demo UUID when the header is absent (documented demo model) |
| S3 | Security headers | P | `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Powered-By: Next.js`; no CSP (unchanged by this slice) |
| S4 | No secrets in web manifests/logs | P | web Deployment has URL-only env; web pod logs contain no secret-like strings; `INTERNAL_TOKEN` only via the required `triplanner-internal` Secret |
| S5 | No secret in the bundle | P | served HTML/localStorage/console show no keys; `/api/agent/config` exposes no key (`hasKey:false`) |
| S6 | Non-root/read-only/no kube API | P | see H5/H6 |
| S7 | DB and internal ports not published | P | all chart Services ClusterIP/headless; only the ingress controller is published on the host |
| S8 | Internal auth rejection | B | N/A for this slice: the web has no internal-token path (API/agent own it; covered by 0007/0010) |

### 3.7 Rollback

| ID | Criterion | Result | Evidence |
|---|---|---|---|
| R1 | `helm history` recorded | P | 23 (0.7.0) -> 24 (0.8.0) -> 25 (rollback to 23) -> 26 (0.8.0) |
| R2 | Rollback to revision 23 removes only the web slice | P | Deployment/Service/Ingress/SA `triplanner-web` -> `NotFound`; ingress `triplanner.localhost` -> 404 from nginx |
| R3 | Backend workloads unaffected | P | all 8 backend pods kept the **same pod UID and start time** (email 03:06, kafka 05:01, locations 21st, mongo 21st, trips 05:18, trips-pg 02:39, users 05:49, users-pg 04:23); all deployments 1/1 |
| R4 | Re-upgrade restores the slice | P | revision 26, `rollout status` OK, web 1/1, `/login` 200, `/api/health` 200, `/api/ready` 200; backend pod UIDs unchanged |
| R5 | No data loss from the rollback cycle | P | demo trip still 9 items, 1 member; users demo/demo-friend intact; 0 QA leftovers |

### 3.8 Documentation and CI

| ID | Criterion | Result | Evidence |
|---|---|---|---|
| D1 | Chart README/NOTES describe web, ingress, probes, runbook | P | `templates/web/*` listed; prerequisites, values, overlay, `curl -H "Host: ..."`, verify steps present |
| D2 | Root README describes the Helm web URL and the transition overlay | P | "The Helm web is at `http://triplanner.localhost` ... publish their ports with `deploy/docker-compose.frontend-helm.yml`" |
| D3 | Contract matches the shipped manifests | **F (partial)** | shipped annotations `proxy-http-version`/`ssl-redirect` missing from 5.2/5.3; `0011` status line still "M11.6 acceptance in progress" (D-06) |
| D4 | Chart README image prerequisites are true | **F** | README says web `1.3.0` is published; Docker Hub returns **404** for the tag (D-03) |
| D5 | CI runs the web tests | P | `web.yml`: `tsc --noEmit` + `bun test` (30/30 locally); no PR image build (D-08) |
| D6 | Migration index | **F** | `docs/migrations/README.md` stops at 0007 (D-05) |

### 3.9 Compose regression

| ID | Criterion | Result | Evidence |
|---|---|---|---|
| C1 | Default Compose stack untouched by this slice | P | `git diff <merge-base refactor/helm HEAD> -- deploy/docker-compose.yml` -> empty; only the new `deploy/docker-compose.frontend-helm.yml` was added |
| C2 | `http://localhost:3000` still works | P | `/login` 200; `demo`/`demo123` login; seeded trip visible; English default |
| C3 | Current source image works in the Compose network | P | `marcojr13/triplanner-web:1.3.0` run on `local_triplanner_default` with the Compose env -> `/api/health` 200, `/api/ready` 200, `/login` 200 |
| C4 | The committed transition overlay is equivalent | P | `docker compose -f docker-compose.yml -f docker-compose.frontend-helm.yml -f docker-compose.local-cluster.yml config` publishes api `0.0.0.0:4000` and agent `0.0.0.0:4100` and keeps only web published otherwise |

## 4. Data and cleanup

- Demo trip after QA: 1 member (`demo`, owner), 9 seeded items, 0 attachments; demo profile language `en`.
- Users: `demo`, `demo-friend`, `marco` (pre-existing). QA guests (`qa-a-*`, `qa-b-*`) and their memberships were deleted; the extra invite was declined.
- No orphan notifications, memberships or attachments left; no test hook pods left in the namespace.
- Backend restarts shown in `kubectl get pods` happened at ~16:59, before this QA run (cluster/control-plane restart), not during it; the web pod shows 0 restarts.

## 5. Defects

### P1 - none

No data loss, auth bypass, secret leak or broken demo path was found.

### P2 - none

### P3 (non-blocking, must be decided or fixed before the Helm path is advertised)

**D-01 - API outage takes the whole web UI offline through the ingress (expectation mismatch).**
`/api/ready` is the readiness probe and includes API reachability, so when the API stops the only web pod leaves the Service endpoints after ~12 s and nginx answers **503 for every path, including `/login` and static assets**, with a bare nginx HTML page. The container keeps answering `/api/health` 200 and is never restarted (liveness correct). Recovery is automatic (2-6 s after the API returns).
Expected by the QA brief: "ingress still serves `/login`" with the API down. Actual: 200 for ~12 s, then 503.
Impact: demo unavailable while the API is down (the app is largely unusable then anyway), but the user sees an nginx error page rather than a product error. Also note the probe `timeoutSeconds: 1` is shorter than the endpoint's own 2 s API budget, so a slow API trips readiness before `/api/ready` can answer.
Options: keep and document; or make readiness configuration-only and show API status in the UI; or raise `readinessProbe.timeoutSeconds`.

**D-02 - Spanish error strings in the English UI.**
Repro: open AI suggestions -> `docker stop local_triplanner-agent` -> "Automatic suggestions". Actual toast: "El agente no está disponible." (`AGENT_UNREACHABLE`, hard-coded in `app/api/agent/[...path]/route.ts`). Also, with the API down before readiness flips, `/api/graphql` returns `{"errors":[{"message":"No se pudo conectar con el backend local."}]}` with no stable code.
Expected: localized English message keyed by the stable code (product convention: every string through `t()`, API errors use stable codes).

**D-03 - Chart README claims the web image is published.**
Repro: `curl -s -o /dev/null -w '%{http_code}' https://hub.docker.com/v2/repositories/marcojr13/triplanner-web/tags/1.3.0` -> **404** (the local `latest` image is 8 days old, pre-M11.2). README line "Images published at ... `marcojr13/triplanner-web:1.3.0`" is false today. On a machine without the local image the chart installs an ImagePullBackOff web pod. The contract section 9 already records "Web image not on Docker Hub yet"; the README must say so or the tag must be published (M10.14).

**D-04 - Optional web NetworkPolicy would block kubelet probes.**
`web-networkpolicy.yaml` allows ingress only from the `ingress-nginx` namespace. If `networkPolicy.enabled=true` and the CNI enforces it, kubelet liveness/readiness probes (node source) are denied, so the pod never becomes Ready. Not exercised (flag is `false` by default; Docker Desktop does not enforce policies here). Add a probe allowance or document the constraint before enabling.

**D-05 - `docs/migrations/README.md` index is stale.** Lists 0001-0007 only; 0008-0012 are missing.

**D-06 - Contract/manifest drift.** `0011-frontend-service.md` sections 5.2/5.3 list 4 annotations; values and the live Ingress also ship `proxy-http-version: "1.1"` and `ssl-redirect: "false"`. The section 11 status line still says "M11.6 acceptance in progress".

**D-07 - M11.6 acceptance ran from an ad-hoc overlay.** The running stack includes `%TEMP%\opencode\frontend-helm-ports.yml` (same content as the committed `deploy/docker-compose.frontend-helm.yml`; rendered config verified equivalent). Traceability gap only.

**D-08 - `web.yml` does not build the image on pull requests.** Typecheck and unit tests run; the Dockerfile/Next build is only exercised in the publish job on `main`/tags.

**D-09 - The local Compose web container is stale.** It runs a pre-M11.2 image (`/api/health` -> 404, Docker healthcheck `/login`). Not a branch regression (image `1.3.0` from this tree works in the Compose network, C3); rebuild the Compose stack before a live demo so the health endpoints exist there too.

**D-10 - Chart README port table implies a forwarded web port.** The "Local `3000` / `triplanner-web`" row sits in the port-forward table, but `scripts/port-forward.*` does not forward web; it is reached on `:80` through the ingress.

## 6. Residual risks requiring an explicit human decision

| ID | Risk | Mitigation / decision needed |
|---|---|---|
| RISK-1 | Readiness couples the entire UI to the API (D-01) | Accept the failure mode (documented in chart README/NOTES) or change readiness/UI behaviour before release |
| RISK-2 | The transition overlay publishes the API on `0.0.0.0:4000`; without `x-user-id` the API acts as the demo owner | Accepted by contract section 6; do not run on untrusted networks. The port-forward scripts already warn about `0.0.0.0`. Do not expose these ports in shared environments |
| RISK-3 | Chart `1.3.0` not on Docker Hub (D-03) | Publish via M10.14/CI, or correct the README and keep using the local image for acceptance |
| RISK-4 | Two web frontends (Compose `:3000`, ingress `:80`) with different API URL context | Documented in section 6 of the contract; keep the demo scopes separate |
| RISK-5 | Email invite links still target `http://localhost:3000` (API `APP_URL`) | Documented; set `APP_URL=http://triplanner.localhost` only if the API is restarted for a Helm demo |

## 7. Not tested (and why)

- NetworkPolicy enforcement (flag off; Docker Desktop does not enforce it) - D-04 is analytical.
- TLS through the ingress - out of scope, `tls: []` by design.
- Multi-replica behaviour (replicaCount 1; no PDB/HPA in this slice).
- Locations/trips/users/internal-token failure paths - owned by 0003/0007/0010 and unchanged here; the web only proxies GraphQL.
- Compose image rebuild from scratch - replaced by running the current `1.3.0` image on the Compose network (C3).
- macOS/ARM clean-clone - still the known limitation in `AGENTS.md`.

## 8. Gate 2 recommendation

**APPROVE WITH CONDITIONS.**

No P1/P2 defect was found: the chart deploys the web workload behind nginx, health/readiness, live SSE, uploads (incl. the 20 m ingress body), the agent, security hardening, rollback and the Compose demo all pass on the live stack, and `helm test` is 5/5. The slice is mergeable.

Conditions before the Helm web path is presented as the recruiter path:

1. **Accept or change RISK-1 / D-01** in writing (API outage implies ingress 503 for the whole UI). If accepted, add one sentence to the chart README/NOTES; if not, make readiness configuration-only (or raise the probe timeout) and re-run F3-F5.
2. **Resolve D-03**: publish `marcojr13/triplanner-web:1.3.0` (M10.14) or correct the chart README prerequisite, and note that acceptance used the local image.
3. Fix or explicitly accept D-02 (i18n error strings), D-05, D-06, D-10; record D-04 as a documented constraint before anyone enables the NetworkPolicy.
4. Update `0011-frontend-service.md` (M11.6/M11.7 done, Gate 2 decision) and add 0008-0012 to the migrations index when the decision is recorded.

After conditions 1-2 the recommendation moves to **APPROVE** for merge; image publication remains a separate release step (M10.14).

## 10. Post-QA resolution (2026-11-22, revision 29)

The conditions were resolved in the same session on `refactor/helm-frontend-service`.
The release image for acceptance is `marcojr13/triplanner-web:1.3.0-dev2` (local)
because the node cached the previous `1.3.0` tag by digest; the published
`1.3.0` remains an M10.14/CI step.

| Finding | Resolution | Re-verification |
|---|---|---|
| D-01 / RISK-1 | Readiness gates on configuration only; `/api/ready` stays 200 and reports `backend: ok` or `down`. Readiness probe timeout raised to 3 s. Documented in the chart README, NOTES and contract 4.1. | API stopped 20 s: web pod `Ready=true`, 0 restarts, `/login` 200, `/api/ready` 200 `{"status":"ready","backend":"down"}`, `/api/health` 200; after restart `/api/ready` 200 `backend: ok`. |
| D-02 | Proxy fallbacks are English; added `errors.AGENT_UNREACHABLE` to en/es so the toast is keyed by code. | Agent stopped: toast **"The agent is unavailable."**, `/api/ready` 200 `backend: ok`, `/api/agent/config` 502 `AGENT_UNREACHABLE`, agent recovers. |
| D-03 | Chart README now says the web tag is built locally and published by `web.yml` on a release tag; it no longer claims the tag is on Docker Hub. | README prerequisites corrected; acceptance image recorded above. |
| D-04 | `webService.networkPolicy.probeCIDRs` added and the policy allows those CIDRs; README documents the node/kubelet CIDR requirement. | `helm template` renders the extra `ipBlock` entries when set; flag still `false` by default. |
| D-05 | Migration index lists 0008-0012. | `docs/migrations/README.md`. |
| D-06 | Contract 5.2/5.3 list `proxy-http-version` and `ssl-redirect`; status/rollout rows updated. | `0011-frontend-service.md`. |
| D-07 | All post-QA runs use the committed `deploy/docker-compose.frontend-helm.yml`; the `%TEMP%` overlay is gone from the procedure. | Overlay is the documented transition path. |
| D-08 | `web.yml` builds the image on pull requests (`push: false`). | Workflow diff. |
| D-09 | Compose web rebuilt from this branch; the container healthcheck is `/api/health`. | `local_triplanner-web` healthy; `/api/ready` 200 in the container. |
| D-10 | The web row in the port table no longer implies a port-forward; it is reached through the ingress. | Chart README. |
| D-11 (manual test) | Adding a catalog, manual or suggested activity sent `order: -1`; the trips service rejected it with a Spanish validation message. The service now treats `-1` as append (`MAX(order)+1`), and the UI never falls back to raw server messages: unknown codes show the localized generic error, `INVALID_ARGUMENT` has en/es keys. | Compose and ingress Playwright runs: Catalog → Cafe → Add closes the modal, shows "Activity added", item count 9→10, new order 3, no visible error; item cleaned up afterwards. Trips-service suite 66/66. |

Re-run evidence on revision 29:

- `frontend-next`: `tsc` clean, `bun test` 30/30, `next build` exit 0.
- `helm lint`: 0 failed; rendered readiness probe is `/api/ready` with
  `timeoutSeconds: 3`.
- `helm test`: 5/5 Succeeded (email, locations, trips, users, web).
- Browser through the ingress: English login, username invite, live
  `onNotification` SSE, accept, session `language=en`, no page/console errors.
- Agent failure: English degraded toast, readiness unaffected, recovery passes.
- Compose default stack: web healthy, `/api/health` and `/api/ready` 200.

Gate 2 status after the rerun: **APPROVE** for merge, with image publication
(`marcojr13/triplanner-web:1.3.0`) still owned by the pending release step.

Gate 2 decision (2026-11-22): the human owner **approved Gate 2** for the
frontend Helm slice. Merge and release may proceed; publication remains the
release step.

## 9. Evidence artifacts

| Artifact | Location / command |
|---|---|
| Chart render | `helm template triplanner helm/helm-triplanner -n triplanner ...` (`%TEMP%\opencode\m11-render.yaml`) |
| Server dry-run log | `helm upgrade ... --dry-run=server` (`%TEMP%\opencode\m11-dryrun.log`) |
| Live objects | `kubectl -n triplanner get deploy,po,svc,ing -o yaml` (`web-deploy-live.yaml`, `web-ingress-live.yaml`) |
| UI journey (2 runs) | Playwright script `m11-ui.ts` - 21/21 checks, both revisions |
| SSE proof | `m11-sse2.ts` - `text/event-stream`, event immediately after the invite |
| Uploads | `m11-upload.ts` - 8 MB PDF, 1x1 PNG render, 403 tampered/expired |
| Agent failure | `m11-agent.ts` - degraded toast, ready stays 200; screenshots `m11-agent-up.png`, `m11-agent-down.png` |
| Browser security | `m11-browser-security.ts` - cookies/storage/headers |
| Failure injection | API stop/start poll (0.2 s -> 503, recovery 2.1 s); pod delete (Ready 2.4 s, 200 at 7.1 s) |
| Rollback | `helm rollback triplanner 23` -> rev 25; re-upgrade -> rev 26; pod UID comparison |
| Tests | `frontend-next bun test` 30/30; `tsc` clean; `helm test` 5/5 |