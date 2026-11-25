# QA traffic load for the Triplanner Prometheus dashboards.
#
# Drives the public web GraphQL proxy (not the internal services) with a
# temporary trip, rotating reads/searches and agent suggestions. It also sends
# a few email invitations so the trips outbox, broker and email consumer see
# traffic. The temporary trip is deleted at the end.
#
#   powershell -ExecutionPolicy Bypass -File scripts/qa-load-traffic.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/qa-load-traffic.ps1 -DurationSeconds 300 -DelayMs 250

param(
  [string]$BaseUrl = 'http://127.0.0.1:9080',
  [string]$HostHeader = 'triplanner.localhost',
  [string]$UserId = '11111111-1111-4111-8111-111111111111',
  [int]$DurationSeconds = 180,
  [int]$DelayMs = 200,
  [int]$Invites = 3,
  [switch]$UseDemoTrip
)

$ErrorActionPreference = 'Stop'
$ops = @{}
$summary = [ordered]@{
  baseUrl = $BaseUrl
  hostHeader = $HostHeader
  durationSeconds = $DurationSeconds
  delayMs = $DelayMs
  attempts = 0
  errors = 0
  iterations = 0
  tempTripId = $null
  cleanup = 'not needed'
  lastError = $null
}

function Track([string]$name) {
  if (-not $ops.ContainsKey($name)) { $ops[$name] = 0 }
  $ops[$name]++
}

function Invoke-Gql([string]$name, [string]$query, [hashtable]$variables = @{}) {
  $body = @{ query = $query }
  if ($variables.Count -gt 0) { $body.variables = $variables }
  $payload = $body | ConvertTo-Json -Depth 10 -Compress
  $summary['attempts']++
  $bodyFile = [IO.Path]::GetTempFileName()
  try {
    [IO.File]::WriteAllText($bodyFile, $payload, [Text.UTF8Encoding]::new($false))
    $raw = & curl.exe -sS --max-time 120 `
      -H "Host: $HostHeader" `
      -H "x-user-id: $UserId" `
      -H "Content-Type: application/json" `
      --data-binary "@$bodyFile" `
      "$BaseUrl/api/graphql" 2>&1
    $curlExit = $LASTEXITCODE
  } finally {
    Remove-Item $bodyFile -Force -ErrorAction SilentlyContinue
  }
  if ($curlExit -ne 0) {
    $summary['errors']++
    $summary['lastError'] = "curl exit $curlExit"
    return $null
  }
  try {
    $response = (($raw -join "`n") | ConvertFrom-Json)
  } catch {
    $summary['errors']++
    $summary['lastError'] = 'response was not valid JSON'
    return $null
  }
  if ($response.errors -and $response.errors.Count -gt 0) {
    $summary['errors']++
    $summary['lastError'] = $response.errors[0].message
    return $null
  }
  Track $name
  return $response.data
}

function Invoke-Agent([string]$name, [string]$path, [hashtable]$body) {
  $payload = $body | ConvertTo-Json -Depth 10 -Compress
  $summary['attempts']++
  $bodyFile = [IO.Path]::GetTempFileName()
  try {
    [IO.File]::WriteAllText($bodyFile, $payload, [Text.UTF8Encoding]::new($false))
    $raw = & curl.exe -sS --max-time 150 `
      -H "Host: $HostHeader" `
      -H "x-user-id: $UserId" `
      -H "Content-Type: application/json" `
      --data-binary "@$bodyFile" `
      "$BaseUrl/api/agent/$path" 2>&1
    $curlExit = $LASTEXITCODE
  } finally {
    Remove-Item $bodyFile -Force -ErrorAction SilentlyContinue
  }
  if ($curlExit -ne 0) {
    $summary['errors']++
    $summary['lastError'] = "curl exit $curlExit"
    return $null
  }
  try {
    $response = (($raw -join "`n") | ConvertFrom-Json)
  } catch {
    $summary['errors']++
    $summary['lastError'] = 'agent response was not valid JSON'
    return $null
  }
  if ($response.error) {
    $summary['errors']++
    $summary['lastError'] = $response.error.message
    return $null
  }
  Track $name
  return $response
}

$tripId = $null
$tripDay = $null
$iteration = 0

