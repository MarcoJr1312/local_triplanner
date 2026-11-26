# Creates the local Cilium kind cluster used by the Helm chart's Gateway API.
# The Docker Desktop Kubernetes cluster is intentionally left untouched.
#
# Prerequisites: Docker Desktop, kind, kubectl and helm.
# Usage:
#   powershell -ExecutionPolicy Bypass -File deploy/kind/setup-cilium.ps1

$ErrorActionPreference = 'Stop'

$Cluster = 'triplanner-cilium'
$GatewayApiVersion = 'v1.6.3'
$CiliumVersion = '1.20.5'

if (-not (Get-Command kind -ErrorAction SilentlyContinue)) { throw 'kind is not installed.' }
if (-not (Get-Command kubectl -ErrorAction SilentlyContinue)) { throw 'kubectl is not installed.' }
if (-not (Get-Command helm -ErrorAction SilentlyContinue)) { throw 'helm is not installed.' }

$clusters = kind get clusters 2>$null
if ($clusters -notcontains $Cluster) {
  Write-Host "Creating kind cluster $Cluster..."
  kind create cluster --config (Join-Path $PSScriptRoot 'cilium-cluster.yaml')
  if ($LASTEXITCODE -ne 0) { throw "kind create cluster failed with exit code $LASTEXITCODE." }
}

kubectl config use-context "kind-$Cluster" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Could not switch to kind-$Cluster." }

Write-Host 'Installing Gateway API CRDs...'
kubectl apply --server-side -f "https://github.com/kubernetes-sigs/gateway-api/releases/download/$GatewayApiVersion/standard-install.yaml" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Gateway API CRD installation failed.' }

Write-Host 'Installing Cilium...'
helm repo add cilium https://helm.cilium.io/ 2>$null | Out-Null
helm repo update | Out-Null

$node = "$Cluster-control-plane"
$hostIp = docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' $node
if (-not $hostIp) { throw "Could not determine the IP of $node." }

helm upgrade --install cilium cilium/cilium `
  --namespace kube-system `
  --version $CiliumVersion `
  --values (Join-Path $PSScriptRoot 'cilium-values.yaml') `
  --set "k8sServiceHost=$hostIp" `
  --set k8sServicePort=6443 `
  --wait `
  --timeout 10m
if ($LASTEXITCODE -ne 0) { throw 'Cilium installation failed.' }

Write-Host 'Waiting for nodes...'
kubectl wait --for=condition=Ready nodes --all --timeout=300s | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Nodes did not become Ready.' }

# Docker Desktop WSL2: Cilium's iptables NAT chain can remain empty, which
# breaks pod egress. Add an idempotent masquerade rule for the pod CIDR.
Write-Host 'Ensuring pod egress masquerade...'
docker exec $node sh -c 'iptables-nft -t nat -C POSTROUTING -s 10.244.0.0/24 ! -d 10.244.0.0/24 -j MASQUERADE 2>/dev/null || iptables-nft -t nat -A POSTROUTING -s 10.244.0.0/24 ! -d 10.244.0.0/24 -j MASQUERADE'
if ($LASTEXITCODE -ne 0) { throw 'Could not install the pod egress masquerade rule.' }

kubectl get gatewayclass
kubectl -n kube-system get pods -l k8s-app=cilium
Write-Host ''
Write-Host "Cluster ready. The Gateway web is reachable at http://triplanner.localhost:9080 after the chart is installed."
