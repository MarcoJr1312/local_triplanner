# QA matrix — local recruiter demo

## Automated and executed

| Area | Command | Result |
|---|---|---|
| Server typecheck | `cd backend/server && bunx tsc --noEmit` | pass |
| Server tests | `cd backend/server && bun test` | 59/59 |
| Frontend typecheck | `cd frontend-next && bunx tsc --noEmit` | pass |
| Frontend tests | `cd frontend-next && bun test` | 16/16 |
| Agent tests | `cd backend/agent-service && uv run python tests/test_m2.py` | 11/11 |
| Agent runtime settings tests | `cd backend/agent-service && uv run python tests/test_settings.py` | 7/7 |
| Compose smoke (PowerShell) | `powershell -File scripts/smoke.ps1` | pass (includes `getLlmSettings`) |
| Compose smoke (bash) | `bash scripts/smoke.sh` | pass on tag `v1.2.1` (CI) |
| In-app LLM settings | save Ollama, restart agent, public config, restore demo | pass |
| Env-configured provider edit | edit the model without re-entering the env key; key stays env-only | pass |
| Ollama default URL | save Ollama with a blank base URL; effective model uses `host.docker.internal` | pass |
| Search detail data | `searchLocations` returns description, address, rating, phone, website and image | pass |
| Default language | demo profiles `language=en`; i18n storage default `en` | pass |
| Secret scan (gitleaks) | full 69-commit history | 1 historical Firebase web key; none in `HEAD` |
| Frontend dependency audit | `cd frontend-next && bun audit` | clean |
| API dependency audit | `cd backend/server && bun audit` | clean |
| Agent dependency audit | `uvx pip-audit` on exported lockfile | clean |
| SAST (Semgrep) | `p/security-audit`, `p/secrets`, `p/owasp-top-ten` | 0 code findings; 26 mutable-action-tag warnings |
| Container scan (Docker Scout) | web / API / agent after rebuild | 0 critical; 1 / 1 / 6 high base-image CVEs |
| Restart persistence | `docker compose down && docker compose up -d` | pass |
| Clean reset | `docker compose down -v && docker compose up -d` | pass |
| Clean clone, Windows 11 + Docker Desktop | clone → `docker compose up -d --build` → smoke | pass, 63.4s warm build+start |
| GitHub Actions on `main` (`6176ac4`, v1.2.0) | web/api/agent/compose-smoke | 4/4 success |
| GitHub Actions on `main` (`b8a861b`, v1.2.1) | agent/compose-smoke | 2/2 success |
| GitHub Actions on tag `v1.2.1` | web/api/agent/compose-smoke | 4/4 success |
| Docker Hub publish | `marcojr13/triplanner-{web,api,agent}` | tags `latest`, `1.2`, `1.2.1`, `sha-b8a861b`; amd64 + arm64 |
| Published stack from Docker Hub | `IMAGE_TAG=1.2.1 docker compose -f docker-compose.hub.yml up -d` + smoke | pass |

## Platform status

| Platform | Status | Notes |
|---|---|---|
| Windows 11 + Docker Desktop | **PASS** | Clean clone and full smoke executed. |
| Linux | **PASS (Actions)** | Per-service workflows + Compose smoke on `ubuntu-latest`. |
| macOS (Intel/Apple Silicon) | **PENDING** | Docker Hub images are multi-arch; use the checklist below. |

## macOS checklist

1. Install Docker Desktop and allocate at least 4 GB RAM.
2. Clone the repo and run `docker compose up -d --build`.
3. Confirm all five services are `healthy` with `docker compose ps`.
4. Open http://localhost:3000/login and enter as **Demo (owner)**.
5. Search for `CN Tower`; click a result and confirm the detail modal shows
   address, rating, phone, hours, description and links.
6. Invite **Demo Friend** and open the copied link in an incognito window.
7. Open the AI panel; confirm the **AI demo mode** badge and auto-suggest.
8. Open **Profile → AI provider**; confirm the provider form is visible and the
   token field is empty.
9. Run `bash scripts/smoke.sh`.
10. Run `docker compose down -v` and repeat the boot once.

Record the result in this file when a Mac is available.

## Known non-blocking gaps

- macOS clean-clone result is TBD.
- No email provider (intentional).
- AI demo mode is the default; real providers are opt-in.
