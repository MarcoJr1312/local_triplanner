# Triplanner Local Recruiter Demo — v1.1.0

**Date:** 2026-11-14
**Branch:** `feature/local-runner`
**Tag:** `v1.1.0`

This release is the CI/CD and Docker Hub upgrade. The application runtime is
unchanged from v1.0.0.

## Added

- Per-service GitHub Actions workflows:
  - `web.yml` → frontend tests + `triplanner-web`.
  - `api.yml` → API tests (Postgres + MongoDB) + `triplanner-api`.
  - `agent.yml` → agent tests (Postgres + pgvector) + `triplanner-agent`.
  - `compose-smoke.yml` → full Compose boot + `scripts/smoke.sh`.
- Multi-arch Docker Hub publishing (`linux/amd64` + `linux/arm64`).
- `docker-compose.hub.yml` for running the published images.
- `docs/CICD.md` with workflow, secret and release instructions.

## Required GitHub secrets

| Secret | Value |
|---|---|
| `DOCKERHUB_USERNAME` | Docker Hub username |
| `DOCKERHUB_TOKEN` | Docker Hub access token with Read & Write |

Images:

```
<DOCKERHUB_USERNAME>/triplanner-web
<DOCKERHUB_USERNAME>/triplanner-api
<DOCKERHUB_USERNAME>/triplanner-agent
```

## Tag strategy

- Push to `main`: `latest` + `sha-<short>`.
- Tag `v1.1.0`: `1.1.0`, `1.1`, `sha-<short>`.
- Pull requests and feature branches: tests only.

## Run from Docker Hub

```bash
DOCKERHUB_USERNAME=youruser IMAGE_TAG=latest \
  docker compose -f docker-compose.hub.yml up -d
```

## Verification in this release

- `actionlint` clean on all four workflows.
- Workflow YAML parsed.
- Source and Docker Hub Compose files validate.
- Service tests: 59 API, 16 web, 11 agent.
- Full Compose smoke passes.
- Docker Hub publishing is configured but not executed from this machine: the
  GitHub remote and Docker Hub secrets are still TBD.

## Next

1. Configure the GitHub remote.
2. Add `DOCKERHUB_USERNAME` + `DOCKERHUB_TOKEN`.
3. Push `main` and tag `v1.1.0`.
4. Confirm the three images on Docker Hub.
