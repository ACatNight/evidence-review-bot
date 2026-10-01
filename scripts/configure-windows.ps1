param([string] $StateDirectory)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'local-common.ps1')

function Ask([string] $label, [string] $default = '') {
  $suffix = if ($default) { " [$default]" } else { '' }
  $answer = Read-Host "$label$suffix"
  if ($answer) { return $answer.Trim() }
  return $default
}

function Require-File([string] $label, [string] $path) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "$label does not exist: $path"
  }
}

if ($StateDirectory) { $env:EVIDENCE_REVIEW_BOT_HOME = $StateDirectory }
$homeDirectory = Get-ReviewBotHome
New-Item -ItemType Directory -Path $homeDirectory -Force | Out-Null
$priorPath = Join-Path $homeDirectory 'local-config.json'
$prior = if (Test-Path -LiteralPath $priorPath) {
  Get-Content -LiteralPath $priorPath -Raw | ConvertFrom-Json
} else { $null }

$databaseUrl = Ask 'PostgreSQL DATABASE_URL (without password)' $prior.databaseUrl
$databasePasswordFile = Ask 'PostgreSQL password file (.dpapi or text)' $prior.databasePasswordFile
$appId = Ask 'GitHub App ID' $prior.githubAppId
$privateKeyPath = Ask 'GitHub App private key PEM path' $prior.githubPrivateKeyPath
$webhookSecretFile = Ask 'GitHub App Webhook Secret file (.dpapi or text)' $prior.githubWebhookSecretFile
$reviewHmacKeyFile = Ask 'Review HMAC key file (.dpapi or text)' $prior.reviewHmacKeyFile
$port = Ask 'Local API port' $(if ($prior.port) { [string] $prior.port } else { '3000' })
$postgresCtlPath = Ask 'pg_ctl.exe path (blank if PostgreSQL is managed separately)' $prior.postgresCtlPath
$postgresDataPath = if ($postgresCtlPath) {
  Ask 'PostgreSQL data directory' $prior.postgresDataPath
} else { '' }
$publicWebhookUrl = Ask 'Public HTTPS Webhook URL (optional)' $prior.publicWebhookUrl
$giteeDefault = if ($prior.giteeEnabled) { 'y' } else { 'n' }
$giteeEnabled = (Ask 'Enable Gitee PR review? (y/n)' $giteeDefault) -match '^[yY]$'
$giteeTokenFile = ''
$giteeOwner = ''
$giteeRepo = ''
$giteeRepositoryId = ''
$giteeWebhookSecretFile = ''
if ($giteeEnabled) {
  $giteeTokenFile = Ask 'Gitee API token file (.dpapi or text)' $prior.giteeTokenFile
  $giteeOwner = Ask 'Gitee repository owner' $prior.giteeOwner
  $giteeRepo = Ask 'Gitee repository name' $prior.giteeRepo
  $giteeRepositoryId = Ask 'Gitee numeric repository ID' $prior.giteeRepositoryId
  $giteeWebhookSecretFile = Ask 'Gitee Webhook signing key file (optional until webhook setup)' $prior.giteeWebhookSecretFile
}
$aiDefault = if ($prior.aiEnabled) { 'y' } else { 'n' }
$aiEnabled = (Ask 'Enable AI review for selected repositories? (y/n)' $aiDefault) -match '^[yY]$'
$aiKeyFile = ''
$aiModel = ''
$aiBaseUrl = ''
$aiRepositories = ''
if ($aiEnabled) {
  $aiKeyFile = Ask 'AI API key file (.dpapi or text)' $prior.aiKeyFile
  $aiModel = Ask 'AI model' $prior.aiModel
  $aiBaseUrl = Ask 'AI HTTPS base URL (blank for official OpenAI)' $prior.aiBaseUrl
  $aiRepositories = Ask 'Allowed GitHub numeric repository IDs (comma-separated)' $prior.aiRepositories
}

