# 0005 - MongoDB credentials

| Field | Value |
|---|---|
| Status | M7 complete |
| Chart | `helm/helm-triplanner` 0.5.0 |
| Secret | `triplanner-mongo-credentials` |
| Users | `MONGO_ROOT_USERNAME` / `MONGO_ROOT_PASSWORD` |
| Demo values | `triplanner` / `triplanner-demo` |
| Production | `mongo.auth.existingSecret` from Vault/External Secrets |

## 1. Summary

MongoDB now starts with authentication enabled. The demo credentials live in
`values.yaml` and are rendered into a Kubernetes Secret so the one-command
demo remains self-contained. The chart and the locations service consume the
credentials from the Secret; no password is hard-coded in the deployment.

> **Demo only.** The values are intentionally visible in this repository. In a
> real production environment use a secret manager such as HashiCorp Vault,
> External Secrets, Sealed Secrets or your platform's secret store, and point
> `mongo.auth.existingSecret` at the resulting Secret. Never commit real
> credentials.

## 2. Kubernetes shape

`values.yaml`:

```yaml
mongo:
  auth:
    enabled: true
    username: triplanner
    password: triplanner-demo
    existingSecret: ""
    usernameKey: MONGO_ROOT_USERNAME
    passwordKey: MONGO_ROOT_PASSWORD
```

- If `existingSecret` is empty, the chart renders
  `triplanner-mongo-credentials` with the two keys in `data` (base64-encoded
  Secret values).
- If `existingSecret` is set, the chart renders no Secret and reads the keys
  from the existing one. This is the production/Vault path.
- Base64 is encoding, not encryption: protect the Secret with Kubernetes
  encryption at rest and, in production, a secret manager. The base64 values
  only keep the manifest format consistent with `kubectl` expectations.
- The MongoDB StatefulSet receives `MONGO_INITDB_ROOT_USERNAME`,
  `MONGO_INITDB_ROOT_PASSWORD` and `MONGO_INITDB_DATABASE` via
  `secretKeyRef`.
- The locations Deployment receives `MONGODB_USERNAME`,
  `MONGODB_PASSWORD`, `MONGODB_HOST`, `MONGODB_DB` and
  `MONGODB_AUTH_SOURCE`, and builds the connection URL at runtime.
- The locations service starts with a full `MONGODB_URL` if one is supplied;
  otherwise it URL-encodes the credentials and builds
  `mongodb://user:pass@host/db?authSource=admin`.
- Mongo liveness/readiness use `tcpSocket` on 27017, so the password is not
  visible in probe arguments. The locations `/ready` check is the
  auth-aware readiness signal.

## 3. Compose

`deploy/docker-compose.yml` and `docker-compose.hub.yml` read
`MONGO_USERNAME` / `MONGO_PASSWORD` from `.env` with demo defaults. The Mongo
healthcheck authenticates against `admin`; locations uses the same values.
The database volume keeps the root user after the first initialization.

For an existing volume created **before** auth, create the root user once
before enabling `--auth` (or reset the volume):

```javascript
db.getSiblingDB('admin').createUser({
  user: 'triplanner',
  pwd: 'triplanner-demo',
  roles: [{ role: 'root', db: 'admin' }],
});
```

The same applies to an existing Kubernetes Mongo PVC: create the user once or
delete `data-triplanner-mongo-0` and let the chart reseed.

## 4. Rotation

1. Update the Secret (or the external secret source).
2. Restart the Mongo StatefulSet and the locations Deployment:
   `kubectl -n triplanner rollout restart statefulset/triplanner-mongo deploy/triplanner-locations`.
3. Verify `/ready` and a search.

Rotating both at once is safe because the locations pod reconnects on restart.
The catalogue is re-seeded by the locations service if the PVC is reset.

## 5. Tests and evidence

- Helm renders the Secret with both keys and references it from both pods.
- `kubectl auth`/`mongosh`: authenticated `db.locations.countDocuments()` returns
  187; unauthenticated data commands fail with
  `Command aggregate requires authentication`; `ping` remains public.
- `helm test` email + locations suites pass after enabling auth.
- Docker Desktop: Mongo 1/1, locations 2/2, `/ready` returns
  `mongo:"ok"`.
- Compose: Mongo and locations healthy; smoke test passes; authenticated
  count 187, unauthenticated count rejected.
- `helm lint`, kubeconform and the namespace audit pass.

## 6. Risks

- The demo password is in Git by design. It must not be reused outside the
  local demo.
- The locations settings PVC is separate from Mongo; resetting Mongo does not
  delete the HasData key.
- The Mongo Service is ClusterIP-only and the NetworkPolicy limits ingress to
  the locations pod.
