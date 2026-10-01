param(
  [Parameter(Mandatory = $true)][int] $PullRequest,
  [string] $Repository
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'local-common.ps1')
if ($PullRequest -lt 1) { throw 'PullRequest must be a positive integer.' }
$config = Get-ReviewBotConfig
$repositories = @(Get-GiteeRepositories $config)
if (-not $Repository -and $config.giteeEnabled) { $Repository = "$($config.giteeOwner)/$($config.giteeRepo)" }
$selected = @($repositories | Where-Object { "$($_.owner)/$($_.name)" -ieq $Repository })
if ($selected.Count -ne 1) { throw 'Gitee repository is not configured or is ambiguous.' }
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$env:PGPASSWORD = Read-ReviewBotSecret $config.databasePasswordFile
$env:DATABASE_URL = $config.databaseUrl
$workerRepositories = @()
foreach ($repository in $repositories) {
  $workerRepositories += @{
    id = [string] $repository.id
    owner = [string] $repository.owner
    name = [string] $repository.name
    token = Read-ReviewBotSecret $repository.tokenFile
  }
}
$env:GITEE_REPOSITORIES_JSON = ConvertTo-Json -InputObject @($workerRepositories) -Compress -Depth 4
try {
  Push-Location $root
  try {
    & npm.cmd run gitee:review -- $selected[0].owner $selected[0].name $PullRequest
    if ($LASTEXITCODE -ne 0) { throw 'Gitee review could not be queued.' }
  } finally { Pop-Location }
} finally {
  Remove-Item Env:PGPASSWORD, Env:DATABASE_URL, Env:GITEE_REPOSITORIES_JSON -ErrorAction SilentlyContinue
}
