# Deploys the Triplanner chart to the isolated Cilium kind cluster.
# Prerequisites: the cluster from setup-cilium.ps1 and the local images built
# with:
#   docker compose -f deploy/docker-compose.yml build

$ErrorActionPreference = 'Stop'

$Cluster = 'triplanner-cilium'
$Release = 'triplanner'
$Namespace = 'triplanner'
$ImageTag = 'kind-0.14.0'

function Require-Image([string]$Name) {
  docker image inspect $Name *> $null
  if ($LASTEXITCODE -ne 0) { throw "Missing local image $Name. Build it first." }
}

$images = @(
  @{ source = 'local_triplanner-kafka:latest'; target = "triplanner-local/kafka:$ImageTag" },
  @{ source = 'marcojr13/triplanner-email:0.1.1'; target = "triplanner-local/email:$ImageTag" },
  @{ source = 'local_triplanner-locations:latest'; target = "triplanner-local/locations:$ImageTag" },
  @{ source = 'local_triplanner-trips:latest'; target = "triplanner-local/trips:$ImageTag" },
  @{ source = 'local_triplanner-users:latest'; target = "triplanner-local/users:$ImageTag" },
  @{ source = 'local_triplanner-agent:latest'; target = "triplanner-local/agent:$ImageTag" },
  @{ source = 'local_triplanner-api:latest'; target = "triplanner-local/api:$ImageTag" },
  @{ source = 'local_triplanner-web:latest'; target = "triplanner-local/web:$ImageTag" }
)

foreach ($image in $images) {
  Require-Image $image.source
  docker tag $image.source $image.target
}

Write-Host 'Loading application images into kind...'
$targets = $images | ForEach-Object { $_.target }
kind load docker-image --name $Cluster $targets
if ($LASTEXITCODE -ne 0) { throw 'kind load docker-image failed.' }

kubectl config use-context "kind-$Cluster" | Out-Null
$ns = kubectl get namespace $Namespace --ignore-not-found -o name 2>$null
if (-not $ns) {
  kubectl create namespace $Namespace | Out-Null
}

$existing = kubectl -n $Namespace get secret triplanner-internal --ignore-not-found -o name 2>$null
if (-not $existing) {
  $token = -join ((48..57) + (97..102) | Get-Random -Count 64 | ForEach-Object { [char]$_ })
  kubectl -n $Namespace create secret generic triplanner-internal --from-literal=INTERNAL_TOKEN=$token | Out-Null
}

$chart = (Resolve-Path (Join-Path $PSScriptRoot '..\..\helm\helm-triplanner')).Path
helm upgrade --install $Release $chart `
  --kube-context "kind-$Cluster" `
  --namespace $Namespace `
  --values (Join-Path $PSScriptRoot 'triplanner-values.yaml') `
  --wait `
  --timeout 15m
if ($LASTEXITCODE -ne 0) { throw 'Helm deployment failed.' }

kubectl -n $Namespace get gateway,httproute
Write-Host ''
Write-Host 'Triplanner is ready at http://triplanner.localhost:9080'
Write-Host 'Sign in with demo / demo123.'
exit 0
