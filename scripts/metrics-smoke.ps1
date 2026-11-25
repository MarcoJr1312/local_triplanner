# Prometheus metrics smoke check for the Compose and Helm demo stacks.
#
#   powershell -File scripts/metrics-smoke.ps1 -Target all
#   powershell -File scripts/metrics-smoke.ps1 -Target helm -Context kind-triplanner-cilium

param(
  [ValidateSet('compose', 'helm', 'all')]
  [string]$Target = 'all',
  [string]$Context = 'kind-triplanner-cilium',
  [string]$Namespace = 'triplanner',
  [string]$ComposeFile = 'deploy/docker-compose.yml',
  [string]$GatewayUrl = 'http://127.0.0.1:9080'
)

$failed = New-Object System.Collections.Generic.List[string]

function Test-MetricsBody([string]$label, [string]$body, [string]$name) {
  $pattern = 'service="' + $name + '"'
  $ok = ($body | Select-String -Pattern 'triplanner_build_info' -SimpleMatch -Quiet) -and
        ($body | Select-String -Pattern 'triplanner_http_requests_total' -SimpleMatch -Quiet) -and
        ($body | Select-String -Pattern $pattern -SimpleMatch -Quiet)
  if ($ok) {
    Write-Host "OK   $label"
  } else {
    Write-Host "FAIL $label (missing triplanner metrics)"
    $script:failed.Add($label)
  }
}

function Check-Compose([string]$service, [int]$port, [string]$name) {
  $out = docker compose -f $ComposeFile exec -T $service curl -fsS "http://localhost:$port/metrics" 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Host "FAIL compose/$service (curl exit $LASTEXITCODE)"
    $script:failed.Add("compose/$service")
    return
  }
  Test-MetricsBody "compose/$service" ($out -join "`n") $name
}

function Check-Helm([string]$deploy, [string]$container, [int]$port, [string]$name) {
  $out = kubectl --context $Context -n $Namespace exec "deploy/$deploy" -c $container -- curl -fsS "http://localhost:$port/metrics" 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Host "FAIL helm/$deploy (curl exit $LASTEXITCODE)"
    $script:failed.Add("helm/$deploy")
    return
  }
  Test-MetricsBody "helm/$deploy" ($out -join "`n") $name
}

if ($Target -in @('compose', 'all')) {
  Write-Host '== Compose metrics =='
  Check-Compose 'api' 4000 'api'
  Check-Compose 'users' 4500 'users'
  Check-Compose 'trips' 4400 'trips'
  Check-Compose 'locations' 4300 'locations'
  Check-Compose 'agent' 4100 'agent'
  Check-Compose 'kafka' 8080 'broker'
  Check-Compose 'web' 3000 'web'
}

if ($Target -in @('helm', 'all')) {
  Write-Host '== Helm metrics =='
  Check-Helm 'triplanner-api' 'api' 4000 'api'
  Check-Helm 'triplanner-users' 'users' 4500 'users'
  Check-Helm 'triplanner-trips' 'trips' 4400 'trips'
  Check-Helm 'triplanner-locations' 'locations' 4300 'locations'
  Check-Helm 'triplanner-agent' 'agent' 4100 'agent'
  Check-Helm 'triplanner-email' 'email' 4200 'email'
  Check-Helm 'triplanner-kafka' 'broker' 8080 'broker'
  Check-Helm 'triplanner-web' 'web' 3000 'web'

  $metricsCode = (curl.exe -s -o NUL -w '%{http_code}' -H 'Host: triplanner.localhost' "$GatewayUrl/metrics").Trim()
  if ($metricsCode -eq '302') {
    Write-Host 'OK   helm/gateway /metrics is blocked (302)'
  } else {
    Write-Host "FAIL helm/gateway /metrics returned $metricsCode, expected 302"
    $failed.Add('helm/gateway')
  }
}

if ($failed.Count -gt 0) {
  Write-Host "metrics smoke failed: $($failed -join ', ')"
  exit 1
}
Write-Host 'metrics smoke passed'
