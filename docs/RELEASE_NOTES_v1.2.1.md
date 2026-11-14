# Triplanner Local Recruiter Demo — v1.2.1

**Date:** 2026-11-14
**Branch:** `feature/local-runner`
**Tag:** `v1.2.1`

Patch release for the in-app LLM provider settings introduced in v1.2.0.

## Fixed

- Editing the model or base URL for a provider configured through environment
  variables no longer asks for the token again. The environment key remains the
  fallback and is not copied into the agent volume.
- Ollama selected from the app now defaults to
  `http://host.docker.internal:11434/v1`, which works inside Docker on Windows,
  macOS and Linux without editing the base URL field.

## Added

- Regression test for editing an env-configured provider without duplicating
  the key. The runtime-settings suite is now 7/7.

## Verification in this release

- API typecheck + 59/59 tests.
- Frontend typecheck + 16/16 tests.
- Agent 11/11 (M2) + 7/7 (runtime settings).
- Compose smoke on the published `1.2.1` stack: pass.
- Manual check: save Ollama without a base URL and confirm the effective model
  URL is `http://host.docker.internal:11434/v1`; restore demo mode.
- GitHub Actions: 6/6 runs success (2 on `main` + 4 on tag `v1.2.1`).
- Docker Hub images published for web, api and agent with tags `latest`,
  `1.2`, `1.2.1` and `sha-b8a861b`; `linux/amd64` + `linux/arm64`.
- The `1.2.1` stack was pulled from Docker Hub and passed `scripts/smoke.ps1`.

## Upgrade

```bash
IMAGE_TAG=1.2.1 docker compose -f docker-compose.hub.yml up -d
```

Existing v1.2.0 data and the `agentdata` volume are compatible. The in-app
provider configuration survives the upgrade.
