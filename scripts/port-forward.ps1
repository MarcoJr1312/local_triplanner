#Requires -Version 5.1
<#
.SYNOPSIS
  Port-forward the Triplanner Helm services to localhost.

.DESCRIPTION
  Starts kubectl port-forwards for the broker, email, locations and trips
  services. App ports bind on -BindAddress (default 0.0.0.0) so Docker Compose
  containers can reach them through host.docker.internal.
  Proxy ports bind on 127.0.0.1 only and use distinct local ports
  (8443/8444/8445/8446) because each sidecar listens on 8443 inside its pod.

  Re-running the script stops the forwards it started previously and skips
  ports that are already in use (use -Strict to fail instead).

.PARAMETER Namespace
  Kubernetes namespace. Default: triplanner.

.PARAMETER BindAddress
  Address for the app ports. Default: 0.0.0.0.

.PARAMETER Proxy
  Also forward the kube-rbac-proxy ports on 127.0.0.1:8443/8444/8445/8446.

.PARAMETER Mongo
  Also forward MongoDB on 127.0.0.1:27018. The chart runs Mongo as a
  StatefulSet; 27018 avoids the Compose Mongo on 27017.

.PARAMETER Postgres
  Also forward the trips PostgreSQL StatefulSet on 127.0.0.1:5433.
  5433 avoids the Compose Postgres on 5432.

.PARAMETER Strict
  Fail when a local port is already in use instead of skipping it.

.PARAMETER Stop
  Stop the forwards started by this script and exit.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/port-forward.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/port-forward.ps1 -Proxy -Mongo

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/port-forward.ps1 -Stop
#>
[CmdletBinding()]
param(
  [string]$Namespace = 'triplanner',
  [string]$BindAddress = '0.0.0.0',
  [switch]$Proxy,
  [switch]$Mongo,
  [switch]$Postgres,
  [switch]$Strict,
  [switch]$Stop
)

$ErrorActionPreference = 'Stop'
$KubectlOverride = if ($env:KUBECTL) { $env:KUBECTL } else { $null }
$stateDir = Join-Path ([System.IO.Path]::GetTempPath()) "triplanner-port-forward-$Namespace-pwsh"
$stateFile = Join-Path $stateDir 'forwards.json'

function Get-Forwards {
  if (-not (Test-Path $stateFile)) { return @() }
  try {
    $parsed = Get-Content $stateFile -Raw | ConvertFrom-Json
    return @($parsed)
  } catch {
    return @()
  }
}

function Stop-Forwards {
  $forwards = @(Get-Forwards)
  # Remove the state first so a running monitor treats this as an intentional
  # stop instead of a crashed child.
  if (Test-Path $stateFile) { Remove-Item $stateFile -Force -ErrorAction SilentlyContinue }
  foreach ($forward in $forwards) {
    $process = Get-Process -Id $forward.pid -ErrorAction SilentlyContinue
    if ($process -and $process.ProcessName -like 'kubectl*') {
      Stop-Process -Id $forward.pid -Force -ErrorAction SilentlyContinue
    }
  }
  if (Test-Path $stateDir) { Remove-Item $stateDir -Recurse -Force -ErrorAction SilentlyContinue }
}

function Test-LocalPort([int]$Port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $async = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
    if (-not $async.AsyncWaitHandle.WaitOne(400)) { return $false }
    $client.EndConnect($async)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Test-HttpOk([string]$Url) {
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 300
  } catch {
    return $false
  }
}

if ($Stop) {
  Stop-Forwards
  Write-Host "Stopped Triplanner port-forwards for namespace '$Namespace'."
  exit 0
}

$kubectlPath = if ($KubectlOverride) {
  (Get-Item $KubectlOverride -ErrorAction SilentlyContinue).FullName
} else {
  (Get-Command kubectl -ErrorAction SilentlyContinue).Source
}
if (-not $kubectlPath) {
  throw 'kubectl no está en PATH. Define KUBECTL con la ruta al binario.'
}

& $kubectlPath -n $Namespace get service triplanner-kafka --request-timeout=10s | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "No se pudo leer el namespace '$Namespace'. ¿Está el clúster activo y el release instalado?"
}

Stop-Forwards
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null

$targets = @(
  [pscustomobject]@{ Name = 'broker'; Target = 'svc/triplanner-kafka'; LocalPort = 8080; RemotePort = 8080; Bind = $BindAddress; Health = 'http://localhost:8080/health' }
  [pscustomobject]@{ Name = 'email'; Target = 'svc/triplanner-email'; LocalPort = 4200; RemotePort = 4200; Bind = $BindAddress; Health = 'http://localhost:4200/health' }
  [pscustomobject]@{ Name = 'locations'; Target = 'svc/triplanner-locations'; LocalPort = 4300; RemotePort = 4300; Bind = $BindAddress; Health = 'http://localhost:4300/health' }
  [pscustomobject]@{ Name = 'trips'; Target = 'svc/triplanner-trips'; LocalPort = 4400; RemotePort = 4400; Bind = $BindAddress; Health = 'http://localhost:4400/health' }
)

