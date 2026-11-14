# Sets the public GitHub repository description and topics.
# Requires a token with repository administration permission.
#
# Usage (PowerShell):
#   $env:GITHUB_TOKEN = "github_pat_..."
#   powershell -File scripts/set-repo-metadata.ps1
param(
  [string]$Owner = 'MarcoJr1312',
  [string]$Repo = 'local_triplanner',
  [string]$Token = $env:GITHUB_TOKEN
)

$ErrorActionPreference = 'Stop'

if (-not $Token) {
  throw 'Set GITHUB_TOKEN to a token with repository administration permission.'
}

$headers = @{
  Authorization = "Bearer $Token"
  Accept = 'application/vnd.github+json'
  'User-Agent' = 'triplanner-repo-metadata'
}

$description = 'Local-only collaborative travel-planner demo: Next.js, Bun GraphQL, FastAPI, PostgreSQL + MongoDB, one-command Docker Compose.'
$repoBody = @{
  description = $description
  homepage = "https://github.com/$Owner/$Repo"
  has_issues = $true
  has_wiki = $false
} | ConvertTo-Json

Invoke-RestMethod -Method Patch `
  -Uri "https://api.github.com/repos/$Owner/$Repo" `
  -Headers $headers `
  -Body $repoBody `
  -ContentType 'application/json' | Out-Null

$topics = @(
  'nextjs', 'react', 'typescript', 'bun', 'graphql', 'fastapi', 'python',
  'postgresql', 'mongodb', 'pgvector', 'docker-compose', 'travel-planner', 'demo'
)
$topicsBody = @{ names = $topics } | ConvertTo-Json
Invoke-RestMethod -Method Put `
  -Uri "https://api.github.com/repos/$Owner/$Repo/topics" `
  -Headers $headers `
  -Body $topicsBody `
  -ContentType 'application/json' | Out-Null

Write-Output "Updated $Owner/$Repo description and topics."
