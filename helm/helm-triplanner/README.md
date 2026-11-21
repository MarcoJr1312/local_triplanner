# helm-triplanner

Helm chart for the Triplanner demo services: a Go HTTP broker, the email
consumer with BYOK settings, and the locations/activities catalogue with its
single-node MongoDB StatefulSet.

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
  locations/
    locations-deployment.yaml
    locations-networkpolicy.yaml
    locations-pvc.yaml
    locations-rbac-proxy.yaml
    locations-rbac.yaml
    locations-service.yaml
    locations-serviceaccount.yaml
    locations-test.yaml
  mongo/
    mongo-networkpolicy.yaml
    mongo-service.yaml
    mongo-statefulset.yaml
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
- `triplanner-helm-triplanner-locations`

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

kubectl -n triplanner port-forward svc/triplanner-locations 8443:8443
curl -i http://localhost:8443/ready
```

A client token must be allowed to `get` `services/proxy` for the service name in
the proxy ConfigMap. The proxy returns 403 for an authenticated but unauthorized
token, and proxies the upstream on success. The main broker/email/locations HTTP
ports (8080/4200/4300) remain available to the app; 8443 is the RBAC-protected
path.

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

- A default StorageClass for the four PVCs (broker, email settings, Mongo,
  locations settings).
- The `triplanner-internal` Secret with `INTERNAL_TOKEN`.
- Images published at `marcojr13/triplanner-kafka:0.1.0`,
  `marcojr13/triplanner-email:0.1.0` and
  `marcojr13/triplanner-locations:0.2.1` (or override `images.*`).

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
```

Or forward every service with one command:

```bash
# Windows
powershell -ExecutionPolicy Bypass -File scripts/port-forward.ps1

# macOS / Linux / Git Bash
bash scripts/port-forward.sh
```

| Local | Service | Notes |
|---|---|---|
| `8080` | `triplanner-kafka` | app port |
| `4200` | `triplanner-email` | app port |
| `4300` | `triplanner-locations` | app port |
| `8443` | broker `kube-rbac-proxy` | with `-Proxy` / `--proxy` |
| `8444` | email `kube-rbac-proxy` | with `-Proxy` / `--proxy` |
| `8445` | locations `kube-rbac-proxy` | with `-Proxy` / `--proxy` |
| `27018` | MongoDB | with `-Mongo` / `--mongo`; avoids Compose on 27017 |

App ports bind `0.0.0.0` by default so Compose containers can use
`host.docker.internal`; do not run this on an untrusted network. Proxy and Mongo
ports bind `127.0.0.1` only. Stop with `... -Stop` / `--stop`.

If your shell resolves a different `kubectl` (WSL, Git Bash), set `KUBECTL`
to the Docker Desktop binary, for example:

```bash
KUBECTL='/mnt/c/Program Files/Docker/Docker/resources/bin/kubectl.exe' \
  bash scripts/port-forward.sh
```

### Places data (BYOK)

The locations service starts with the committed Toronto catalogue
(`provider=preloaded`). The recruiter can add a HasData key in **Settings →
Places data**; the key is stored at
`locationsService.settingsFile` on the `triplanner-locations-settings` PVC
(mode `0600`). HasData results are cached in MongoDB with a 5-day expiry and
the MongoDB TTL index removes them. If HasData fails, cached data is served.

The locations pod needs egress on TCP 443 for HasData; the NetworkPolicy
allows it. No key ships in the chart or images.

### MongoDB credentials

By default the chart renders the demo credentials from `mongo.auth` into the
`triplanner-mongo-credentials` Secret and injects them into Mongo and the
locations service. **This is demo-only.** For production, leave
`mongo.auth.existingSecret` pointing at a Secret managed by HashiCorp Vault,
External Secrets, Sealed Secrets or your platform secret manager; the chart
does not render credentials when that field is set.

```yaml
mongo:
  auth:
    enabled: true
    existingSecret: triplanner-mongo-credentials
    usernameKey: MONGO_ROOT_USERNAME
    passwordKey: MONGO_ROOT_PASSWORD
```

The existing Secret must contain those keys. Rotating a credential requires
updating the Secret and restarting the Mongo and locations pods. The Mongo
StatefulSet keeps its `data-triplanner-mongo-0` PVC, so a root user created on
an older unauthenticated PVC must be created once manually or the PVC reset.

Test hook pods are deleted after success via
`helm.sh/hook-delete-policy: before-hook-creation,hook-succeeded`. Failed tests
keep the pod for logs.

## Uninstall

```bash
helm uninstall triplanner -n triplanner
kubectl delete namespace triplanner
```

The Mongo StatefulSet keeps its `data-triplanner-mongo-0` PVC after uninstall;
delete it explicitly to reset the catalogue:

```bash
kubectl -n triplanner delete pvc -l app.kubernetes.io/name=triplanner-mongo
```
