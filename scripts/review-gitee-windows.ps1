param([Parameter(Mandatory = $true)][int] $PullRequest)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'local-common.ps1')
if ($PullRequest -lt 1) { throw 'PullRequest must be a positive integer.' }
$config = Get-ReviewBotConfig
if (-not $config.giteeEnabled) { throw 'Gitee is not enabled. Run configure-windows.ps1 first.' }
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$env:PGPASSWORD = Read-ReviewBotSecret $config.databasePasswordFile
$env:DATABASE_URL = $config.databaseUrl
$env:GITEE_API_TOKEN = Read-ReviewBotSecret $config.giteeTokenFile
$env:GITEE_OWNER = $config.giteeOwner
$env:GITEE_REPO = $config.giteeRepo
$env:GITEE_REPOSITORY_ID = [string] $config.giteeRepositoryId
try {
  Push-Location $root
  try {
    & npm.cmd run gitee:review -- $PullRequest
    if ($LASTEXITCODE -ne 0) { throw 'Gitee review could not be queued.' }
  } finally { Pop-Location }
} finally {
  Remove-Item Env:PGPASSWORD, Env:DATABASE_URL, Env:GITEE_API_TOKEN, Env:GITEE_OWNER, Env:GITEE_REPO, Env:GITEE_REPOSITORY_ID -ErrorAction SilentlyContinue
}
