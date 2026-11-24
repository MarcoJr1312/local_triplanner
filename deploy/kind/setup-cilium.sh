#!/usr/bin/env bash
# Creates the local Cilium kind cluster used by the Helm chart's Gateway API.
# The Docker Desktop Kubernetes cluster is intentionally left untouched.
#
# Prerequisites: Docker, kind, kubectl and helm.
# Usage: deploy/kind/setup-cilium.sh

set -euo pipefail

CLUSTER="${CLUSTER:-triplanner-cilium}"
GATEWAY_API_VERSION="${GATEWAY_API_VERSION:-v1.6.3}"
CILIUM_VERSION="${CILIUM_VERSION:-1.20.5}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

for tool in kind kubectl helm docker; do
  command -v "$tool" >/dev/null 2>&1 || { echo "$tool is required" >&2; exit 1; }
done

if ! kind get clusters 2>/dev/null | grep -qx "$CLUSTER"; then
  echo "Creating kind cluster $CLUSTER..."
  kind create cluster --config "$HERE/cilium-cluster.yaml"
fi

kubectl config use-context "kind-$CLUSTER" >/dev/null

echo "Installing Gateway API CRDs..."
kubectl apply --server-side -f "https://github.com/kubernetes-sigs/gateway-api/releases/download/$GATEWAY_API_VERSION/standard-install.yaml" >/dev/null

echo "Installing Cilium..."
helm repo add cilium https://helm.cilium.io/ >/dev/null 2>&1 || true
helm repo update >/dev/null

NODE="$CLUSTER-control-plane"
HOST_IP="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$NODE")"
[ -n "$HOST_IP" ] || { echo "Could not determine the IP of $NODE" >&2; exit 1; }

helm upgrade --install cilium cilium/cilium \
  --namespace kube-system \
  --version "$CILIUM_VERSION" \
  --values "$HERE/cilium-values.yaml" \
  --set "k8sServiceHost=$HOST_IP" \
  --set k8sServicePort=6443 \
  --wait \
  --timeout 10m

echo "Waiting for nodes..."
kubectl wait --for=condition=Ready nodes --all --timeout=300s >/dev/null

kubectl get gatewayclass
kubectl -n kube-system get pods -l k8s-app=cilium
echo
echo "Cluster ready. The Gateway web is reachable at http://triplanner.localhost:9080 after the chart is installed."
