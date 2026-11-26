#!/usr/bin/env bash
# Installs the prometheus-community PostgreSQL and MongoDB exporters.
# Run scripts/bootstrap-exporters.sh first so the Secrets and DB users exist.
#
#   bash scripts/deploy-exporters.sh

set -euo pipefail

CONTEXT="${CONTEXT:-kind-triplanner-cilium}"
NAMESPACE="${NAMESPACE:-triplanner}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

REPO="prometheus-community"
if ! helm repo list 2>/dev/null | awk '{print $1}' | grep -qx "$REPO"; then
  helm repo add "$REPO" https://prometheus-community.github.io/helm-charts >/dev/null
  helm repo update >/dev/null
fi

deploy() {
  local name="$1"
  local chart="$2"
  local version="$3"
  local values="$4"
  echo "Deploying ${name}..."
  helm upgrade --install "$name" "$REPO/$chart" \
    --version "$version" \
    --kube-context "$CONTEXT" \
    --namespace "$NAMESPACE" \
    --values "$ROOT/$values" \
    --wait \
    --timeout 5m >/dev/null
}

deploy triplanner-postgres-users prometheus-postgres-exporter 8.3.0 deploy/exporters/postgres-users.yaml
deploy triplanner-postgres-trips prometheus-postgres-exporter 8.3.0 deploy/exporters/postgres-trips.yaml
deploy triplanner-postgres-api prometheus-postgres-exporter 8.3.0 deploy/exporters/postgres-api.yaml
deploy triplanner-postgres-agent prometheus-postgres-exporter 8.3.0 deploy/exporters/postgres-agent.yaml
deploy triplanner-mongodb prometheus-mongodb-exporter 3.23.2 deploy/exporters/mongodb.yaml

echo
kubectl --context "$CONTEXT" -n "$NAMESPACE" get pods \
  | grep -E 'triplanner-postgres|triplanner-mongodb' || true
kubectl --context "$CONTEXT" -n "$NAMESPACE" get servicemonitors \
  | grep -E 'triplanner-postgres|triplanner-mongodb' || true
echo 'Exporter releases deployed.'