if ($Proxy) {
  $targets += @(
    [pscustomobject]@{ Name = 'broker-proxy'; Target = 'svc/triplanner-kafka'; LocalPort = 8443; RemotePort = 8443; Bind = '127.0.0.1'; Health = $null }
    [pscustomobject]@{ Name = 'email-proxy'; Target = 'svc/triplanner-email'; LocalPort = 8444; RemotePort = 8443; Bind = '127.0.0.1'; Health = $null }
    [pscustomobject]@{ Name = 'locations-proxy'; Target = 'svc/triplanner-locations'; LocalPort = 8445; RemotePort = 8443; Bind = '127.0.0.1'; Health = $null }
    [pscustomobject]@{ Name = 'trips-proxy'; Target = 'svc/triplanner-trips'; LocalPort = 8446; RemotePort = 8443; Bind = '127.0.0.1'; Health = $null }
  )
}

if ($Mongo) {
  $targets += [pscustomobject]@{ Name = 'mongo'; Target = 'statefulset/triplanner-mongo'; LocalPort = 27018; RemotePort = 27017; Bind = '127.0.0.1'; Health = $null }
}

if ($Postgres) {
  $targets += [pscustomobject]@{ Name = 'trips-postgres'; Target = 'statefulset/triplanner-trips-postgres'; LocalPort = 5433; RemotePort = 5432; Bind = '127.0.0.1'; Health = $null }
}

$started = @()
$skipped = @()

try {
  foreach ($target in $targets) {
    if (Test-LocalPort $target.LocalPort) {
      $owner = (Get-NetTCPConnection -LocalPort $target.LocalPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess
      $message = "puerto $($target.LocalPort) ya está en uso" + $(if ($owner) { " (pid $owner)" } else { '' })
      if ($Strict) { throw $message }
      Write-Warning "Se omite $($target.Name): $message."
      $skipped += $target
      continue
    }

    $outLog = Join-Path $stateDir "$($target.Name).out.log"
    $errLog = Join-Path $stateDir "$($target.Name).err.log"
    $arguments = @(
      '-n', $Namespace,
      'port-forward',
      '--address', $target.Bind,
      '--pod-running-timeout', '30s',
      $target.Target,
      "$($target.LocalPort):$($target.RemotePort)"
    )
    $process = Start-Process -FilePath $kubectlPath -ArgumentList $arguments -PassThru -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog
    $started += [pscustomobject]@{
      name = $target.Name
      target = $target.Target
      localPort = $target.LocalPort
      remotePort = $target.RemotePort
      bind = $target.Bind
      pid = $process.Id
      health = $target.Health
      outLog = $outLog
      errLog = $errLog
    }
  }

  $started | ConvertTo-Json -Depth 4 | Set-Content -Path $stateFile -Encoding UTF8

  $deadline = (Get-Date).AddSeconds(25)
  foreach ($forward in $started) {
    while (-not (Test-LocalPort $forward.localPort)) {
      if ((Get-Date) -gt $deadline) {
        throw "El port-forward '$($forward.name)' no abrió el puerto $($forward.localPort). Revisa $($forward.errLog)."
      }
      if (-not (Get-Process -Id $forward.pid -ErrorAction SilentlyContinue)) {
        $errorText = Get-Content $forward.errLog -Raw -ErrorAction SilentlyContinue
        throw "El port-forward '$($forward.name)' terminó. $errorText"
      }
      Start-Sleep -Milliseconds 300
    }
  }

  Start-Sleep -Milliseconds 500
  Write-Host ""
  Write-Host "Triplanner port-forwards (namespace $Namespace)" -ForegroundColor Cyan
  foreach ($forward in $started) {
    $health = if ($forward.health) {
      if (Test-HttpOk $forward.health) { 'healthy' } else { 'listening (health pending)' }
    } else {
      'listening'
    }
    Write-Host ("  {0,-16} localhost:{1,-5} -> {2}:{3,-5} [{4}]" -f $forward.name, $forward.localPort, $forward.target, $forward.remotePort, $health)
  }
  foreach ($target in $skipped) {
    Write-Host ("  {0,-16} localhost:{1,-5} -> skipped (port already in use)" -f $target.Name, $target.LocalPort) -ForegroundColor DarkYellow
  }
  if ($Proxy) {
    Write-Host ""
    Write-Host "RBAC proxies are 127.0.0.1 only. Example:" -ForegroundColor DarkGray
    Write-Host "  curl.exe -i http://localhost:8446/ready    # trips: 401 without a token" -ForegroundColor DarkGray
  }
  Write-Host ""
  Write-Host "Press Ctrl+C to stop. If the forwards survive, run: scripts/port-forward.ps1 -Stop" -ForegroundColor DarkGray

  while ($true) {
    if (-not (Test-Path $stateFile)) { break }
    $dead = @($started | Where-Object { -not (Get-Process -Id $_.pid -ErrorAction SilentlyContinue) })
    if ($dead.Count -gt 0) {
      throw "El port-forward '$($dead[0].name)' terminó. Revisa $($dead[0].errLog)."
    }
    Start-Sleep -Seconds 2
  }
} catch {
  Stop-Forwards
  throw
} finally {
  Stop-Forwards
}
