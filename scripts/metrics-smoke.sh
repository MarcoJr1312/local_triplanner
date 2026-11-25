#!/usr/bin/env bash
# Prometheus metrics smoke check for the Compose and Helm demo stacks.
#
#   ./scripts/metrics-smoke.sh --target all
#   ./scripts/metrics-smoke.sh --target helm --context kind-triplanner-cilium

set -u

TARGET="all"
CONTEXT="kind-triplanner-cilium"
NAMESPACE="triplanner"
COMPOSE_FILE="deploy/docker-compose.yml"
GATEWAY_URL="http://127.0.0.1:9080"
FAILED=()

while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="${2:-}"; shift 2 ;;
    --context) CONTEXT="${2:-}"; shift 2 ;;
    --namespace) NAMESPACE="${2:-}"; shift 2 ;;
    --compose-file) COMPOSE_FILE="${2:-}"; shift 2 ;;
    --gateway-url) GATEWAY_URL="${2:-}"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

check_body() {
  local label="$1" body="$2" name="$3"
  if printf '%s' "$body" | grep -q 'triplanner_build_info' \
    && printf '%s' "$body" | grep -q 'triplanner_http_requests_total' \
    && printf '%s' "$body" | grep -q "service=\"$name\""; then
    echo "OK   $label"
  else
    echo "FAIL $label (missing triplanner metrics)"
    FAILED+=("$label")
  fi
}

check_compose() {
  local service="$1" port="$2" name="$3" out
  if ! out="$(docker compose -f "$COMPOSE_FILE" exec -T "$service" curl -fsS "http://localhost:$port/metrics" 2>&1)"; then
    echo "FAIL compose/$service (curl failed)"
    FAILED+=("compose/$service")
    return
  fi
  check_body "compose/$service" "$out" "$name"
}

check_helm() {
  local deploy="$1" container="$2" port="$3" name="$4" out
  if ! out="$(kubectl --context "$CONTEXT" -n "$NAMESPACE" exec "deploy/$deploy" -c "$container" -- curl -fsS "http://localhost:$port/metrics" 2>&1)"; then
    echo "FAIL helm/$deploy (curl failed)"
    FAILED+=("helm/$deploy")
    return
  fi
  check_body "helm/$deploy" "$out" "$name"
}

if [ "$TARGET" = "compose" ] || [ "$TARGET" = "all" ]; then
  echo "== Compose metrics =="
  check_compose api 4000 api
  check_compose users 4500 users
  check_compose trips 4400 trips
  check_compose locations 4300 locations
  check_compose agent 4100 agent
  check_compose kafka 8080 broker
  check_compose web 3000 web
fi

if [ "$TARGET" = "helm" ] || [ "$TARGET" = "all" ]; then
  echo "== Helm metrics =="
  check_helm triplanner-api api 4000 api
  check_helm triplanner-users users 4500 users
  check_helm triplanner-trips trips 4400 trips
  check_helm triplanner-locations locations 4300 locations
  check_helm triplanner-agent agent 4100 agent
  check_helm triplanner-email email 4200 email
  check_helm triplanner-kafka broker 8080 broker
  check_helm triplanner-web web 3000 web

  code="$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: triplanner.localhost' "$GATEWAY_URL/metrics")"
  if [ "$code" = "302" ]; then
    echo "OK   helm/gateway /metrics is blocked (302)"
  else
    echo "FAIL helm/gateway /metrics returned $code, expected 302"
    FAILED+=("helm/gateway")
  fi
fi

if [ ${#FAILED[@]} -gt 0 ]; then
  echo "metrics smoke failed: ${FAILED[*]}"
  exit 1
fi
echo "metrics smoke passed"
