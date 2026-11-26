# Creates read-only database users and Secrets for the Triplanner exporters.
#
# PostgreSQL: role `postgres_exporter` with pg_monitor + CONNECT.
# MongoDB:    user `mongodb_exporter` with clusterMonitor + read on local.
#
# The script is idempotent: existing exporter Secrets are reused and the
# role/user password is re-applied. It never prints a password.
#
#   powershell -ExecutionPolicy Bypass -File scripts/bootstrap-exporters.ps1

param(
  [string]$Context = 'kind-triplanner-cilium',
  [string]$Namespace = 'triplanner'
)

$ErrorActionPreference = 'Stop'

$databases = @(
  @{ Name = 'users'; Pod = 'triplanner-users-postgres-0'; AdminSecret = 'triplanner-users-postgres-credentials'; Database = 'users'; ExporterSecret = 'triplanner-postgres-users-exporter' },
  @{ Name = 'trips'; Pod = 'triplanner-trips-postgres-0'; AdminSecret = 'triplanner-trips-postgres-credentials'; Database = 'trips'; ExporterSecret = 'triplanner-postgres-trips-exporter' },
  @{ Name = 'api'; Pod = 'triplanner-api-postgres-0'; AdminSecret = 'triplanner-api-postgres-credentials'; Database = 'triplanner'; ExporterSecret = 'triplanner-postgres-api-exporter' },
  @{ Name = 'agent'; Pod = 'triplanner-agent-postgres-0'; AdminSecret = 'triplanner-agent-postgres-credentials'; Database = 'agent'; ExporterSecret = 'triplanner-postgres-agent-exporter' }
)

$mongo = @{
  Pod = 'triplanner-mongo-0'
  AdminSecret = 'triplanner-mongo-credentials'
  ExporterSecret = 'triplanner-mongodb-exporter'
  Service = 'triplanner-mongo'
}

function New-Password {
  $chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }
  return -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
}

function Get-SecretValue([string]$Name, [string]$Key) {
  $json = kubectl --context $Context -n $Namespace get secret $Name -o json | ConvertFrom-Json
  $property = $json.data.PSObject.Properties[$Key]
  if (-not $property) { throw "missing key $Key in secret $Name" }
  return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($property.Value))
}

function Test-Secret([string]$Name) {
  $result = kubectl --context $Context -n $Namespace get secret $Name --ignore-not-found -o name
  return [bool]$result
}

function New-ExporterSecret([string]$Name, [hashtable]$Values) {
  $file = [IO.Path]::GetTempFileName()
  try {
    $lines = foreach ($key in $Values.Keys) { "$key=$($Values[$key])" }
    $text = (($lines -join "`n") + "`n")
    [IO.File]::WriteAllText($file, $text, (New-Object System.Text.UTF8Encoding($false)))
    kubectl --context $Context -n $Namespace create secret generic $Name --from-env-file=$file | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "failed to create secret $Name" }
  } finally {
    Remove-Item $file -Force -ErrorAction SilentlyContinue
  }
}

foreach ($db in $databases) {
  if (Test-Secret $db.ExporterSecret) {
    $exporterPassword = Get-SecretValue $db.ExporterSecret 'password'
  } else {
    $exporterPassword = New-Password
    New-ExporterSecret $db.ExporterSecret @{
      username = 'postgres_exporter'
      password = $exporterPassword
    }
  }

  $adminUser = Get-SecretValue $db.AdminSecret 'POSTGRES_USER'
  $sql = @"
\set password '$exporterPassword'
SELECT 'CREATE ROLE postgres_exporter LOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'postgres_exporter')\gexec
ALTER ROLE postgres_exporter WITH PASSWORD :'password';
GRANT pg_monitor TO postgres_exporter;
GRANT CONNECT ON DATABASE $($db.Database) TO postgres_exporter;
"@

  $sql | kubectl --context $Context -n $Namespace exec -i $db.Pod -- psql -U $adminUser -d $db.Database -v ON_ERROR_STOP=1 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "PostgreSQL bootstrap failed for $($db.Name)" }
  Write-Output "PostgreSQL exporter user ready: $($db.Name)"
}

if (Test-Secret $mongo.ExporterSecret) {
  $mongoPassword = Get-SecretValue $mongo.ExporterSecret 'password'
  $mongoUri = Get-SecretValue $mongo.ExporterSecret 'mongodb-uri'
  if (-not $mongoPassword) {
    if ($mongoUri -match '^mongodb://mongodb_exporter:([^@]+)@') {
      $mongoPassword = $matches[1]
    } else {
      throw 'existing MongoDB exporter Secret has no password key and the URI format is unexpected'
    }
  }
} else {
  $mongoPassword = New-Password
  $mongoUri = "mongodb://mongodb_exporter:$mongoPassword@$($mongo.Service):27017/admin?authSource=admin"
  New-ExporterSecret $mongo.ExporterSecret @{
    'mongodb-uri' = $mongoUri
    password = $mongoPassword
  }
}

$rootUser = Get-SecretValue $mongo.AdminSecret 'MONGO_ROOT_USERNAME'
$rootPass = Get-SecretValue $mongo.AdminSecret 'MONGO_ROOT_PASSWORD'
$js = @"
const admin = db.getSiblingDB('admin');
const roles = [{ role: 'clusterMonitor', db: 'admin' }, { role: 'read', db: 'local' }];
const existing = admin.getUser('mongodb_exporter');
if (existing) {
  admin.updateUser('mongodb_exporter', { pwd: '$mongoPassword', roles });
} else {
  admin.createUser({ user: 'mongodb_exporter', pwd: '$mongoPassword', roles });
}
print('mongodb exporter user ready');
"@

$js | kubectl --context $Context -n $Namespace exec -i $mongo.Pod -- mongosh --quiet --username $rootUser --password $rootPass --authenticationDatabase admin | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'MongoDB bootstrap failed' }
Write-Output 'MongoDB exporter user ready'

Write-Output 'Exporter bootstrap complete.'
