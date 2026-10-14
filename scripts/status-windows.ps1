$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'local-common.ps1')
$homeDirectory = Get-ReviewBotHome
Write-Output "Configuration and logs: $homeDirectory"
foreach ($name in @('node.exe', 'npm.cmd', 'git.exe')) {
  $available = [bool] (Get-Command $name -ErrorAction SilentlyContinue)
  Write-Output "$name installed: $available"
}
$configPath = Join-Path $homeDirectory 'local-config.json'
if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
  Write-Output 'Not configured. Choose Configure in review-bot.cmd.'
  exit 0
}
$config = Get-ReviewBotConfig
$runPath = Join-Path $homeDirectory 'local-run.json'
$run = if (Test-Path -LiteralPath $runPath) { Get-Content -LiteralPath $runPath -Raw | ConvertFrom-Json } else { $null }
foreach ($name in @('api', 'worker', 'tunnel')) {
  Write-Output "$name running: $(Test-ReviewBotProcess $run.$name)"
}
try {
  $health = Invoke-RestMethod -Uri "http://127.0.0.1:$($config.port)/healthz" -TimeoutSec 3
  Write-Output "Local API/database health: $($health.status)"
} catch { Write-Output 'Local API/database health: unavailable. Start services or check api-error.log.' }
if ($config.ngrokEnabled) {
  try {
    $health = Invoke-RestMethod -Uri "https://$($config.ngrokDomain)/healthz" -Headers @{ 'ngrok-skip-browser-warning' = 'true' } -TimeoutSec 5
    Write-Output "Public API/database health: $($health.status)"
  } catch { Write-Output 'Public API/database health: unavailable. Check tunnel logs and assigned domain.' }
  Write-Output "GitHub Webhook: https://$($config.ngrokDomain)/webhooks/github"
  if ($config.giteeEnabled) { Write-Output "Gitee Webhook: https://$($config.ngrokDomain)/webhooks/gitee" }
} elseif ($config.publicWebhookUrl) { Write-Output "GitHub Webhook: $($config.publicWebhookUrl)" }
Write-Output "AI enabled: $([bool] $config.aiEnabled)"
foreach ($repository in @(Get-GiteeRepositories $config)) {
  Write-Output "Gitee $($repository.owner)/$($repository.name): webhook key configured = $([bool] $repository.webhookSecretFile)"
}
Write-Output 'Connection checklist: install the GitHub App / configure Gitee WebHook, subscribe to Pull Request, and create a test PR.'
Write-Output 'Health checks confirm API/database reachability only; check platform deliveries and worker-out.log to confirm review and publication.'
Write-Output 'Logs: api-error.log, worker-error.log, worker-out.log, tunnel-error.log (in configuration directory).'
