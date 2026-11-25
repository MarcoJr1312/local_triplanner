# 0024 — kube-rbac-proxy on agent and API

| Field | Value |
|---|---|
| Status | **Accepted — Gate 2 approved (2026-11-25)** |
| Cycle | Kubernetes Manifest Delivery |
| Slice | M21 — kube-rbac-proxy standard |
| Triplanner chart | `helm-triplanner` 0.17.0 |

## 1. Why

The chart's internal services had `kube-rbac-proxy` sidecars, but the agent and
API did not. The omission was historical: the sidecar was added to the early
services, while the agent (`4b89ec8`) and API (`986338d`) were added later
without it. The result was inconsistent pods and Service ports.

The sidecar is a separate HTTP 8443 listener that authorizes requests with
Kubernetes `TokenReview` and `SubjectAccessReview`; it is not part of the
application request path. Application auth remains `x-internal-token` and demo
`x-user-id`.

## 2. Decision

Every internal service runs the sidecar on 8443:

`api`, `users`, `trips`, `locations`, `agent`, `email`, `broker`.

The web is the public Cilium Gateway entry and is the only exception. See
[ADR 0001](../decisions/0001-kube-rbac-proxy-standard.md).

## 3. Scope

- Add `rbac` and `rbacProxy` values to `agentService` and `apiService`.
- Add `agent-rbac-proxy.yaml`, `agent-rbac.yaml`, `api-rbac-proxy.yaml` and
  `api-rbac.yaml`.
- Add the sidecar containers to the agent and API Deployments, with pod token
  automount enabled when the sidecar is enabled.
- Add the `rbac-proxy` port 8443 to both Services.
- Add the host ingress rule for 8443 and kube-apiserver egress on 443 to both
  CiliumNetworkPolicies.
- Extend the port-forward helpers to 8448 (agent) and 8449 (API).
- Chart 0.17.0; no application image changes.

## 4. Verification

1. `helm lint` and `helm template`.
2. `helm upgrade` to chart 0.17.0.
3. Agent and API pods are `2/2` (`app, kube-rbac-proxy`).
4. Their Services expose `http` and `rbac-proxy`.
5. The sidecar ConfigMaps and ClusterRoles/Bindings exist.
6. `kubectl port-forward` to 8448/8449 returns `401` without a token.
7. `scripts/metrics-smoke.ps1 -Target helm`, `helm test` and `/api/ready` still
   pass.

### 4.1 Observed evidence (2026-11-25)

- Chart 0.17.0, Helm revision 17.
- `triplanner-agent` and `triplanner-api` pods are `2/2`
  (`agent, kube-rbac-proxy` / `api, kube-rbac-proxy`).
- Both Services expose `http` and `rbac-proxy`.
- `triplanner-agent-rbac-proxy` / `triplanner-api-rbac-proxy` ConfigMaps and
  the corresponding ClusterRoles/Bindings exist.
- `kubectl port-forward` to 8448/8449 returns `401` without a token.
- Metrics smoke 8/8; Prometheus targets 8/8 up; Helm tests 7/7; login and
  `requestSuggestions` still pass.
- No application image changes.

## 5. Rollback

Set `agentService.rbacProxy.enabled=false` and
`apiService.rbacProxy.enabled=false`; the sidecar templates and Service ports
are conditional. The app is unaffected because the sidecar is not in the
request path. No data changes.

## 6. Gate 2

**Approved on 2026-11-25** by the standard directive: every internal service
uses `kube-rbac-proxy`, with the web as the only exception. No image or release
publication is included.
