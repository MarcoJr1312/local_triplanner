# CI/CD and Docker Hub

## Workflows

Each service has its own workflow and test command.

| Workflow | Service | Tests | Docker image |
|---|---|---|---|
| `web.yml` | Next.js frontend | `bun audit` + `bun test` | `triplanner-web` |
| `api.yml` | Bun GraphQL API | `bun audit` + all `backend/server/test/*.test.ts` (Postgres + MongoDB) | `triplanner-api` |
| `agent.yml` | FastAPI agent | `pip-audit` + `tests/test_m2.py` + `tests/test_settings.py` (Postgres + pgvector) | `triplanner-agent` |
| `locations.yml` | Locations service | `bun audit` + `bun test` (MongoDB) | `triplanner-locations` |
| `trips.yml` | Trips service | `bun audit` + `bun test` (PostgreSQL) | `triplanner-trips` |
| `users.yml` | Users service | `bun audit` + `bun test` (PostgreSQL, including the UUID migration) | `triplanner-users` |
| `compose-smoke.yml` | Full stack | builds all images, boots Compose, runs `scripts/smoke.sh` | no push |

Every test job audits its dependencies before running the tests:

- **Web and API:** `bun audit` after `bun install --frozen-lockfile`.
- **Agent:** `uv export --frozen --no-dev ...` then `uvx pip-audit` against the
  exported lockfile.

A vulnerability advisory fails the workflow before tests or image publishing.

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
  - `marcojr13/triplanner-locations`
  - `marcojr13/triplanner-trips`
  - `marcojr13/triplanner-users` (new: first publish is M10.14)
  - `marcojr13/triplanner-kafka`
  - `marcojr13/triplanner-email`
- Published tags: `latest` (current `main`), `1.2`, `1.2.2`, `sha-3e15bed`
  and `sha-4e009c3` (plus the older release tags).
- Architectures: `linux/amd64`, `linux/arm64`.
- Verification: the service workflows passed on `main` and tag `v1.2.2` (8/8);
  the published `1.2.2` stack passed the smoke test with 0 critical container
  CVEs.

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

## Repository metadata

The GitHub About description and topics are applied with a one-time script:

```powershell
$env:GITHUB_TOKEN = "github_pat_..."
powershell -File scripts/set-repo-metadata.ps1
```

The token needs repository administration permission. The script sets the
description to the same text used in the README and adds the project topics
(`nextjs`, `bun`, `graphql`, `fastapi`, `postgresql`, `mongodb`, `docker-compose`
and related tags).

## Image tags

| Event | Tags |
|---|---|
| Push to `main` | `latest`, `sha-<short>` |
| Tag `v1.2.3` | `1.2.3`, `1.2`, `sha-<short>` |
| Pull request / feature branch | tests only |

All published images are multi-arch: `linux/amd64` and `linux/arm64`.

## Run the published images

```bash
docker compose -f deploy/docker-compose.hub.yml up -d
```

The file defaults to `DOCKERHUB_USERNAME=marcojr13` and `IMAGE_TAG=latest`.
Override them for a fork or a pinned version:

```bash
DOCKERHUB_USERNAME=youruser IMAGE_TAG=1.2.2 \
  docker compose -f deploy/docker-compose.hub.yml up -d
```

Open http://localhost:3000/login.

Useful overrides (root `.env` or shell):

```bash
WEB_PORT=3000
POSTGRES_PORT=5432
MONGO_PORT=27017
LLM_PROVIDER=none
DOCKERHUB_USERNAME=marcojr13
IMAGE_TAG=1.2.2
```

The API container runs migrations and the idempotent seed on every start, so a
fresh volume is ready in one command.

> Container names are fixed (`local_triplanner-*`). Stop the source-build stack
> (`docker compose -f deploy/docker-compose.yml down`) before starting the Docker Hub stack.

## Release flow

```bash
# after the changes are on main
git tag -a v1.2.2 -m "Triplanner local demo v1.2.2"
git push origin v1.2.2
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
