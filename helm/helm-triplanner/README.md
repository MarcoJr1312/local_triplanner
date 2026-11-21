# helm-triplanner

Helm chart for the Triplanner demo email pipeline: a Go HTTP broker and the
email consumer with BYOK settings.

## Layout

```
templates/
  broker/
    broker-deployment.yaml
    broker-networkpolicy.yaml
    broker-pvc.yaml
    broker-rbac-proxy.yaml
    broker-rbac.yaml
    broker-service.yaml
    broker-serviceaccount.yaml
  email/
    email-deployment.yaml
    email-hpa.yaml
    email-networkpolicy.yaml
    email-pvc.yaml
    email-rbac-proxy.yaml
    email-rbac.yaml
    email-service.yaml
    email-serviceaccount.yaml
    email-test.yaml
  NOTES.txt
  _helpers.tpl
values.yaml
```

Each microservice owns its folder and every file is prefixed with the service
name. `_helpers.tpl` and `NOTES.txt` stay at the chart level because they are
shared.

## RBAC and kube-rbac-proxy

Each workload has its own ServiceAccount:

- `triplanner-helm-triplanner-broker`
- `triplanner-helm-triplanner-email`

The main app containers do not use the Kubernetes API. The
`kube-rbac-proxy` sidecar does: it needs `create` on
`tokenreviews.authentication.k8s.io` and
`subjectaccessreviews.authorization.k8s.io`. Those rules live in each service's
ClusterRole, which is bound with a **ClusterRoleBinding** because those
resources are cluster-scoped. The SA token is mounted when
`rbacProxy.enabled: true` (the deployment overrides the SA-level setting).

The chart also supports `rbac.kind: Role` for a namespace-scoped service role;
that mode requires `rbacProxy.enabled: false`, because TokenReview and
SubjectAccessReview cannot be granted by a namespaced RoleBinding.

### Local HTTP proxy

This is a local demo: the sidecar listens with
`--insecure-listen-address` (HTTP), not TLS. Keep the service ClusterIP and use
`kubectl port-forward`; never expose port 8443 outside the cluster.

```bash
kubectl -n triplanner port-forward svc/triplanner-kafka 8443:8443
curl -i http://localhost:8443/ready          # 401 without a token
```

A client token must be allowed to `get` `services/proxy` for the service name in
the proxy ConfigMap. The proxy returns 403 for an authenticated but unauthorized
token, and proxies the upstream on success. The main broker/email HTTP ports
(8080/4200) remain available to the app; 8443 is the RBAC-protected path.

ClusterRoles and ClusterRoleBindings are cluster-scoped and therefore do not
have `metadata.namespace`; every namespaced object still uses
`{{ .Release.Namespace }}`.

## Install

First create the namespace; every manifest is rendered into it via
`.Release.Namespace` (or run Helm with `--create-namespace`):

```bash
kubectl create namespace triplanner
```

Prerequisites:

- A default StorageClass for the two PVCs.
- The `triplanner-internal` Secret with `INTERNAL_TOKEN`.
- Images published at `marcojr13/triplanner-kafka:0.1.0` and
  `marcojr13/triplanner-email:0.1.0` (or override `images.*`).

```bash
kubectl create namespace triplanner
kubectl -n triplanner create secret generic triplanner-internal \
  --from-literal=INTERNAL_TOKEN="$(openssl rand -hex 32)"

helm install triplanner ./helm/helm-triplanner \
  --namespace triplanner \
  --wait
```

The email service starts with `provider: sink`; the recruiter adds a Resend key
in **Profile → Email delivery**. No Resend Secret is required.

## Verify

```bash
helm test triplanner -n triplanner
kubectl -n triplanner get pods
kubectl -n triplanner port-forward svc/triplanner-email 4200:4200
curl http://localhost:4200/health
curl http://localhost:4200/ready
```

Test hook pods are deleted after success via
`helm.sh/hook-delete-policy: before-hook-creation,hook-succeeded`. Failed tests
keep the pod for logs.

## Uninstall

```bash
helm uninstall triplanner -n triplanner
kubectl delete namespace triplanner
```
