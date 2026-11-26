# ADR 0001 — kube-rbac-proxy on every internal service

| Field | Value |
|---|---|
| Status | Accepted |
| Date | 2026-11-25 |
| Decision owner | Marco |

## Context

The chart added `kube-rbac-proxy` sidecars to the services extracted early
(broker, email, locations, trips, users). The agent and API were added later
(`4b89ec8`, `986338d`) without the sidecar. The result was inconsistent pods and
Services: some exposed `rbac-proxy` on 8443, while the agent and API exposed only
their app port.

The sidecar is not part of the application request path. It is a separate HTTP
8443 listener that authorizes requests with Kubernetes `TokenReview` and
`SubjectAccessReview`. Application authentication remains `x-internal-token`
for internal routes and demo `x-user-id` for the GraphQL API.

## Decision

Every internal service runs a `kube-rbac-proxy` sidecar on port 8443:

`api`, `users`, `trips`, `locations`, `agent`, `email`, `broker`.

The `web` service is the public Cilium Gateway entry point and is the only
exception: it has no sidecar.

The sidecar is ClusterIP-only and HTTP. Use `kubectl port-forward` for local
access; never expose 8443 outside the cluster.

## Consequences

- Each service has a `rbacProxy` values block, a proxy ConfigMap, a
  ClusterRole/ClusterRoleBinding with TokenReview/SAR, a sidecar container, an
  8443 Service port, a host ingress rule and kube-apiserver egress.
- The pod mounts its ServiceAccount token when the sidecar is enabled.
- The sidecar requires cluster-scoped TokenReview/SAR permissions. It is a
  local demo/ops surface, not a replacement for the application tokens.
- The port-forward helper maps the sidecars to local ports 8443—8449.

## Exemptions

Monitoring exporters (`prometheus-postgres-exporter` and
`prometheus-mongodb-exporter`) are **not** application services and do not run
the sidecar. They expose a ClusterIP-only `/metrics` endpoint on `9187` or
`9216`, are scraped only by Prometheus, and have no human or internal API
surface. Adding `kube-rbac-proxy` would require Prometheus to present bearer
tokens and is not supported by the upstream charts. Their ClusterIP Services,
NetworkPolicy rules and read-only database identities are the security
boundary. See `docs/migrations/0031-database-exporters.md`.

## References

- `docs/migrations/0024-rbac-proxy.md`
- `helm/helm-triplanner/README.md#rbac-and-kube-rbac-proxy`
