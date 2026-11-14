# QA matrix — local recruiter demo

## Automated and executed

| Area | Command | Result |
|---|---|---|
| Server typecheck | `cd backend/server && bunx tsc --noEmit` | pass |
| Server tests | `cd backend/server && bun test` | 59/59 |
| Frontend typecheck | `cd frontend-next && bunx tsc --noEmit` | pass |
| Frontend tests | `cd frontend-next && bun test` | 16/16 |
| Agent tests | `cd backend/agent-service && uv run python tests/test_m2.py` | 11/11 |
| Compose smoke (PowerShell) | `powershell -File scripts/smoke.ps1` | pass |
| Compose smoke (bash) | `bash scripts/smoke.sh` | pass |
| Restart persistence | `docker compose down && docker compose up -d` | pass |
| Clean reset | `docker compose down -v && docker compose up -d` | pass |
| Clean clone, Windows 11 + Docker Desktop | clone → `docker compose up -d --build` → smoke | pass, 63.4s warm build+start |

## Platform status

| Platform | Status | Notes |
|---|---|---|
| Windows 11 + Docker Desktop | **PASS** | Clean clone and full smoke executed. |
| Linux | **CI configured** | `.github/workflows/ci.yml` runs tests + Compose smoke on `ubuntu-latest`. |
| macOS (Intel/Apple Silicon) | **PENDING** | Docker Desktop + multi-arch images; use the checklist below. |

## macOS checklist

1. Install Docker Desktop and allocate at least 4 GB RAM.
2. Clone the repo and run `docker compose up -d --build`.
3. Confirm all five services are `healthy` with `docker compose ps`.
4. Open http://localhost:3000/login and enter as **Demo (owner)**.
5. Search for `CN Tower`; confirm real places and images.
6. Invite **Demo Friend** and open the copied link in an incognito window.
7. Open the AI panel; confirm the **AI demo mode** badge and auto-suggest.
8. Run `bash scripts/smoke.sh`.
9. Run `docker compose down -v` and repeat the boot once.

Record the result in this file when a Mac is available.

## Known non-blocking gaps

- macOS clean-clone result is TBD.
- GitHub remote/push and a public release URL are TBD.
- No email provider (intentional).
- AI demo mode is the default; real providers are opt-in.