try {
  if ($UseDemoTrip) {
    $tripId = 'demo-trip'
    $trip = Invoke-Gql 'getTrip' 'query($id: ID!) { getTrip(id: $id) { id name startDate endDate } }' @{ id = $tripId }
    if (-not $trip) { throw 'could not read the demo trip' }
    $tripDay = $trip.getTrip.startDate
  } else {
    $input = @{
      name = "QA load $(Get-Date -Format 'yyyyMMdd-HHmmss')"
      destinationId = 'toronto'
      destinationName = 'Toronto'
      startDate = (Get-Date).AddDays(30).ToString('yyyy-MM-dd')
      endDate = (Get-Date).AddDays(32).ToString('yyyy-MM-dd')
      totalBudget = 750
      displayName = 'Marco'
      timezone = 'America/Toronto'
    }
    $created = Invoke-Gql 'createTrip' `
      'mutation($input: CreateTripInput!) { createTrip(input: $input) { id name startDate endDate } }' `
      @{ input = $input }
    if (-not $created) { throw 'createTrip failed; see lastError' }
    $tripId = $created.createTrip.id
    $tripDay = $created.createTrip.startDate
    $summary['tempTripId'] = $tripId

    for ($i = 1; $i -le $Invites; $i++) {
      Invoke-Gql 'sendTripInvite' `
        'mutation($tripId: ID!, $email: String!, $role: String) { sendTripInvite(tripId: $tripId, email: $email, role: $role) { invitationId status code } }' `
        @{ tripId = $tripId; email = "qa-load-$i@example.test"; role = 'viewer' } | Out-Null
    }
  }

  $queries = @(
    'CN Tower', 'Royal Ontario Museum', 'restaurant', 'museum', 'park',
    'coffee', 'bar', 'art gallery', 'harbour', 'market', 'pizza', 'sushi'
  )
  $login = 'mutation { login(username: "demo", password: "demo123") { userId username } }'
  $listTrips = 'query { listMyTrips { tripId tripName destinationName startDate endDate role } }'
  $getTrip = 'query($id: ID!) { getTrip(id: $id) { id name startDate endDate totalBudget spent items { id title category } } }'
  $search = 'query($q: String!) { searchLocations(q: $q) { name category rating } }'
  $activities = 'query { listActivities(destSlug: "toronto") { id name category } }'
  $destinations = 'query { listDestinations { slug name country } }'
  $notifications = 'query { myNotifications { id type tripName status } }'
  $profile = 'query { getMyProfile { userId username displayName } }'
  $suggestions = 'mutation($tripId: ID!, $day: AWSDate!) { requestSuggestions(tripId: $tripId, day: $day) { day items { title category } } }'

  $deadline = (Get-Date).AddSeconds($DurationSeconds)
  while ((Get-Date) -lt $deadline) {
    $iteration++
    Invoke-Gql 'login' $login | Out-Null
    Invoke-Gql 'listMyTrips' $listTrips | Out-Null
    Invoke-Gql 'getTrip' $getTrip @{ id = $tripId } | Out-Null
    Invoke-Gql 'searchLocations' $search @{ q = $queries[$iteration % $queries.Count] } | Out-Null

    if ($iteration % 15 -eq 0) {
      Invoke-Gql 'listDestinations' $destinations | Out-Null
      Invoke-Gql 'listActivities' $activities | Out-Null
    }
    if ($iteration % 20 -eq 0) {
      Invoke-Gql 'myNotifications' $notifications | Out-Null
      Invoke-Gql 'getMyProfile' $profile | Out-Null
    }
    if ($iteration % 10 -eq 0) {
      Invoke-Gql 'requestSuggestions' $suggestions @{ tripId = $tripId; day = $tripDay } | Out-Null
    }
    if ($iteration % 8 -eq 0) {
      Invoke-Agent 'agentSuggestions' 'suggestions' @{
        tripId = $tripId
        messages = @(@{ role = 'user'; content = 'What should I do in Toronto?' })
        locale = 'en'
        day = $tripDay
      } | Out-Null
    }
    if ($iteration % 24 -eq 0) {
      Invoke-Agent 'agentDayPlan' 'day-plan' @{ tripId = $tripId; locale = 'en' } | Out-Null
    }

    Start-Sleep -Milliseconds $DelayMs
  }
} finally {
  $summary['iterations'] = $iteration
  $summary['operations'] = $ops
  if ($tripId -and -not $UseDemoTrip) {
    $deleted = Invoke-Gql 'deleteTrip' 'mutation($tripId: ID!) { deleteTrip(tripId: $tripId) }' @{ tripId = $tripId }
    $summary['cleanup'] = if ($deleted) { 'deleted' } else { 'delete failed; see lastError' }
  }
  $summary | ConvertTo-Json -Depth 6
}
