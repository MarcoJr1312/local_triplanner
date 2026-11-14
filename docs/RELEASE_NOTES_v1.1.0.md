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
DOCKERHUB_USERNAME=marcojr13 IMAGE_TAG=1.1.0 \
  docker compose -f docker-compose.hub.yml up -d
```

## Verification in this release

- `actionlint` clean on all four workflows.
- Workflow YAML parsed.
- Source and Docker Hub Compose files validate.
- Service tests: 59 API, 16 web, 11 agent.
- Full Compose smoke passes.
- GitHub Actions: **8/8 runs success** on `main` and tag `v1.1.0`.
- Docker Hub images published:
  - `marcojr13/triplanner-web`
  - `marcojr13/triplanner-api`
  - `marcojr13/triplanner-agent`
- Tags: `latest`, `1.1`, `1.1.0`, `sha-e335779`; multi-arch `amd64` + `arm64`.
- The published stack was pulled from Docker Hub and passed `scripts/smoke.ps1`.

## Next

1. Run the macOS clean-clone checklist.
2. Share `https://github.com/MarcoJr1312/local_triplanner`.
3. Optional: enable branch protection for `main`.
