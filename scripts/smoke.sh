#!/usr/bin/env bash
# End-to-end smoke test for the Docker Compose demo.
# Usage: bash scripts/smoke.sh
set -euo pipefail

BASE="${WEB_URL:-http://localhost:3000}"
BASE="${BASE%/}"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

pass() {
  echo "PASS: $*"
}

echo "Smoke test against $BASE"

for svc in postgres mongo locations api agent web; do
  name="local_triplanner-$svc"
  status="$(docker inspect --format '{{.State.Health.Status}}' "$name" 2>/dev/null || true)"
  [ "$status" = "healthy" ] || fail "$name is '$status'"
done

curl -fsS "$BASE/login" >/dev/null || fail "GET /login"
pass "web /login"

profile="$(curl -fsS -X POST "$BASE/api/graphql" \
  -H 'x-user-id: demo-friend' -H 'Content-Type: application/json' \
  -d '{"query":"query { getMyProfile { userId email displayName } }"}')"
echo "$profile" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["data"]["getMyProfile"]["userId"]=="demo-friend"'
pass "GraphQL profile via web proxy"

search="$(curl -fsS -X POST "$BASE/api/graphql" \
  -H 'x-user-id: demo-user' -H 'Content-Type: application/json' \
  -d '{"query":"query { searchLocations(q: \"CN Tower\") { id name placeId imageUrl } }"}')"
echo "$search" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert len(d["data"]["searchLocations"])>0'
pass "Toronto place search"

activities="$(curl -fsS -X POST "$BASE/api/graphql" \
  -H 'x-user-id: demo-user' -H 'Content-Type: application/json' \
  -d '{"query":"query { listActivities(destSlug: \"toronto\", category: \"food\") { id name } }"}')"
echo "$activities" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert len(d["data"]["listActivities"])>0'
pass "Toronto activities"

place_id="$(echo "$search" | python3 -c 'import json,sys
items=json.load(sys.stdin)["data"]["searchLocations"]
print(next((i["placeId"] for i in items if i.get("placeId")), ""))')"
if [ -n "$place_id" ]; then
  details_payload="$(python3 -c 'import json,sys; pid=sys.argv[1]; print(json.dumps({"query":"query { locationDetails(placeId: \""+pid+"\") { id name } }"}))' "$place_id")"
  details="$(curl -fsS -X POST "$BASE/api/graphql" \
    -H 'x-user-id: demo-user' -H 'Content-Type: application/json' -d "$details_payload")"
  echo "$details" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["data"]["locationDetails"]["id"]'
  pass "location details"
fi

image="$(echo "$search" | python3 -c 'import json,sys
items=json.load(sys.stdin)["data"]["searchLocations"]
print(next((i["imageUrl"] for i in items if i.get("imageUrl")), ""))')"
if [ -n "$image" ]; then
  meta="$(curl -fsS -o /dev/null -w '%{http_code} %{content_type}' "$BASE$image")"
  case "$meta" in
    200\ image/*) pass "seed image via web proxy" ;;
    *) fail "image -> $meta" ;;
  esac
fi

config="$(curl -fsS "$BASE/api/agent/config")"
echo "$config" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert "demo" in d and "provider" in d'
pass "agent provider config"

llm="$(curl -fsS -X POST "$BASE/api/graphql" \
  -H 'x-user-id: demo-user' -H 'Content-Type: application/json' \
  -d '{"query":"query { getLlmSettings { provider model baseUrl hasKey demo } }"}')"
echo "$llm" | python3 -c 'import json,sys; d=json.load(sys.stdin)["data"]["getLlmSettings"]; assert "provider" in d and "demo" in d'
pass "LLM settings"

curl -fsS -X POST "$BASE/api/graphql" \
  -H 'x-user-id: demo-user' -H 'Content-Type: application/json' \
  -d '{"query":"mutation { setMyInterests(terms: [\"museums\", \"food\", \"views\"]) }"}' >/dev/null
pass "set demo interests"

auto="$(curl -fsS --max-time 120 -X POST "$BASE/api/agent/auto-suggest" \
  -H 'x-user-id: demo-user' -H 'Content-Type: application/json' \
  -d '{"tripId":"demo-trip","offset":0,"limit":5}')"
echo "$auto" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert len(d.get("items",[]))>0'
pass "agent auto-suggest"

suggestions="$(curl -fsS --max-time 120 -X POST "$BASE/api/agent/suggestions" \
  -H 'x-user-id: demo-user' -H 'Content-Type: application/json' \
  -d '{"tripId":"demo-trip","locale":"es","day":"2026-12-04","messages":[{"role":"user","content":"Hola, que me recomiendas?"}]}')"
echo "$suggestions" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert isinstance(d.get("answer"),str) and d["answer"]'
pass "agent suggestions"

echo "SMOKE PASS"
