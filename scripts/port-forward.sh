#!/usr/bin/env bash
# Port-forward the Triplanner Helm services to localhost.
#
# App ports bind on 0.0.0.0 by default so Docker Compose containers can reach
# them through host.docker.internal. Proxy ports bind on 127.0.0.1 only and use
# distinct local ports because every sidecar listens on 8443 inside its pod.
#
# Usage:
#   bash scripts/port-forward.sh
#   bash scripts/port-forward.sh --proxy --mongo
#   bash scripts/port-forward.sh --stop
set -euo pipefail

NAMESPACE="${NAMESPACE:-triplanner}"
KUBECTL="${KUBECTL:-kubectl}"
BIND_ADDRESS="0.0.0.0"
PROXY=0
MONGO=0
POSTGRES=0
STRICT=0
STOP=0

usage() {
  cat <<'EOF'
Port-forward the Triplanner Helm services.

Options:
  -n, --namespace NAME   Kubernetes namespace (default: triplanner)
      --bind ADDRESS     Bind address for app ports (default: 0.0.0.0)
      --proxy            Also forward the RBAC proxies (127.0.0.1:8443/8444/8445/8446/8447)
      --mongo            Also forward MongoDB (127.0.0.1:27018)
      --postgres         Also forward the trips PostgreSQL (127.0.0.1:5433)
      --strict           Fail when a local port is already in use
      --stop             Stop the forwards started by this script
  -h, --help             Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -n|--namespace) NAMESPACE="$2"; shift 2 ;;
    --bind) BIND_ADDRESS="$2"; shift 2 ;;
    --proxy) PROXY=1; shift ;;
    --mongo) MONGO=1; shift ;;
    --postgres) POSTGRES=1; shift ;;
    --strict) STRICT=1; shift ;;
    --stop) STOP=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

STATE_DIR="${TMPDIR:-/tmp}/triplanner-port-forward-$NAMESPACE-sh"
STATE_FILE="$STATE_DIR/pids"

stop_forwards() {
  local saved_pids=""
  if [[ -f "$STATE_FILE" ]]; then
    saved_pids="$(cat "$STATE_FILE")"
  fi
  # Remove the state first so a running monitor treats this as an intentional
  # stop instead of a crashed child.
  rm -rf "$STATE_DIR"
  while read -r pid; do
    [[ -n "$pid" ]] && kill "$pid" 2>/dev/null || true
  done <<< "$saved_pids"
}

if ((STOP)); then
  stop_forwards
  echo "Stopped Triplanner port-forwards for namespace '$NAMESPACE'."
  exit 0
fi

command -v "$KUBECTL" >/dev/null 2>&1 || { echo "$KUBECTL is not in PATH." >&2; exit 1; }
"$KUBECTL" -n "$NAMESPACE" get service triplanner-kafka --request-timeout=10s >/dev/null

stop_forwards
mkdir -p "$STATE_DIR"

port_in_use() {
  (echo >/dev/tcp/127.0.0.1/"$1") >/dev/null 2>&1
}

targets=(
  "broker|svc/triplanner-kafka|8080|8080|$BIND_ADDRESS|http://localhost:8080/health"
  "email|svc/triplanner-email|4200|4200|$BIND_ADDRESS|http://localhost:4200/health"
  "locations|svc/triplanner-locations|4300|4300|$BIND_ADDRESS|http://localhost:4300/health"
  "trips|svc/triplanner-trips|4400|4400|$BIND_ADDRESS|http://localhost:4400/health"
  "users|svc/triplanner-users|4500|4500|$BIND_ADDRESS|http://localhost:4500/health"
)

if ((PROXY)); then
  targets+=(
    "broker-proxy|svc/triplanner-kafka|8443|8443|127.0.0.1|"
    "email-proxy|svc/triplanner-email|8444|8443|127.0.0.1|"
    "locations-proxy|svc/triplanner-locations|8445|8443|127.0.0.1|"
    "trips-proxy|svc/triplanner-trips|8446|8443|127.0.0.1|"
    "users-proxy|svc/triplanner-users|8447|8443|127.0.0.1|"
  )
fi

if ((MONGO)); then
  targets+=("mongo|statefulset/triplanner-mongo|27018|27017|127.0.0.1|")
fi

if ((POSTGRES)); then
  targets+=("trips-postgres|statefulset/triplanner-trips-postgres|5433|5432|127.0.0.1|")
  targets+=("users-postgres|statefulset/triplanner-users-postgres|5434|5432|127.0.0.1|")
fi

started=()
skipped=()
trap 'stop_forwards' EXIT
trap 'stop_forwards; exit 130' INT TERM

for spec in "${targets[@]}"; do
  IFS='|' read -r name target local_port remote_port bind health <<<"$spec"
  if port_in_use "$local_port"; then
    if ((STRICT)); then
      echo "Port $local_port is already in use." >&2
      exit 1
    fi
    echo "Skipping $name: port $local_port is already in use." >&2
    skipped+=("$name|$local_port")
    continue
  fi

  "$KUBECTL" -n "$NAMESPACE" port-forward --address "$bind" --pod-running-timeout=30s \
    "$target" "$local_port:$remote_port" >"$STATE_DIR/$name.log" 2>&1 &
  pid=$!
  echo "$pid" >> "$STATE_FILE"
  started+=("$name|$target|$local_port|$remote_port|$pid|$health")
done

deadline=$((SECONDS + 25))
for entry in "${started[@]}"; do
  IFS='|' read -r name target local_port remote_port pid health <<<"$entry"
  while ! port_in_use "$local_port"; do
    if ((SECONDS > deadline)); then
      echo "Port-forward '$name' did not open port $local_port. See $STATE_DIR/$name.log." >&2
      exit 1
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "Port-forward '$name' exited:" >&2
      cat "$STATE_DIR/$name.log" >&2 || true
      exit 1
    fi
    sleep 0.3
  done
done

sleep 0.5
echo ""
echo "Triplanner port-forwards (namespace $NAMESPACE)"
for entry in "${started[@]}"; do
  IFS='|' read -r name target local_port remote_port pid health <<<"$entry"
  status="listening"
  if [[ -n "$health" ]] && curl -fsS --max-time 3 "$health" >/dev/null 2>&1; then
    status="healthy"
  elif [[ -n "$health" ]]; then
    status="listening (health pending)"
  fi
  printf "  %-16s localhost:%-5s -> %s:%s [%s]\n" "$name" "$local_port" "$target" "$remote_port" "$status"
done
for entry in "${skipped[@]}"; do
  IFS='|' read -r name local_port <<<"$entry"
  printf "  %-16s localhost:%-5s -> skipped (port already in use)\n" "$name" "$local_port"
done
if ((PROXY)); then
  echo ""
  echo "RBAC proxies are 127.0.0.1 only. Example:"
  echo "  curl -i http://localhost:8447/ready    # users: 401 without a token"
fi
echo ""
echo "Press Ctrl+C to stop. If the forwards survive, run: bash scripts/port-forward.sh --stop"

while true; do
  [[ -f "$STATE_FILE" ]] || exit 0
  for entry in "${started[@]}"; do
    IFS='|' read -r name target local_port remote_port pid health <<<"$entry"
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "Port-forward '$name' exited. See $STATE_DIR/$name.log." >&2
      exit 1
    fi
  done
  sleep 2
done
