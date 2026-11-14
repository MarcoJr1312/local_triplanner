# End-to-end smoke test for the Docker Compose demo.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/smoke.ps1
$ErrorActionPreference = 'Stop'
$Base = if ($env:WEB_URL) { $env:WEB_URL.TrimEnd('/') } else { 'http://localhost:3000' }
$HeadersUser = @{ 'x-user-id' = 'demo-user'; 'Content-Type' = 'application/json' }
$HeadersFriend = @{ 'x-user-id' = 'demo-friend'; 'Content-Type' = 'application/json' }

function Fail([string]$Message) {
  Write-Host "FAIL: $Message" -ForegroundColor Red
  exit 1
}

function Pass([string]$Message) {
  Write-Host "PASS: $Message" -ForegroundColor Green
}

Write-Host "Smoke test against $Base"

foreach ($svc in @('postgres', 'mongo', 'api', 'agent', 'web')) {
  $name = "local_triplanner-$svc"
  $status = docker inspect --format '{{.State.Health.Status}}' $name 2>$null
  if ($status -ne 'healthy') { Fail "$name is '$status'" }
}

$login = Invoke-WebRequest -Uri "$Base/login" -UseBasicParsing
if ($login.StatusCode -ne 200) { Fail "GET /login -> $($login.StatusCode)" }
Pass "web /login"

$profileBody = @{ query = 'query { getMyProfile { userId email displayName } }' } | ConvertTo-Json
$profile = Invoke-RestMethod -Uri "$Base/api/graphql" -Method Post -Headers $HeadersFriend -Body $profileBody
if ($profile.data.getMyProfile.userId -ne 'demo-friend') { Fail "demo-friend profile" }
Pass "GraphQL profile via web proxy"

$searchBody = @{ query = 'query { searchLocations(q: "CN Tower") { id name imageUrl } }' } | ConvertTo-Json
$search = Invoke-RestMethod -Uri "$Base/api/graphql" -Method Post -Headers $HeadersUser -Body $searchBody
$items = @($search.data.searchLocations)
if ($items.Count -lt 1) { Fail "search returned no places" }
Pass "Toronto place search ($($items.Count) results)"

$imageItem = $items | Where-Object { $_.imageUrl } | Select-Object -First 1
if ($imageItem) {
  $image = Invoke-WebRequest -Uri "$Base$($imageItem.imageUrl)" -UseBasicParsing
  if ($image.StatusCode -ne 200) { Fail "image -> $($image.StatusCode)" }
  if ($image.Headers['Content-Type'] -notlike 'image/*') { Fail "image content-type" }
  Pass "seed image via web proxy"
}

$config = Invoke-RestMethod -Uri "$Base/api/agent/config" -Method Get
if ($null -eq $config.demo) { Fail "agent config shape" }
Pass "agent provider config (demo=$($config.demo), provider=$($config.provider))"

$interestsBody = @{ query = 'mutation { setMyInterests(terms: ["museums", "food", "views"]) }' } | ConvertTo-Json
Invoke-RestMethod -Uri "$Base/api/graphql" -Method Post -Headers $HeadersUser -Body $interestsBody | Out-Null
Pass "set demo interests"

$autoBody = @{ tripId = 'demo-trip'; offset = 0; limit = 5 } | ConvertTo-Json
$auto = Invoke-RestMethod -Uri "$Base/api/agent/auto-suggest" -Method Post -Headers $HeadersUser -Body $autoBody -TimeoutSec 120
if (@($auto.items).Count -lt 1) { Fail "auto-suggest returned no items" }
Pass "agent auto-suggest"

$suggestionsBody = @{
  tripId = 'demo-trip'
  locale = 'es'
  day = '2026-12-04'
  messages = @(@{ role = 'user'; content = 'Hola, que me recomiendas?' })
} | ConvertTo-Json -Depth 5
$suggestions = Invoke-RestMethod -Uri "$Base/api/agent/suggestions" -Method Post -Headers $HeadersUser -Body $suggestionsBody -TimeoutSec 120
if (-not $suggestions.answer) { Fail "suggestions returned no answer" }
Pass "agent suggestions ($($suggestions.mode))"

Write-Host "SMOKE PASS" -ForegroundColor Green