try { $databaseUri = [uri] $databaseUrl } catch { throw 'DATABASE_URL must be a PostgreSQL URL.' }
if (-not $databaseUrl -or $databaseUri.Scheme -notin @('postgres', 'postgresql')) {
  throw 'DATABASE_URL must be a PostgreSQL URL.'
}
if ($databaseUri.UserInfo -match ':' -or $databaseUri.Query -or $databaseUri.Fragment) {
  throw 'Put the database password in its separate file, not DATABASE_URL.'
}
if ($appId -notmatch '^\d+$') { throw 'GitHub App ID must be numeric.' }
if ($port -notmatch '^\d+$' -or [int] $port -lt 1 -or [int] $port -gt 65535) {
  throw 'Port must be between 1 and 65535.'
}
Require-File 'Database password' $databasePasswordFile
Require-File 'GitHub private key' $privateKeyPath
Require-File 'Webhook secret' $webhookSecretFile
Require-File 'Review HMAC key' $reviewHmacKeyFile
if ((Read-ReviewBotSecret $webhookSecretFile).Length -lt 32) {
  throw 'Webhook Secret must contain at least 32 characters.'
}
$hmac = Read-ReviewBotSecret $reviewHmacKeyFile
if ($hmac -notmatch '^[a-fA-F0-9]{64,}$' -or $hmac.Length % 2 -ne 0) {
  throw 'Review HMAC key must be even-length hexadecimal with at least 64 characters.'
}
if ($postgresCtlPath) {
  Require-File 'pg_ctl.exe' $postgresCtlPath
  if (-not (Test-Path -LiteralPath $postgresDataPath -PathType Container)) {
    throw "PostgreSQL data directory does not exist: $postgresDataPath"
  }
}
if ($publicWebhookUrl -and $publicWebhookUrl -notmatch '^https://.+/webhooks/github$') {
  throw 'Public Webhook URL must be HTTPS and end in /webhooks/github.'
}
if ($giteeEnabled) {
  Require-File 'Gitee API token' $giteeTokenFile
  if ($giteeOwner -notmatch '^[A-Za-z0-9_.-]+$' -or
      $giteeRepo -notmatch '^[A-Za-z0-9_.-]+$' -or
      $giteeRepositoryId -notmatch '^\d+$') {
    throw 'Gitee owner, repository name or numeric repository ID is invalid.'
  }
  if ($giteeWebhookSecretFile) {
    Require-File 'Gitee Webhook signing key' $giteeWebhookSecretFile
    if ((Read-ReviewBotSecret $giteeWebhookSecretFile).Length -lt 32) {
      throw 'Gitee Webhook signing key must contain at least 32 characters.'
    }
  }
}
if ($aiEnabled) {
  Require-File 'AI API key' $aiKeyFile
  if (-not $aiModel -or $aiRepositories -notmatch '^\d+(,\s*\d+)*$') {
    throw 'AI model and numeric repository allowlist are required.'
  }
  if ($aiBaseUrl) {
    try { $aiUri = [uri] $aiBaseUrl } catch { throw 'AI base URL must use HTTPS.' }
    if ($aiUri.Scheme -ne 'https' -or $aiUri.UserInfo -or $aiUri.Query -or $aiUri.Fragment) {
      throw 'AI base URL must use HTTPS without credentials, query or fragment.'
    }
  }
}

$config = [ordered]@{
  databaseUrl = $databaseUrl
  databasePasswordFile = $databasePasswordFile
  githubAppId = $appId
  githubPrivateKeyPath = $privateKeyPath
  githubWebhookSecretFile = $webhookSecretFile
  reviewHmacKeyFile = $reviewHmacKeyFile
  port = [int] $port
  postgresCtlPath = $postgresCtlPath
  postgresDataPath = $postgresDataPath
  publicWebhookUrl = $publicWebhookUrl
  giteeEnabled = $giteeEnabled
  giteeTokenFile = $giteeTokenFile
  giteeOwner = $giteeOwner
  giteeRepo = $giteeRepo
  giteeRepositoryId = $giteeRepositoryId
  giteeWebhookSecretFile = $giteeWebhookSecretFile
  aiEnabled = $aiEnabled
  aiKeyFile = $aiKeyFile
  aiModel = $aiModel
  aiBaseUrl = $aiBaseUrl
  aiRepositories = $aiRepositories
}
$config | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $priorPath -Encoding UTF8
Write-Output "Configuration saved: $priorPath"
Write-Output 'Run scripts/start-windows.ps1 to start the API and worker.'
