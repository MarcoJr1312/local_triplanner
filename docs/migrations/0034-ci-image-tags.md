# 0034 — CI image-tag GitOps update

| Field | Value |
|---|---|
| Status | **Implemented on `refactor/helm`; first real run pending PR #1 merge** |
| Cycle | Kubernetes Manifest Delivery |
| Slice | M29 — CI publishes SHA tags and updates chart values |
| Workflow | `.github/workflows/gitops-image-tags.yml` |
| Script | `scripts/ci-update-image-tag.sh` |
| Values target | `helm/helm-triplanner/values.yaml` |
| Argo CD | still on `refactor/helm` until PR #1 is merged |

## 1. Merge status

PR **#1** (`refactor/helm` → `main`) is **open, not merged** at the time of
this slice. `main` is at `134ef7c`; `refactor/helm` is 150 commits ahead.

The Argo CD Application therefore still tracks:

```yaml
targetRevision: refactor/helm
```

Switching it to `HEAD` now would deploy the old `main` chart. The switch
happens only after the PR is merged.

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

After PR #1 is merged:

1. Confirm the six workflows pushed `sha-<merge>` images to Docker Hub.
2. Confirm `GitOps image tags` updated `helm/helm-triplanner/values.yaml`.
3. Remove the six service image overrides from
   `deploy/kind/triplanner-values.yaml`; keep `broker`/`email` local until they
   have publish workflows.
4. Change `targetRevision` in `deploy/argocd/application.yaml` to `HEAD`.
5. Commit and push; Argo CD pulls the published SHA images from Docker Hub.

The current app stays healthy on `refactor/helm` + local `sha-5247619` images
until these steps.

## 4. Verification performed

```text
actionlint .github/workflows/gitops-image-tags.yml  -> 0 errors
yq 4.45.1 simulation: images.web.tag -> "sha-test123" (temp file only)
bash -n scripts/ci-update-image-tag.sh              -> syntax OK
```

Not yet performed: a real `workflow_run` update on `main`, because PR #1 is
open and the workflow file must be on the default branch for `workflow_run` to
fire.

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
