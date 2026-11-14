# CI/CD and Docker Hub

## Workflows

Each service has its own workflow and test command.

| Workflow | Service | Tests | Docker image |
|---|---|---|---|
| `web.yml` | Next.js frontend | `frontend-next/lib/geolocation.test.ts`, `frontend-next/lib/uberLink.test.ts` (`bun test`) | `triplanner-web` |
| `api.yml` | Bun GraphQL API | all `backend/server/test/*.test.ts` (Postgres + MongoDB) | `triplanner-api` |
| `agent.yml` | FastAPI agent | `backend/agent-service/tests/test_m2.py` + `tests/test_settings.py` (Postgres + pgvector) | `triplanner-agent` |
| `compose-smoke.yml` | Full stack | builds all images, boots Compose, runs `scripts/smoke.sh` | no push |

Triggers:

- **Pull request:** tests run; no image is pushed.
- **Push to a feature branch:** tests run; no image is pushed.
- **Push to `main`:** tests + multi-arch publish of `latest` and `sha-<short>`.
- **Tag `v*`:** tests + multi-arch publish of `1.2.3`, `1.2` and `sha-<short>`.
- **Manual:** `workflow_dispatch` on the service workflows.

Path filters keep each workflow scoped to its service files.

## Current images

- Repository: https://github.com/MarcoJr1312/local_triplanner
- Docker Hub namespace: `marcojr13`
- Images:
  - `marcojr13/triplanner-web`
  - `marcojr13/triplanner-api`
  - `marcojr13/triplanner-agent`
- Published tags: `latest`, `1.2`, `1.2.0`, `sha-6176ac4`.
- Architectures: `linux/amd64`, `linux/arm64`.
- Verification: 8/8 GitHub Actions runs passed on `main` and tag `v1.2.0`;
  the published stack was pulled and passed the smoke test.

## Docker Hub setup

1. Create a Docker Hub access token with **Read & Write** permission.
2. In the GitHub repository: **Settings → Secrets and variables → Actions**.
3. Add:

| Secret | Value |
|---|---|
| `DOCKERHUB_USERNAME` | Your Docker Hub username |
| `DOCKERHUB_TOKEN` | The access token |

4. Optional: create three Docker Hub repositories. A first push usually creates
   them automatically if the namespace exists:

```
triplanner-web
triplanner-api
triplanner-agent
```

The workflows fail at the login/push step if the secrets are missing, so add
them before pushing `main` or a `v*` tag.

## Image tags

| Event | Tags |
|---|---|
| Push to `main` | `latest`, `sha-<short>` |
| Tag `v1.2.3` | `1.2.3`, `1.2`, `sha-<short>` |
| Pull request / feature branch | tests only |

All published images are multi-arch: `linux/amd64` and `linux/arm64`.

## Run the published images

```bash
docker compose -f docker-compose.hub.yml up -d
```

The file defaults to `DOCKERHUB_USERNAME=marcojr13` and `IMAGE_TAG=latest`.
Override them for a fork or a pinned version:

```bash
DOCKERHUB_USERNAME=youruser IMAGE_TAG=1.2.0 \
  docker compose -f docker-compose.hub.yml up -d
```

Open http://localhost:3000/login.

Useful overrides (root `.env` or shell):

```bash
WEB_PORT=3000
POSTGRES_PORT=5432
MONGO_PORT=27017
LLM_PROVIDER=none
DOCKERHUB_USERNAME=marcojr13
IMAGE_TAG=1.2.0
```

The API container runs migrations and the idempotent seed on every start, so a
fresh volume is ready in one command.

> Container names are fixed (`local_triplanner-*`). Stop the source-build stack
> (`docker compose down`) before starting the Docker Hub stack.

## Release flow

```bash
# after the changes are on main
git tag -a v1.2.0 -m "Triplanner local demo v1.2.0"
git push origin v1.2.0
```

The three service workflows publish the version tags; `compose-smoke` verifies
the full stack from source. Check the Actions tab and Docker Hub before sharing
the images.

## Notes

- Docker Hub rate limits apply to anonymous pulls; authenticated pulls are more
  generous.
- Multi-arch builds are slower than single-arch. The first run warms the GitHub
  Actions cache.
- This pipeline publishes images; it does not deploy to a cloud host. Deployment
  is the `docker-compose.hub.yml` file above.
