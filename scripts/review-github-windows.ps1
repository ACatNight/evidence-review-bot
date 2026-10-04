param(
  [Parameter(Mandatory = $true)][string] $Owner,
  [Parameter(Mandatory = $true)][string] $Repository,
  [Parameter(Mandatory = $true)][int] $PullRequest
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'local-common.ps1')
if ($PullRequest -lt 1) { throw 'PullRequest must be a positive integer.' }
$config = Get-ReviewBotConfig
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$env:PGPASSWORD = Read-ReviewBotSecret $config.databasePasswordFile
$env:DATABASE_URL = $config.databaseUrl
$env:GITHUB_APP_ID = [string] $config.githubAppId
$env:GITHUB_PRIVATE_KEY_PATH = $config.githubPrivateKeyPath
try {
  Push-Location $root
  try {
    & npm.cmd run github:review -- $Owner $Repository $PullRequest
    $resultCode = $LASTEXITCODE
  } finally { Pop-Location }
} finally {
  Remove-Item Env:PGPASSWORD, Env:DATABASE_URL, Env:GITHUB_APP_ID, Env:GITHUB_PRIVATE_KEY_PATH -ErrorAction SilentlyContinue
}
exit $resultCode
