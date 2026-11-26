# Installs the prometheus-community PostgreSQL and MongoDB exporters.
# Run scripts/bootstrap-exporters.ps1 first so the Secrets and DB users exist.
#
#   powershell -ExecutionPolicy Bypass -File scripts/deploy-exporters.ps1

param(
  [string]$Context = 'kind-triplanner-cilium',
  [string]$Namespace = 'triplanner'
)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

$repo = 'prometheus-community'
$repoLine = helm repo list 2>$null | Select-String -Pattern "^$repo\s"
if (-not $repoLine) {
  helm repo add $repo https://prometheus-community.github.io/helm-charts | Out-Null
  helm repo update | Out-Null
}

$releases = @(
  @{ Name = 'triplanner-postgres-users'; Chart = "$repo/prometheus-postgres-exporter"; Version = '8.3.0'; Values = 'deploy/exporters/postgres-users.yaml' },
  @{ Name = 'triplanner-postgres-trips'; Chart = "$repo/prometheus-postgres-exporter"; Version = '8.3.0'; Values = 'deploy/exporters/postgres-trips.yaml' },
  @{ Name = 'triplanner-postgres-api'; Chart = "$repo/prometheus-postgres-exporter"; Version = '8.3.0'; Values = 'deploy/exporters/postgres-api.yaml' },
  @{ Name = 'triplanner-postgres-agent'; Chart = "$repo/prometheus-postgres-exporter"; Version = '8.3.0'; Values = 'deploy/exporters/postgres-agent.yaml' },
  @{ Name = 'triplanner-mongodb'; Chart = "$repo/prometheus-mongodb-exporter"; Version = '3.23.2'; Values = 'deploy/exporters/mongodb.yaml' }
)

foreach ($release in $releases) {
  $valuesPath = Join-Path $Root $release.Values
  Write-Output "Deploying $($release.Name)..."
  helm upgrade --install $release.Name $release.Chart `
    --version $release.Version `
    --kube-context $Context `
    --namespace $Namespace `
    --values $valuesPath `
    --wait `
    --timeout 5m | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Helm release failed: $($release.Name)" }
}

Write-Output ''
kubectl --context $Context -n $Namespace get pods | Select-String -Pattern 'triplanner-postgres|triplanner-mongodb'
kubectl --context $Context -n $Namespace get servicemonitors | Select-String -Pattern 'triplanner-postgres|triplanner-mongodb'
Write-Output 'Exporter releases deployed.'
