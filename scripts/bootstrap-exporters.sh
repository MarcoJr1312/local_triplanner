#!/usr/bin/env bash
# Creates read-only database users and Secrets for the Triplanner exporters.
#
# PostgreSQL: role `postgres_exporter` with pg_monitor + CONNECT.
# MongoDB:    user `mongodb_exporter` with clusterMonitor + read on local.
#
# Idempotent: existing exporter Secrets are reused and the role/user password
# is re-applied. It never prints a password.
#
#   bash scripts/bootstrap-exporters.sh

set -euo pipefail

CONTEXT="${CONTEXT:-kind-triplanner-cilium}"
NAMESPACE="${NAMESPACE:-triplanner}"

new_password() {
  openssl rand -hex 16
}

secret_exists() {
  kubectl --context "$CONTEXT" -n "$NAMESPACE" get secret "$1" --ignore-not-found -o name | grep -q .
}

secret_value() {
  local name="$1"
  local key="$2"
  kubectl --context "$CONTEXT" -n "$NAMESPACE" get secret "$name" \
    -o go-template="{{index .data \"$key\"}}" | openssl base64 -d -A
}

create_secret() {
  local name="$1"
  shift
  local file
  file=$(mktemp)
  chmod 600 "$file"
  printf '%s\n' "$@" > "$file"
  kubectl --context "$CONTEXT" -n "$NAMESPACE" create secret generic "$name" \
    --from-env-file="$file" >/dev/null
  rm -f "$file"
}

bootstrap_postgres() {
  local name="$1"
  local pod="$2"
  local admin_secret="$3"
  local database="$4"
  local exporter_secret="$5"
  local password

  if secret_exists "$exporter_secret"; then
    password=$(secret_value "$exporter_secret" password)
  else
    password=$(new_password)
    create_secret "$exporter_secret" \
      "username=postgres_exporter" \
      "password=$password"
  fi

  local admin_user
  admin_user=$(secret_value "$admin_secret" POSTGRES_USER)

  kubectl --context "$CONTEXT" -n "$NAMESPACE" exec -i "$pod" -- \
    psql -U "$admin_user" -d "$database" -v ON_ERROR_STOP=1 <<SQL
\set password '$password'
SELECT 'CREATE ROLE postgres_exporter LOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'postgres_exporter')\gexec
ALTER ROLE postgres_exporter WITH PASSWORD :'password';
GRANT pg_monitor TO postgres_exporter;
GRANT CONNECT ON DATABASE $database TO postgres_exporter;
SQL

  echo "PostgreSQL exporter user ready: $name"
}

bootstrap_postgres \
  users triplanner-users-postgres-0 \
  triplanner-users-postgres-credentials users triplanner-postgres-users-exporter
bootstrap_postgres \
  trips triplanner-trips-postgres-0 \
  triplanner-trips-postgres-credentials trips triplanner-postgres-trips-exporter
bootstrap_postgres \
  api triplanner-api-postgres-0 \
  triplanner-api-postgres-credentials triplanner triplanner-postgres-api-exporter
bootstrap_postgres \
  agent triplanner-agent-postgres-0 \
  triplanner-agent-postgres-credentials agent triplanner-postgres-agent-exporter

MONGO_POD="triplanner-mongo-0"
MONGO_ADMIN_SECRET="triplanner-mongo-credentials"
MONGO_EXPORTER_SECRET="triplanner-mongodb-exporter"
MONGO_SERVICE="triplanner-mongo"

if secret_exists "$MONGO_EXPORTER_SECRET"; then
  mongo_password=$(secret_value "$MONGO_EXPORTER_SECRET" password)
  mongo_uri=$(secret_value "$MONGO_EXPORTER_SECRET" mongodb-uri)
  if [ -z "$mongo_password" ]; then
    mongo_password=$(printf '%s' "$mongo_uri" \
      | sed -E 's#^mongodb://mongodb_exporter:([^@]+)@.*#\1#')
  fi
else
  mongo_password=$(new_password)
  mongo_uri="mongodb://mongodb_exporter:${mongo_password}@${MONGO_SERVICE}:27017/admin?authSource=admin"
  create_secret "$MONGO_EXPORTER_SECRET" \
    "mongodb-uri=$mongo_uri" \
    "password=$mongo_password"
fi

root_user=$(secret_value "$MONGO_ADMIN_SECRET" MONGO_ROOT_USERNAME)
root_pass=$(secret_value "$MONGO_ADMIN_SECRET" MONGO_ROOT_PASSWORD)

kubectl --context "$CONTEXT" -n "$NAMESPACE" exec -i "$MONGO_POD" -- \
  mongosh --quiet --username "$root_user" --password "$root_pass" \
  --authenticationDatabase admin <<JS
const admin = db.getSiblingDB('admin');
const roles = [{ role: 'clusterMonitor', db: 'admin' }, { role: 'read', db: 'local' }];
const existing = admin.getUser('mongodb_exporter');
if (existing) {
  admin.updateUser('mongodb_exporter', { pwd: '$mongo_password', roles });
} else {
  admin.createUser({ user: 'mongodb_exporter', pwd: '$mongo_password', roles });
}
print('mongodb exporter user ready');
JS

echo 'MongoDB exporter user ready'
echo 'Exporter bootstrap complete.'
