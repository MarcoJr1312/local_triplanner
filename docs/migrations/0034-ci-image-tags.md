# 0034 — CI image-tag GitOps update

| Field | Value |
|---|---|
| Status | **Implemented; cutover complete; `workflow_dispatch` verified; automatic `workflow_run` still unobserved** |
| Cycle | Kubernetes Manifest Delivery |
| Slice | M29 — CI publishes SHA tags and updates chart values |
| Workflow | `.github/workflows/gitops-image-tags.yml` |
| Script | `scripts/ci-update-image-tag.sh` |
| Values target | `helm/helm-triplanner/values.yaml` |
| Argo CD | **`HEAD` (main)**; six published `sha-e377c12`, broker/email local |

## 1. Merge status

PR **#1** (`refactor/helm` → `main`) was merged at `e377c12`. The Argo CD
Application now tracks:

```yaml
targetRevision: HEAD
```

`main` contains the chart and the GitOps workflow. The cutover is merged: the
chart defaults for six services are `sha-e377c12` and only broker/email remain
local (`sha-5247619`).

GitHub did not create a `GitOps image tags` run for the merge workflows. The
`workflow_dispatch` fallback was verified manually; the first image cutover was
pinned in the cutover commit so it did not block.

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

PR #1 is merged and Argo CD tracks `HEAD`. The cutover commit:

1. Set chart defaults for six services to `sha-e377c12`.
2. Removed the six local image overrides from
   `deploy/kind/triplanner-values.yaml`; broker/email stay local.
3. Added `deploy/kind/triplanner-local-images.yaml` for full local source
   builds.
4. Added the `workflow_dispatch` fallback to the tag workflow.

Argo CD pulls the published SHA images from Docker Hub.

## 4. Verification performed

```text
actionlint .github/workflows/gitops-image-tags.yml  -> 0 errors
yq 4.45.1 simulation: images.web.tag -> "sha-test123" (temp file only)
bash -n scripts/ci-update-image-tag.sh              -> syntax OK
workflow_dispatch (api, sha-e377c12)                -> success
```

The dispatch ran as [run 45768988141](https://github.com/MarcoJr1312/local_triplanner/actions/runs/45768988141)
and found the tag already current, so it made no commit. The automatic
`workflow_run` path is still unobserved for a service push; the next push to
`main` should exercise it. All six `sha-e377c12` images are present on Docker
Hub, including Web.

## 5. Risks

| Risk | Mitigation |
|---|---|
| Automatic `workflow_run` not observed yet | Manual `workflow_dispatch` verified; next service push should trigger it |
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

The cutover is complete and `workflow_dispatch` is verified. Gate 2 should
include the first automatic service-push update when it occurs; until then the
manual fallback is available.
