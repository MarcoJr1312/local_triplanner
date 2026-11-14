# Security notes — local_triplanner

## Scope

This is a **local-only recruiter demo**, not a multi-tenant production service.
The threat model assumes the user runs it on their own machine with Docker
Desktop.

## Controls in place

- No Firebase, HasData, Resend or AWS runtime dependencies.
- Demo authentication via `x-user-id`; the API and agent ports are not
  published, and only the web service is exposed.
- PostgreSQL and MongoDB are bound to `127.0.0.1`, not `0.0.0.0`.
- Membership checks on every trip read and mutation.
- Attachment URLs are HMAC-SHA256 signed, expire after 15 minutes, and are
  compared in constant time.
- Uploads are MIME/size validated; avatars and attachments are served through
  the same-origin web proxy.
- Containers run as non-root users and have healthchecks.
- JavaScript and Python dependencies are installed from frozen lockfiles.
- `.env` files, local uploads and the agent settings volume are gitignored.
- The LLM token is stored only in the agent volume and is never returned to the
  browser.

## Scan results — 2026-11-14

### Secrets

- `gitleaks` over the full history at scan time (69 commits): **1 finding**, the old
  `FIREBASE_WEB_API_KEY` in `local/.env.example` (commit `bee7caf`).
- It is a Firebase **web** key, a public client identifier by design, and was
  removed with Firebase in `d901d9b`.
- It is still active and should be restricted or revoked in Google Cloud
  project `551503664846`. The GitHub alert should then be dismissed as
  “False positive” (restricted client key) or “Revoked” (deleted key).

### Dependencies

- `bun audit` (web): **clean** after Next.js `15.5.29` and PostCSS `8.5.33`.
- `bun audit` (API): **clean**.
- `pip-audit` (agent): **clean** after `opentelemetry-api 1.45.2` and
  `certifi 2026.10.23`.
- The audits run in `web.yml`, `api.yml` and `agent.yml`; an advisory fails the
  workflow before tests or publishing.
- `uv sync --frozen` and `bun install --frozen-lockfile` are used in images.

### Static analysis

- Semgrep (`p/security-audit`, `p/secrets`, `p/owasp-top-ten`): **0 code
  findings**.
- 26 warnings for GitHub Actions referenced by mutable tag. The workflows use
  `contents: read`, never `pull_request_target`, and pass Docker Hub secrets
  only to publish jobs. Pinning actions to full commit SHAs would remove the
  warnings.

### Containers

Docker Scout, critical/high only, after the security rebuild:

| Image | Critical | High | Notes |
|---|---:|---:|---|
| `triplanner-web` | 0 | 1 | `musl` in the Alpine base; no fixed package in the repo |
| `triplanner-api` | 0 | 1 | `musl` in the Alpine base; no fixed package in the repo |
| `triplanner-agent` | 0 | 6 | Debian `zlib1g`; no fixed package at scan time |

The web runtime image no longer ships npm/corepack, which removed its bundled
npm dependency CVEs. Base images are upgraded during the Docker build
(`apk upgrade`, `apt-get upgrade`) to pick up zlib and OS security patches.

### Compose smoke

`scripts/smoke.ps1` passes against the rebuilt source stack and the published
release stack.

## Accepted risks

- **Demo auth:** `x-user-id` is intentionally not a production identity system.
- **Local development credentials:** `triplanner/triplanner`,
  `dev-internal-token` and `dev-attachment-secret` are defaults for a local
  demo. Override them in `.env` before exposing the stack to a network.
- **Base-image CVEs without an upstream fix:** rebuild regularly and update the
  base images when patches land.
- **Mutable GitHub Action tags:** pin to SHAs if the repository becomes a
  higher-value target.
- **Old Firebase web key in git history:** removing it from `HEAD` does not
  remove it from history; restrict/revoke it in Google Cloud.

## Reporting

This is a demo repository. Open a GitHub issue for suspected vulnerabilities;
do not include live credentials in the report.
