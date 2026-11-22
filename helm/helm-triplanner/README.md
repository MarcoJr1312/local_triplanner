# helm-triplanner

Helm chart for the Triplanner demo services: a Go HTTP broker, the email
consumer with BYOK settings, the locations/activities catalogue with its
single-node MongoDB StatefulSet, and the trips service with its own PostgreSQL.

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
  trips/
    trips-deployment.yaml
    trips-networkpolicy.yaml
    trips-postgres-networkpolicy.yaml
    trips-postgres-secret.yaml
    trips-postgres-service.yaml
    trips-postgres-statefulset.yaml
    trips-rbac-proxy.yaml
    trips-rbac.yaml
    trips-service.yaml
    trips-serviceaccount.yaml
    trips-test.yaml
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
- `triplanner-helm-triplanner-trips`

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

kubectl -n triplanner port-forward svc/triplanner-trips 8443:8443
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

- A default StorageClass for the five PVCs (broker, email settings, Mongo,
  locations settings, trips PostgreSQL).
- The `triplanner-internal` Secret with `INTERNAL_TOKEN`.
- Images published at `marcojr13/triplanner-kafka:0.1.0`,
  `marcojr13/triplanner-email:0.1.0`,
  `marcojr13/triplanner-locations:0.2.1` and
  `marcojr13/triplanner-trips:0.1.0` (or override `images.*`).

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
| `4400` | `triplanner-trips` | app port |
| `8443` | broker `kube-rbac-proxy` | with `-Proxy` / `--proxy` |
| `8444` | email `kube-rbac-proxy` | with `-Proxy` / `--proxy` |
| `8445` | locations `kube-rbac-proxy` | with `-Proxy` / `--proxy` |
| `8446` | trips `kube-rbac-proxy` | with `-Proxy` / `--proxy` |
| `27018` | MongoDB | with `-Mongo` / `--mongo`; avoids Compose on 27017 |
| `5433` | trips PostgreSQL | with `-Postgres` / `--postgres`; avoids Compose on 5432 |

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

### Trips PostgreSQL credentials

By default the chart renders `tripsService.postgres.auth` into the
`triplanner-trips-postgres-credentials` Secret (`POSTGRES_USER`,
`POSTGRES_PASSWORD`, `POSTGRES_DB`) and injects it into both the StatefulSet and
the trips service. **This is demo-only.** For production, set
`tripsService.postgres.auth.existingSecret` to a Secret managed by Vault,
External Secrets or Sealed Secrets with the same keys; the chart then renders no
Secret.

```yaml
tripsService:
  postgres:
    auth:
      enabled: true
      existingSecret: triplanner-trips-postgres-credentials
      usernameKey: POSTGRES_USER
      passwordKey: POSTGRES_PASSWORD
      databaseKey: POSTGRES_DB
```

The trips service applies its own schema at boot under `pg_advisory_xact_lock`.
With `tripsService.seedDemo: true` it also seeds the demo trip. The data lives in
`data-triplanner-trips-postgres-0`; rotating credentials requires updating the
Secret and restarting the StatefulSet and the trips Deployment.

### Invitation outbox

Trips writes `email.invite.v1` and `email.member.joined.v1` to its outbox in the
same transaction as the invitation or join. The relay publishes to
`triplanner-kafka` on `TripInvitation` and stamps `published_at` /
`broker_offset`. A broker outage leaves rows pending; `/ready` reports
`outbox_pending`. Replay one row with:

```bash
kubectl -n triplanner exec deploy/triplanner-trips -c trips -- \
  bun run db:replay-outbox <outbox-id>
```

The base demo still exposes the copyable join link if email is disabled or the
broker is down.

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

The trips PostgreSQL StatefulSet also keeps its
`data-triplanner-trips-postgres-0` PVC:

```bash
kubectl -n triplanner delete pvc -l app.kubernetes.io/name=triplanner-trips-postgres
```
