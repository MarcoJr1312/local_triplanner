#!/usr/bin/env bash
# Update one service image tag in the Helm values after a successful publish.
# Called by .github/workflows/gitops-image-tags.yml on the main branch.
#
#   scripts/ci-update-image-tag.sh web sha-1234567
set -euo pipefail

SERVICE="${1:?usage: ci-update-image-tag.sh <service> <tag>}"
IMAGE_TAG="${2:?usage: ci-update-image-tag.sh <service> <tag>}"
VALUES="helm/helm-triplanner/values.yaml"

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

docker run --rm -v "$PWD:/work" -w /work mikefarah/yq:4.45.1 \
  -i ".images.${SERVICE}.tag = \"${IMAGE_TAG}\"" "$VALUES"

if git diff --quiet -- "$VALUES"; then
  echo "${SERVICE} is already at ${IMAGE_TAG}; nothing to commit."
  exit 0
fi

git add "$VALUES"
git commit -m "chore(gitops): update ${SERVICE} image to ${IMAGE_TAG} [skip ci]"

# Another service workflow may have committed in parallel; serialize and retry.
for attempt in 1 2 3; do
  git pull --rebase origin main
  if git push origin HEAD:main; then
    echo "Updated ${SERVICE} to ${IMAGE_TAG}."
    exit 0
  fi
  echo "Push attempt ${attempt} failed; retrying..."
  sleep 5
done

echo "Could not push the ${SERVICE} image tag after 3 attempts." >&2
exit 1
