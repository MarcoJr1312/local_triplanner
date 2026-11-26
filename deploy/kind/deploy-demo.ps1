# Deploys the Triplanner chart to the isolated Cilium kind cluster.
# Prerequisites: the cluster from setup-cilium.ps1 and the local images built
# with:
#   docker compose -f deploy/docker-compose.yml build

$ErrorActionPreference = 'Stop'

$Cluster = 'triplanner-cilium'
$Release = 'triplanner'
$Namespace = 'triplanner'
$ImageTag = 'sha-5247619'  # Image build SHA; update when service images change.

function Require-Image([string]$Name) {
  docker image inspect $Name *> $null
  if ($LASTEXITCODE -ne 0) { throw "Missing local image $Name. Build it first." }
}

$images = @(
  @{ source = 'local_triplanner-kafka:latest'; target = "triplanner-local/kafka:$ImageTag" },
  @{ source = 'local_triplanner-email:latest'; target = "triplanner-local/email:$ImageTag" },
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

# Restore pod egress after a Docker Desktop restart. Cilium's iptables NAT
# chain can be empty on WSL2; the setup script applies the same idempotent rule.
$node = "$Cluster-control-plane"
docker exec $node sh -c 'iptables-nft -t nat -C POSTROUTING -s 10.244.0.0/24 ! -d 10.244.0.0/24 -j MASQUERADE 2>/dev/null || iptables-nft -t nat -A POSTROUTING -s 10.244.0.0/24 ! -d 10.244.0.0/24 -j MASQUERADE'
if ($LASTEXITCODE -ne 0) { throw 'Could not install the pod egress masquerade rule.' }

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
