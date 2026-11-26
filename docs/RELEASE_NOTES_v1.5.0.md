# Release notes — v1.5.0 (frontend on Helm + users service)

> Superseded. `v1.5.0` was tagged locally but never published. The favorites
> and reminder features ship in **v1.6.0**. See
> [`RELEASE_NOTES_v1.6.0.md`](./RELEASE_NOTES_v1.6.0.md).

| Field | Value |
|---|---|
| Status | Release candidate; Docker Hub publish and published-stack smoke pending |
| Chart | `helm-triplanner` 0.8.0 (`appVersion` 0.5.0) |
| Images | web `1.3.0`, users `0.1.0`, trips `0.1.1`, API `1.3.0`; email `0.1.1`, locations `0.2.1`, broker `0.1.0` unchanged |
| Contracts | `docs/migrations/0008-users-service.md`, `docs/migrations/0011-frontend-service.md` |
| QA | `docs/migrations/0010-users-qa.md`, `docs/migrations/0012-frontend-qa.md` (both Gate 2 approved) |
| Supersedes | `v1.4.0`, which was tagged locally but never published |

## Highlights

### Frontend on Helm (M11)

- **Next.js web workload.** Chart 0.8.0 deploys `triplanner-web` on ClusterIP
  `:3000` with a hardened pod: non-root uid 1000, read-only root filesystem,
  `/tmp` emptyDir, dropped capabilities, seccomp `RuntimeDefault`, no Kubernetes
  API token. There is no kube-rbac-proxy sidecar for the user-facing web.
- **nginx Ingress.** `http://triplanner.localhost` routes `/` to the web
  Service. The Ingress disables proxy buffering, uses 3600 s read/send timeouts
  for SSE (`onNotification`, `onTripChanged`, presence) and allows 20 MB bodies
  for attachments.
- **Probeable runtime.** `GET /api/health` is process liveness; `GET /api/ready`
  gates on configuration only and reports `backend: ok|down`. An API outage
  therefore keeps the pod Ready and the UI reachable with its own error state
  instead of replacing the app with an nginx 503 page. The readiness probe
  timeout is 3 s.
- **Server-side proxies unchanged.** `/api/graphql`, `/api/agent/*` and
  `/uploads/*` still resolve their upstreams at request time from
  `NEXT_PRIVATE_BACKEND_URL`, `NEXT_PRIVATE_BACKEND_ORIGIN` and
  `NEXT_PRIVATE_AGENT_URL`. The session model is still the demo `x-user-id`
  header; no cookie/BFF redesign.
- **Transitional connectivity.** The API and agent remain Compose workloads in
  this release. Publish their ports for the Helm web:
  `deploy/docker-compose.frontend-helm.yml`. The default Compose demo still
  publishes only web.
- **English by default** is preserved through the ingress: login, new accounts
  and the seeded demo start in English; Spanish is available in Settings.
- **CI:** `web.yml` now typechecks, runs all frontend tests, builds the image on
  pull requests and publishes amd64+arm64 on a release tag.

### Users service (v1.4.0 scope, first published here)

- Users service (`backend/users-service`, `:4500`) with its own PostgreSQL
  StatefulSet, username + password login (Argon2id), search/batch, profile
  update, protected soft delete and a local notification inbox.
- No JWT; login returns the profile and requests carry `x-user-id`. Demo
  accounts `demo` / `demo123` and `demo-friend` / `demo123` keep fixed UUIDs
  `11111111-1111-4111-8111-111111111111` and
  `22222222-2222-4222-8222-222222222222`.
- Local invites by username (`tripLocalInvite`) with accept/decline/revoke and
  live `onNotification`. No email, code or outbox row for local invites.
- Account admin from the login screen; demo accounts are protected and deleting
  a trip owner is blocked with `USER_OWNS_TRIPS`.

## Fixes

- **Adding activities works again.** The web sends `order: -1` to append a
  catalog, manual or suggested activity; the trips service now resolves that
  marker to `MAX(order) + 1` inside the insert transaction instead of rejecting
  it. Explicit orders remain `0..1000000`.
- **No Spanish error text in the English UI.** `localizeApiError` no longer
  falls back to the server message: known codes use their en/es key, unknown
  ones use the localized generic error. `INVALID_ARGUMENT` and
  `TRIPS_UNAVAILABLE` gained en/es keys, and the location search page uses the
  same helper.

## Upgrade

```bash
helm upgrade triplanner ./helm/helm-triplanner \
  --namespace triplanner \
  --set images.users.tag=0.1.0 \
  --set images.trips.tag=0.1.1 \
  --set images.web.tag=1.3.0 \
  --wait
```

Prerequisites added by this release:

- An nginx ingress controller (`ingressClassName: nginx`). On Docker Desktop it
  is exposed on localhost:80/443.
- The API and agent host ports published for the transitional web:
  `docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.frontend-helm.yml up -d api agent`.
- The web pod must resolve `host.docker.internal`. If it does not, set
  `webService.hostAliases` to the Docker Desktop gateway IP.

## Breaking changes and behavior changes

- **Readiness no longer fails when the API is down.** `/api/ready` returns 200
  with `backend: down`; monitor that field if you need end-to-end health.
- **Chart 0.8.0 needs an IngressClass.** Without nginx the web Service is still
  reachable by port-forward, but the default URL does not work.
- **`images.web.pullPolicy` is `IfNotPresent`.** On a machine that already
  cached an older image under the same tag, delete/re-tag it or use a unique
  tag; a clean cluster pulls the published tag normally.
- **Email invite links still use `APP_URL`.** The API remains on Compose and its
  `APP_URL` is `http://localhost:3000`; set `APP_URL=http://triplanner.localhost`
  if the API is restarted for a Helm-only demo.

## Verification

- Frontend: `tsc` clean, `bun test` 30/30, `next build` exit 0.
- Helm: `helm lint` clean, server dry-run clean, 51 namespaced objects carry
  the release namespace, `helm test` 5/5.
- Live ingress: English login, username invite, live SSE notification, accept,
  uploads through `/uploads`, agent suggestions and degraded state.
- Failure: API stop → pod stays Ready, `/login` 200, ready reports `down`;
  recovery to `ok`; agent stop → English toast, ready unaffected.
- Rollback to chart 0.7.0 leaves the backend pods and data untouched.
- Compose default stack: all services healthy; `scripts/smoke.ps1` passes.

## Publication checklist

1. Push `refactor/helm` (or merge to `main`) and tag `v1.5.0`; CI publishes
   `marcojr13/triplanner-web:1.3.0`, `triplanner-users:0.1.0`,
   `triplanner-trips:0.1.1` and `triplanner-api:1.3.0` (amd64+arm64).
2. Run the published-stack smoke: login `demo` / `demo123`, username invite →
   bell/SSE → accept, web through the ingress.
3. Record the published digests below and switch the Helm release from the
   `-dev` tags to the final tags.
4. macOS clean-clone QA remains pending.

| Image | Digest |
|---|---|
| `marcojr13/triplanner-web:1.3.0` | TBD (CI) |
| `marcojr13/triplanner-users:0.1.0` | TBD (CI) |
| `marcojr13/triplanner-trips:0.1.1` | TBD (CI) |
| `marcojr13/triplanner-api:1.3.0` | TBD (CI) |
