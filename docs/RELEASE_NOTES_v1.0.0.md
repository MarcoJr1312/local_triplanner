# Triplanner Local Recruiter Demo — v1.0.0

**Date:** 2026-11-14
**Branch:** `feature/local-runner`
**Tag:** `v1.0.0`

## What is included

- One-command Docker Compose stack: `web`, `api`, `agent`, `postgres`, `mongo`.
- Demo auth with two seeded identities (`demo-user`, `demo-friend`).
- 186 real Toronto places in MongoDB, with 80 local images.
- Seeded three-day Toronto trip (Dec 4–6, 2026) with sight, food, activity and
  nightlife.
- Copyable invitation links; no email provider.
- Deterministic AI demo mode plus optional DeepSeek/OpenAI/Anthropic/Ollama.
- Local uploads, Postgres relational data and pgvector embeddings.
- Smoke scripts for PowerShell and bash; GitHub Actions CI.

## Quickstart

```bash
docker compose up --build
```

Open http://localhost:3000/login and choose **Demo (owner)**.

Reset:

```bash
docker compose down -v
docker compose up -d
```

## Verification

| Check | Result |
|---|---|
| Server tests | 59 pass / 0 fail |
| Frontend tests | 16 pass / 0 fail |
| Agent tests | 11 / 11 |
| Typechecks | clean |
| Compose services | 5 healthy |
| MongoDB catalogue | 187 documents (1 destination + 186 places) |
| Demo trip | 9 items across 3 days |
| Web login | 200 |
| GraphQL proxy | profile + real place search |
| Seed image proxy | 200, `image/jpeg` |
| Agent config | `{provider:"none", demo:true}` |
| Demo suggestions | 200, `mode:"demo"` |
| Demo day plan | 200, parsed plan |
| Clean clone (Windows 11 + Docker Desktop) | 63.4s warm build+start; smoke pass |
| Restart persistence | pass |
| `docker compose down -v` reset | pass |

## Known limitations

- **No email delivery.** Invitations use a copyable link; reminders are disabled.
- **Demo auth only.** This is not a production identity setup.
- **macOS clean-clone QA is pending.** The Compose file and base images are
  multi-arch; a macOS checklist is in `docs/QA_MATRIX.md`.
- **No GitHub remote or published images yet.** The tag is local until the
  repository remote is configured.
- **AI is deterministic by default.** Set `LLM_PROVIDER` and a key to use a real
  model.

## Commits

- `94c15f6` baseline
- `d901d9b` Firebase removal + demo identities
- `0d042e9` Resend removal + invite links
- `c3657ad` HasData runtime removal
- `5e1c23d` AWS removal + MongoDB catalogue
- `5d9c68a` Toronto ingestion tool
- `793e4dd` `local/` → `backend/`
- `d8211de` Toronto dataset
- `82fef90` demo dates/docs
- `0ed1fa0` full Compose stack
- `a283eff` LLM providers + demo AI
- `2e12ae7` tour, troubleshooting, smoke, CI
