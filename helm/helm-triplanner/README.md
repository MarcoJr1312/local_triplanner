# helm-triplanner

Helm chart for the Triplanner demo services: the Next.js web app behind nginx
ingress, a Go HTTP broker, the email consumer with BYOK settings, the
locations/activities catalogue with its single-node MongoDB StatefulSet, the
trips service and the users service with their own PostgreSQL databases.

## Layout

```
templates/
  agent/
    agent-configmap.yaml
    agent-deployment.yaml
    agent-networkpolicy.yaml
    agent-postgres-networkpolicy.yaml
    agent-postgres-secret.yaml
    agent-postgres-service.yaml
    agent-postgres-statefulset.yaml
    agent-pvc.yaml
    agent-service.yaml
    agent-serviceaccount.yaml
    agent-test.yaml
  broker/
    broker-configmap.yaml
    broker-deployment.yaml
    broker-networkpolicy.yaml
    broker-pvc.yaml
    broker-rbac-proxy.yaml
    broker-rbac.yaml
    broker-service.yaml
    broker-serviceaccount.yaml
  email/
    email-configmap.yaml
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
    locations-configmap.yaml
    locations-deployment.yaml
    locations-networkpolicy.yaml
    locations-pvc.yaml
    locations-rbac-proxy.yaml
    locations-rbac.yaml
    locations-service.yaml
    locations-serviceaccount.yaml
    locations-test.yaml
  trips/
    trips-configmap.yaml
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
  users/
    users-configmap.yaml
    users-deployment.yaml
    users-networkpolicy.yaml
    users-postgres-networkpolicy.yaml
    users-postgres-secret.yaml
    users-postgres-service.yaml
    users-postgres-statefulset.yaml
    users-rbac-proxy.yaml
    users-rbac.yaml
    users-service.yaml
    users-serviceaccount.yaml
    users-test.yaml
  web/
    web-configmap.yaml
    web-deployment.yaml
    web-ingress.yaml
    web-networkpolicy.yaml
    web-service.yaml
    web-serviceaccount.yaml
    web-test.yaml
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

## Configuration

Every application workload has a ConfigMap rendered from `values.yaml`:

- `triplanner-kafka-config`
- `triplanner-email-config`
- `triplanner-locations-config`
- `triplanner-trips-config`
- `triplanner-users-config`
- `triplanner-web-config`

Deployments load the whole ConfigMap with
`envFrom.configMapRef` and keep only secret values as explicit
`secretKeyRef` environment entries (`INTERNAL_TOKEN`, PostgreSQL passwords,
MongoDB credentials, the optional Resend key). The pod template carries a
`checksum/config` annotation, so changing a value rolls the affected workload.

Never put credentials in a ConfigMap. The optional
`locationsService.mongo.url` is rendered into the ConfigMap; use a
credential-free URL or move it to a Secret before using it in a shared cluster.

## RBAC and kube-rbac-proxy

Each workload has its own ServiceAccount:

- `triplanner-helm-triplanner-broker`
- `triplanner-helm-triplanner-email`
- `triplanner-helm-triplanner-locations`
- `triplanner-helm-triplanner-trips`
- `triplanner-helm-triplanner-users`
- `triplanner-helm-triplanner-web` (no Kubernetes API access; no
  kube-rbac-proxy sidecar)

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

kubectl -n triplanner port-forward svc/triplanner-users 8443:8443
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

- A default StorageClass for the eight PVCs (broker, email settings, Mongo,
  locations settings, trips PostgreSQL, users PostgreSQL, agent settings, agent
  pgvector PostgreSQL).
- An nginx ingress controller (`ingressClassName: nginx`).
- The `triplanner-internal` Secret with `INTERNAL_TOKEN`.
- Images referenced by the chart (override `images.*`):
  `marcojr13/triplanner-kafka:0.1.0`,
  `marcojr13/triplanner-email:0.1.1`,
  `marcojr13/triplanner-locations:0.2.1`,
  `marcojr13/triplanner-trips:1.6.0`,
  `marcojr13/triplanner-users:1.6.0`,
  `marcojr13/triplanner-agent:1.6.0` and
  `marcojr13/triplanner-web:1.6.0`. The `1.6.0` tags are published by the
  per-service workflows when the `v1.6.0` tag is pushed; override the tags for
  a local pre-release acceptance run.

```bash
kubectl create namespace triplanner
kubectl -n triplanner create secret generic triplanner-internal \
  --from-literal=INTERNAL_TOKEN="$(openssl rand -hex 32)"

