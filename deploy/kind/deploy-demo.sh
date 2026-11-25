#!/usr/bin/env bash
# Deploys the Triplanner chart to the isolated Cilium kind cluster.
# Prerequisites: the cluster from setup-cilium.sh and the local images built
# with:
#   docker compose -f deploy/docker-compose.yml build

set -euo pipefail

CLUSTER="${CLUSTER:-triplanner-cilium}"
RELEASE="${RELEASE:-triplanner}"
NAMESPACE="${NAMESPACE:-triplanner}"
IMAGE_TAG="${IMAGE_TAG:-kind-0.19.0}"

images=(
  "local_triplanner-kafka:latest|triplanner-local/kafka:$IMAGE_TAG"
  "local_triplanner-email:latest|triplanner-local/email:$IMAGE_TAG"
  "local_triplanner-locations:latest|triplanner-local/locations:$IMAGE_TAG"
  "local_triplanner-trips:latest|triplanner-local/trips:$IMAGE_TAG"
  "local_triplanner-users:latest|triplanner-local/users:$IMAGE_TAG"
  "local_triplanner-agent:latest|triplanner-local/agent:$IMAGE_TAG"
  "local_triplanner-api:latest|triplanner-local/api:$IMAGE_TAG"
  "local_triplanner-web:latest|triplanner-local/web:$IMAGE_TAG"
)

load=()
for pair in "${images[@]}"; do
  source_image="${pair%%|*}"
  target_image="${pair##*|}"
  docker image inspect "$source_image" >/dev/null 2>&1 || {
    echo "Missing local image $source_image. Build it first." >&2
    exit 1
  }
  docker tag "$source_image" "$target_image"
  load+=("$target_image")
done

echo "Loading application images into kind..."
kind load docker-image --name "$CLUSTER" "${load[@]}"

kubectl config use-context "kind-$CLUSTER" >/dev/null
kubectl create namespace "$NAMESPACE" >/dev/null 2>&1 || true

if ! kubectl -n "$NAMESPACE" get secret triplanner-internal >/dev/null 2>&1; then
  token="$(openssl rand -hex 32 2>/dev/null || tr -dc 'a-f0-9' </dev/urandom | head -c 64)"
  kubectl -n "$NAMESPACE" create secret generic triplanner-internal \
    --from-literal=INTERNAL_TOKEN="$token" >/dev/null
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
helm upgrade --install "$RELEASE" "$HERE/../../helm/helm-triplanner" \
  --kube-context "kind-$CLUSTER" \
  --namespace "$NAMESPACE" \
  --values "$HERE/triplanner-values.yaml" \
  --wait \
  --timeout 15m

kubectl -n "$NAMESPACE" get gateway,httproute
echo
echo "Triplanner is ready at http://triplanner.localhost:9080"
echo "Sign in with demo / demo123."
