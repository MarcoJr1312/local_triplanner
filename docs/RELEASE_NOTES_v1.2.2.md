# Triplanner Local Recruiter Demo — v1.2.2

**Date:** 2026-11-14
**Branch:** `feature/local-runner`
**Tag:** `v1.2.2`

Security patch release after a full repository scan.

## Fixed

- **Next.js** upgraded from `15.5.27` to `15.5.29`, fixing the critical
  Image Optimization RCE advisory and the App Router resource-exhaustion
  advisory.
- **PostCSS** upgraded to `8.5.33` with a package override so Next.js no longer
  pulls the vulnerable nested `8.4.31`.
- **opentelemetry-api** `1.45.2` and **certifi** `2026.10.23` fix the Python
  dependency advisories reported by `pip-audit`.
- Docker builds now apply OS security upgrades (`apk upgrade` /
  `apt-get upgrade`), picking up `zlib 1.4-r0` on Alpine and the patched
  `zlib1g` on Debian.
- The web runtime image no longer ships npm/corepack, removing their bundled
  npm dependency CVEs.
- SHA-1 uses in the agent are documented as non-cryptographic with
  `usedforsecurity=False`; behavior is unchanged to avoid reindexing existing
  vectors.

## Security scan results

- `gitleaks`: 1 historical finding, the old Firebase **web** API key. It is a
  public client identifier by design, not in `HEAD`, and still needs to be
  restricted or revoked in Google Cloud project `551503664846`.
- `bun audit`: clean for web and API.
- `pip-audit`: clean for the agent.
- Semgrep: 0 code findings; 26 warnings for GitHub Actions referenced by
  mutable tags.
- Docker Scout critical/high after the rebuild:
  - web: **0 critical / 1 high**
  - API: **0 critical / 1 high**
  - agent: **0 critical / 6 high**
- Remaining highs are unfixed base-image `musl`/`zlib` CVEs, not application
  vulnerabilities.

See `docs/SECURITY.md` for the full report and accepted risks.

## Verification

- API typecheck + 59/59 tests.
- Frontend typecheck + 16/16 tests + production build.
- Agent 11/11 (M2) + 7/7 (runtime settings).
- Compose smoke on the rebuilt stack: pass.
- GitHub Actions: 8/8 runs success (4 on `main` + 4 on tag `v1.2.2`).
- Docker Hub images published for web, api and agent with tags `latest`,
  `1.2`, `1.2.2` and `sha-3e15bed`; `linux/amd64` + `linux/arm64`.
- The published `1.2.2` stack passed `scripts/smoke.ps1`; Docker Scout reports
  0 critical CVEs on all three images.

## Upgrade

```bash
IMAGE_TAG=1.2.2 docker compose -f docker-compose.hub.yml up -d
```

Existing data volumes and the in-app LLM configuration are compatible.
