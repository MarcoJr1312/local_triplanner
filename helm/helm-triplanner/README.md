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
    broker-rbac.yaml
    broker-service.yaml
    broker-serviceaccount.yaml
  email/
    email-deployment.yaml
    email-hpa.yaml
    email-networkpolicy.yaml
    email-pvc.yaml
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

## RBAC

Each workload has its own ServiceAccount:

- `triplanner-helm-triplanner-broker`
- `triplanner-helm-triplanner-email`

Both run with `automountServiceAccountToken: false`, so no API token is mounted.
Neither service calls the Kubernetes API, so their roles are intentionally
empty. The chart creates a `ClusterRole` and a namespace-scoped `RoleBinding`
for each service; set `rbac.kind: Role` on a service to use a namespaced Role
instead. Do not add rules until a service actually needs API access.

ClusterRoles are cluster-scoped and therefore do not have
`metadata.namespace`; every namespaced object still uses
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