# nginx ingress (once per cluster)
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace

helm install triplanner ./helm/helm-triplanner \
  --namespace triplanner \
  --wait
```

The email service starts with `provider: sink`; the recruiter adds a Resend key
in **Profile → Email delivery**. No Resend Secret is required.

### Web and ingress

The chart deploys `triplanner-web` on ClusterIP `:3000` and an nginx Ingress at
`http://triplanner.localhost` by default. The API and agent are still external
in this slice, so the web pod reaches them through `host.docker.internal`.
Publish those ports on the host during the transition:

```bash
docker compose \
  -f deploy/docker-compose.yml \
  -f deploy/docker-compose.frontend-helm.yml \
  up -d api agent
```

Values:

```yaml
webService:
  backend:
    url: http://host.docker.internal:4000/graphql
    origin: http://host.docker.internal:4000
  agent:
    url: http://host.docker.internal:4100
  ingress:
    host: triplanner.localhost
```

The Ingress disables proxy buffering and uses long read/send timeouts for SSE,
and a 20 MB body limit for GraphQL attachments. If `host.docker.internal` does
not resolve from the pod, set `webService.hostAliases` to the Docker Desktop
gateway IP.

`/api/ready` gates on configuration only and reports API reachability in its
body (`backend: ok|down`), so an API outage leaves the web pod Ready and the
ingress serving the app's own error state instead of an nginx 503 page. The
liveness probe only checks the Next process.

The API’s `APP_URL` remains the Compose web URL, so email invite links still
target `http://localhost:3000` until the API migrates. Username invites and
notifications work through the Helm web.

## Verify

```bash
helm test triplanner -n triplanner
kubectl -n triplanner get pods

# Web through ingress
curl -H "Host: triplanner.localhost" http://127.0.0.1/api/health
curl -H "Host: triplanner.localhost" http://127.0.0.1/api/ready
curl -H "Host: triplanner.localhost" -o /dev/null -w '%{http_code}\n' http://127.0.0.1/login
# Then open http://triplanner.localhost
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
| `4500` | `triplanner-users` | app port |
| `4100` | `triplanner-agent` | app port |
| — | `triplanner-web` | served through nginx ingress at `http://triplanner.localhost`; not port-forwarded |
| `8443` | broker `kube-rbac-proxy` | with `-Proxy` / `--proxy` |
| `8444` | email `kube-rbac-proxy` | with `-Proxy` / `--proxy` |
| `8445` | locations `kube-rbac-proxy` | with `-Proxy` / `--proxy` |
| `8446` | trips `kube-rbac-proxy` | with `-Proxy` / `--proxy` |
| `8447` | users `kube-rbac-proxy` | with `-Proxy` / `--proxy` |
| `27018` | MongoDB | with `-Mongo` / `--mongo`; avoids Compose on 27017 |
| `5433` | trips PostgreSQL | with `-Postgres` / `--postgres`; avoids Compose on 5432 |
| `5434` | users PostgreSQL | with `-Postgres` / `--postgres`; avoids Compose on 5432 |

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

### Users PostgreSQL credentials

By default the chart renders `usersService.postgres.auth` into the
`triplanner-users-postgres-credentials` Secret (`POSTGRES_USER`,
`POSTGRES_PASSWORD`, `POSTGRES_DB`) and injects it into both the StatefulSet and
the users service. **This is demo-only.** For production, set
`usersService.postgres.auth.existingSecret` to a Secret managed by Vault,
External Secrets or Sealed Secrets with the same keys; the chart then renders no
Secret.

```yaml
usersService:
  postgres:
    auth:
      enabled: true
      existingSecret: triplanner-users-postgres-credentials
      usernameKey: POSTGRES_USER
      passwordKey: POSTGRES_PASSWORD
      databaseKey: POSTGRES_DB
```

The users service applies its own schema and seeds `demo` / `demo-friend`
(`demo123`) at boot under `pg_advisory_xact_lock`. The data lives in
`data-triplanner-users-postgres-0`. The demo accounts are protected; deleting a
user who owns a trip returns `USER_OWNS_TRIPS`.

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

The users PostgreSQL StatefulSet keeps its `data-triplanner-users-postgres-0`
PVC:

```bash
kubectl -n triplanner delete pvc -l app.kubernetes.io/name=triplanner-users-postgres
```
