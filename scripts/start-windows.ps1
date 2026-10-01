$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'local-common.ps1')

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$homeDirectory = Get-ReviewBotHome
$config = Get-ReviewBotConfig
$runPath = Join-Path $homeDirectory 'local-run.json'
if (Test-Path -LiteralPath $runPath) {
  $previous = Get-Content -LiteralPath $runPath -Raw | ConvertFrom-Json
  if ((Test-ReviewBotProcess $previous.api) -or (Test-ReviewBotProcess $previous.worker) -or (Test-ReviewBotProcess $previous.tunnel)) {
    throw 'This deployment is already running. Use scripts/stop-windows.ps1 first.'
  }
  Remove-Item -LiteralPath $runPath
}

if ($config.postgresCtlPath) {
  & $config.postgresCtlPath -D $config.postgresDataPath status *> $null
  if ($LASTEXITCODE -ne 0) {
    & $config.postgresCtlPath -D $config.postgresDataPath -l (Join-Path $homeDirectory 'postgres.log') start
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL did not start.' }
  }
}

$api = $null
$worker = $null
$tunnel = $null
try {
  Push-Location $root
  try {
    if (-not (Test-Path -LiteralPath (Join-Path $root 'node_modules') -PathType Container)) {
      & npm.cmd ci --ignore-scripts
      if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
    }
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
    $env:PGPASSWORD = Read-ReviewBotSecret $config.databasePasswordFile
    $env:DATABASE_URL = $config.databaseUrl
    & node (Join-Path $root 'dist/src/entrypoints/migrate.js')
    if ($LASTEXITCODE -ne 0) { throw 'Database migration failed.' }
  } finally { Pop-Location }

  $listener = [Net.Sockets.TcpClient]::new()
  try {
    $connection = $listener.BeginConnect('127.0.0.1', [int] $config.port, $null, $null)
    if ($connection.AsyncWaitHandle.WaitOne(500)) {
      try { $listener.EndConnect($connection); throw "Port $($config.port) is already in use." }
      catch [Net.Sockets.SocketException] { }
    }
  } finally { $listener.Dispose() }

  Remove-Item Env:OPENAI_API_KEY, Env:OPENAI_MODEL, Env:OPENAI_BASE_URL, Env:OPENAI_ALLOWED_REPOSITORIES, Env:OPENAI_REVIEW_ENABLED, Env:GITHUB_APP_ID, Env:GITHUB_PRIVATE_KEY_PATH, Env:REVIEW_HMAC_KEY, Env:GITEE_API_TOKEN, Env:GITEE_OWNER, Env:GITEE_REPO, Env:GITEE_REPOSITORY_ID, Env:GITEE_WEBHOOK_SECRET -ErrorAction SilentlyContinue
  $env:GITHUB_WEBHOOK_SECRET = Read-ReviewBotSecret $config.githubWebhookSecretFile
  if ($config.giteeEnabled -and $config.giteeWebhookSecretFile) {
    $env:GITEE_WEBHOOK_SECRET = Read-ReviewBotSecret $config.giteeWebhookSecretFile
    $env:GITEE_REPOSITORY_ID = [string] $config.giteeRepositoryId
  }
  $env:PORT = [string] $config.port
  $env:HOST = '127.0.0.1'
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $api = Start-Process -FilePath $node -ArgumentList 'dist/src/entrypoints/api.js' -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $homeDirectory 'api-out.log') -RedirectStandardError (Join-Path $homeDirectory 'api-error.log') -PassThru
  $healthy = $false
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Milliseconds 500
    try {
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:$($config.port)/healthz" -TimeoutSec 2
      if ($health.status -eq 'ok') { $healthy = $true; break }
    } catch { }
    if ($api.HasExited) { break }
  }
  if (-not $healthy) { throw 'API health check failed. See api-error.log in the configuration directory.' }

  Remove-Item Env:GITHUB_WEBHOOK_SECRET -ErrorAction SilentlyContinue
  Remove-Item Env:GITEE_WEBHOOK_SECRET -ErrorAction SilentlyContinue
  $env:GITHUB_APP_ID = [string] $config.githubAppId
  $env:GITHUB_PRIVATE_KEY_PATH = $config.githubPrivateKeyPath
  $env:REVIEW_HMAC_KEY = Read-ReviewBotSecret $config.reviewHmacKeyFile
  if ($config.giteeEnabled) {
    $env:GITEE_API_TOKEN = Read-ReviewBotSecret $config.giteeTokenFile
    $env:GITEE_OWNER = $config.giteeOwner
    $env:GITEE_REPO = $config.giteeRepo
    $env:GITEE_REPOSITORY_ID = [string] $config.giteeRepositoryId
  }
  $env:OPENAI_REVIEW_ENABLED = if ($config.aiEnabled) { 'true' } else { 'false' }
  if ($config.aiEnabled) {
    $env:OPENAI_API_KEY = Read-ReviewBotSecret $config.aiKeyFile
    $env:OPENAI_MODEL = $config.aiModel
    $env:OPENAI_ALLOWED_REPOSITORIES = $config.aiRepositories
    if ($config.aiBaseUrl) { $env:OPENAI_BASE_URL = $config.aiBaseUrl }
  } else {
    Remove-Item Env:OPENAI_API_KEY, Env:OPENAI_MODEL, Env:OPENAI_BASE_URL, Env:OPENAI_ALLOWED_REPOSITORIES -ErrorAction SilentlyContinue
  }
  $worker = Start-Process -FilePath $node -ArgumentList 'dist/src/entrypoints/worker.js' -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $homeDirectory 'worker-out.log') -RedirectStandardError (Join-Path $homeDirectory 'worker-error.log') -PassThru
  Start-Sleep -Seconds 1
  if ($worker.HasExited) { throw 'Worker stopped unexpectedly. See worker-error.log in the configuration directory.' }

  if ($config.ngrokEnabled) {
    $supportsUrl = (& $config.ngrokExecutablePath http --help | Select-String -SimpleMatch '--url string' -Quiet)
    $endpointArgument = if ($supportsUrl) { "--url=https://$($config.ngrokDomain)" }
    else { "--domain=$($config.ngrokDomain)" }
    $env:NGROK_AUTHTOKEN = Read-ReviewBotSecret $config.ngrokAuthtokenFile
    try {
      $tunnel = Start-Process -FilePath $config.ngrokExecutablePath -ArgumentList @('http', "127.0.0.1:$($config.port)", $endpointArgument, '--log=stdout', '--log-format=json') -WorkingDirectory $homeDirectory -WindowStyle Hidden -RedirectStandardOutput (Join-Path $homeDirectory 'tunnel-out.log') -RedirectStandardError (Join-Path $homeDirectory 'tunnel-error.log') -PassThru
    } finally {
      Remove-Item Env:NGROK_AUTHTOKEN -ErrorAction SilentlyContinue
    }
    $publicHealthy = $false
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
      Start-Sleep -Seconds 1
      if ($tunnel.HasExited) { break }
      try {
        $health = Invoke-RestMethod -Uri "https://$($config.ngrokDomain)/healthz" -Headers @{ 'ngrok-skip-browser-warning' = 'true' } -TimeoutSec 3
        if ($health.status -eq 'ok') { $publicHealthy = $true; break }
      } catch { }
    }
    if (-not $publicHealthy) { throw 'Public tunnel health check failed. See tunnel-error.log and tunnel-out.log in the configuration directory.' }
  }

  $run = [ordered]@{
    api = @{ pid = $api.Id; startedAt = $api.StartTime.ToUniversalTime().ToString('o') }
    worker = @{ pid = $worker.Id; startedAt = $worker.StartTime.ToUniversalTime().ToString('o') }
  }
  if ($tunnel) { $run.tunnel = @{ pid = $tunnel.Id; startedAt = $tunnel.StartTime.ToUniversalTime().ToString('o') } }
  $run | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $runPath -Encoding UTF8
  Write-Output "API and worker started. Health: http://127.0.0.1:$($config.port)/healthz"
  if ($config.publicWebhookUrl) { Write-Output "GitHub App Webhook URL: $($config.publicWebhookUrl)" }
  else { Write-Output 'Set an HTTPS public URL ending in /webhooks/github in the GitHub App.' }
  if ($config.ngrokEnabled -and $config.giteeEnabled) { Write-Output "Gitee Webhook URL: https://$($config.ngrokDomain)/webhooks/gitee" }
} catch {
  if ($tunnel -and -not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id -ErrorAction SilentlyContinue }
  if ($worker -and -not $worker.HasExited) { Stop-Process -Id $worker.Id -ErrorAction SilentlyContinue }
  if ($api -and -not $api.HasExited) { Stop-Process -Id $api.Id -ErrorAction SilentlyContinue }
  throw
} finally {
  Remove-Item Env:PGPASSWORD, Env:DATABASE_URL, Env:GITHUB_APP_ID, Env:GITHUB_PRIVATE_KEY_PATH, Env:GITHUB_WEBHOOK_SECRET, Env:REVIEW_HMAC_KEY, Env:OPENAI_API_KEY, Env:OPENAI_MODEL, Env:OPENAI_BASE_URL, Env:OPENAI_ALLOWED_REPOSITORIES, Env:OPENAI_REVIEW_ENABLED, Env:GITEE_API_TOKEN, Env:GITEE_OWNER, Env:GITEE_REPO, Env:GITEE_REPOSITORY_ID, Env:GITEE_WEBHOOK_SECRET, Env:NGROK_AUTHTOKEN -ErrorAction SilentlyContinue
}
