# Triplanner Local Recruiter Demo — v1.2.0

**Date:** 2026-11-14
**Branch:** `feature/local-runner`
**Tag:** `v1.2.0`

This release focuses on the recruiter-facing UI and removes the last reason to
edit environment files for a provider key: the LLM can now be configured from
the app.

## Fixed

- The bell icon in the left rail no longer behaves as logout. It opens a
  notifications panel; **Sign out** stays in the profile menu.
- English is now the default UI language. Spanish is still available from
  **Profile → Language**.
- The three read-only interest chips use the brand color and remain readable in
  light and dark themes.

## Added

- Clicking a search result opens a detail modal with the same information as the
  trip dashboard: image, address with copy action, rating, phone, opening hours,
  cost, duration, description, tags, website, social links and Google Maps.
- **Profile / Settings → AI provider** lets the recruiter choose `none`
  (deterministic demo), DeepSeek, OpenAI, Anthropic or Ollama, and enter the API
  token, model and optional base URL.
- The provider override is persisted in the agent volume at
  `/app/.data/llm.json` and applies to new AI requests without a restart. The
  token is never returned to the browser.
- `getLlmSettings` / `updateLlmSettings` GraphQL operations and a protected
  agent `POST /api/agent/config` endpoint.
- Agent runtime-settings tests (`tests/test_settings.py`, 6 cases).
- Smoke scripts now verify the LLM settings query.

## Upgrade notes

- The locale storage key changed to `triplanner.locale.v2`, so browsers that
  used the old Spanish default start in English.
- Existing Docker volumes keep their saved user language. Change it once in
  **Profile → Language** if an old volume still shows Spanish.
- The new `agentdata` volume stores the provider override. `docker compose down
  -v` deletes it, along with the database.
- Environment values (`LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL`,
  `LLM_BASE_URL`) remain the fallback defaults. An in-app save takes precedence.

## Verification in this release

- API typecheck: pass.
- API tests: 59/59.
- Frontend typecheck: pass.
- Frontend tests: 16/16.
- Agent tests: 11/11 (M2) and 6/6 (runtime settings).
- Compose smoke on Windows: pass, including `getLlmSettings`.
- Manual provider flow:
  - save Ollama without a key;
  - restart the agent and confirm the provider persisted;
  - direct agent write without the internal token returns `401`;
  - a hosted provider without a key is rejected;
  - public responses expose `hasKey` but never the token;
  - restore demo mode clears the saved key.
- GitHub Actions and Docker Hub publishing: see the runs for this tag.

## Run from Docker Hub

```bash
docker compose -f docker-compose.hub.yml up -d
```

Defaults: `DOCKERHUB_USERNAME=marcojr13` and `IMAGE_TAG=latest`. Pin the version
with `IMAGE_TAG=1.2.0` when evaluating this release.

Open http://localhost:3000/login and enter as **Demo (owner)**.

## Next

1. Run the macOS clean-clone checklist from `docs/QA_MATRIX.md`.
2. Share `https://github.com/MarcoJr1312/local_triplanner`.
