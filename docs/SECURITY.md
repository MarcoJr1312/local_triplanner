# Security notes — local_triplanner

## Scope

This is a **local-only recruiter demo**, not a multi-tenant production service.
The threat model assumes the user runs it on their own machine with Docker
Desktop.

## Controls in place

- No Firebase or AWS runtime dependencies. HasData is an optional BYOK
  provider: the default is the committed Toronto catalogue; a recruiter key is
  stored on the locations PVC and cached results expire after 5 days. Email
  delivery is optional: the recruiter supplies a Resend key (BYOK) at runtime;
  the demo runs with `EMAIL_PROVIDER=sink` and no provider key.
- Demo authentication via `x-user-id`; the API and agent ports are not
  published, and only the web service is exposed.
- PostgreSQL and MongoDB are bound to `127.0.0.1`, not `0.0.0.0`.
- MongoDB authentication is enabled. The demo root credentials are rendered
  into a Kubernetes Secret from `values.yaml`; the locations service reads them
  through `secretKeyRef`. In production use `mongo.auth.existingSecret`
  (HashiCorp Vault, External Secrets, Sealed Secrets) and never commit real
  credentials.
- Membership checks on every trip read and mutation.
- Attachment URLs are HMAC-SHA256 signed, expire after 15 minutes, and are
  compared in constant time.
- Uploads are MIME/size validated; avatars and attachments are served through
  the same-origin web proxy.
- Containers run as non-root users and have healthchecks.
- JavaScript and Python dependencies are installed from frozen lockfiles.
- `.env` files, local uploads, the agent settings volume and the locations
  settings volume are gitignored.
- The LLM token is stored only in the agent volume, the Resend key only on the
  email PVC, and the HasData key only on the locations PVC; none is returned to
  the browser.

## Pre-push review — 2026-11-26

Scope: branch `refactor/helm` (221 commits) before its first push. Verdict:
**GO**. No new real credential is introduced by the branch.

- `gitleaks` over the full history: 2 hits, 1 false positive.
- `trufflehog` over all refs: 12 unverified, **0 verified**; all are demo
  database credentials or the historical Firebase web key.
- No `.env`, `*.pem`, `*.key`, `id_rsa`, kubeconfig or private key was ever
  committed.
- **Real finding:** the Firebase web API key in `local/.env.example`
  (`bee7caf`, removed in `d901d9b`). It is already public on `origin/main`;
  restrict or rotate it in Google Cloud. It does not require a history rewrite
  for this push because the exposure predates the branch.
- **Demo-only:** the committed PostgreSQL/MongoDB demo passwords,
  `dev-internal-token` and `dev-attachment-secret` are intentional local
  defaults. They are not production secrets.
- **Test fixtures:** `postgres://u:p@db:5432`, `trips|users|triplanner` and
  `test-key` are test-only values.
- **Placeholders:** Resend/HasData/LLM keys in `.env.example` and migration docs
  are empty or examples.
- `backend/.env.fetch` is untracked (a live-looking HasData key) and is not in
  any commit; keep it ignored.
- `AGENTS.md`, `.opencode/` and `.orkai.yaml` are now local-only and gitignored.
  `.opencode/` history contains no secrets.

Not covered: online verification of the Firebase key (deliberately not sent to
Google), merge commits skipped by gitleaks, and binary blobs. `AGENTS.md` is
already public on `origin/main` from earlier history.

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
- **Local development credentials:** `triplanner/triplanner` (Compose),
  `triplanner/triplanner-demo` (Helm), `dev-internal-token` and
  `dev-attachment-secret` are defaults for a local demo. Override them in
  `.env` / `values.yaml` before exposing the stack to a network. The Helm demo
  Mongo password is intentionally in Git; treat it as a demo-only value.
- **Secret base64 is not encryption:** the Mongo Secret uses `data` with
  base64-encoded values for Kubernetes compatibility. Enable encryption at rest
  and use Vault/External Secrets outside the demo.
- **Base-image CVEs without an upstream fix:** rebuild regularly and update the
  base images when patches land.
- **Mutable GitHub Action tags:** pin to SHAs if the repository becomes a
  higher-value target.
- **Old Firebase web key in git history:** removing it from `HEAD` does not
  remove it from history; restrict/revoke it in Google Cloud.

## Reporting

This is a demo repository. Open a GitHub issue for suspected vulnerabilities;
do not include live credentials in the report.
