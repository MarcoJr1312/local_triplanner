# 0034 — CI image-tag GitOps update

| Field | Value |
|---|---|
| Status | **Implemented; PR #1 merged; image cutover ready; first `workflow_run` still unobserved** |
| Cycle | Kubernetes Manifest Delivery |
| Slice | M29 — CI publishes SHA tags and updates chart values |
| Workflow | `.github/workflows/gitops-image-tags.yml` |
| Script | `scripts/ci-update-image-tag.sh` |
| Values target | `helm/helm-triplanner/values.yaml` |
| Argo CD | **`HEAD` (main)** since 2026-11-26; local image overlay until cutover |

## 1. Merge status

PR **#1** (`refactor/helm` → `main`) was merged at `e377c12`. The Argo CD
Application now tracks:

```yaml
targetRevision: HEAD
```

`main` contains the chart and the GitOps workflow. The cutover branch now uses
the chart defaults for the six published services (`sha-e377c12`) and keeps
only broker/email local (`sha-5247619`).

GitHub did not create a `GitOps image tags` run for the merge workflows. A
`workflow_dispatch` fallback was added; the first image cutover is pinned
manually so it does not block.

## 2. Pipeline design

The six service publish workflows already push `sha-<short>` tags:

- Web
- API
- Users service
- Trips service
- Locations service
- Agent

A new `workflow_run` workflow listens for their successful completion on
`main`:

```text
service workflow (main)
  -> tests
  -> docker build/push: sha-<short>, latest, semver
  -> workflow_run: GitOps image tags
       -> map workflow name to chart image key
       -> yq set images.<service>.tag = sha-<short>
       -> commit "chore(gitops): ... [skip ci]"
       -> push to main
       -> Argo CD syncs HEAD
```

Properties:

- `permissions: contents: write` on the tag-update workflow only.
- `concurrency: gitops-image-tags` serializes updates from different services.
- `git pull --rebase` + three push attempts handle parallel merges.
- `[skip ci]` prevents the values-only commit from re-triggering the service
  workflows.
- The chart defaults are updated, not the local kind image overrides.
- The image SHA is `sha-${head_sha::7}`, matching `docker/metadata-action`’s
  `type=sha,prefix=sha-` output.

## 3. Post-merge cutover

PR #1 is merged and Argo CD tracks `HEAD`. The cutover branch performs:

1. Chart defaults for six services set to `sha-e377c12`.
2. Six local image overrides removed from `deploy/kind/triplanner-values.yaml`;
   broker/email stay local.
3. `deploy/kind/triplanner-local-images.yaml` preserves full local source builds.
4. `workflow_dispatch` fallback added to the tag workflow.

After the cutover branch merges, Argo CD pulls the published SHA images from
Docker Hub.

## 4. Verification performed

```text
actionlint .github/workflows/gitops-image-tags.yml  -> 0 errors
yq 4.45.1 simulation: images.web.tag -> "sha-test123" (temp file only)
bash -n scripts/ci-update-image-tag.sh              -> syntax OK
```

Not yet performed: a real `workflow_run` update on `main`; GitHub created no
`GitOps image tags` runs for the merge workflows. A `workflow_dispatch`
fallback is now available. All six `sha-e377c12` images are present on Docker
Hub, including Web.

## 5. Risks

| Risk | Mitigation |
|---|---|
| Workflow cannot run before merge | Documented; first run after PR #1 merge |
| `GITHUB_TOKEN` cannot push to protected `main` | Allow GitHub Actions to push or use a bot token with branch-protection bypass |
| Six services update the same file | Shared concurrency group + rebase/retry |
| `broker`/`email` have no publish workflows | Keep their local kind overrides until workflows exist |
| CI image tag and chart revision diverge | Image SHA is the build commit; chart revision is the latest main commit |
| Docker Hub image pull fails on kind | Egress/NAT fix is in setup/deploy scripts; images are public |
| Values-only commit loops CI | `[skip ci]` + path filters |

## 6. Rollback

Revert the workflow/script commit. The prior chart values remain on main; Argo
CD continues to track `HEAD` after the cutover. If a bad SHA is published,
revert the values commit that points to it; Argo CD self-heals the previous
image.

## 7. Gate

This slice is implemented but not yet exercised on `main`. Gate 2 should wait
for PR #1 to merge and the first real image-tag commit to be observed.
