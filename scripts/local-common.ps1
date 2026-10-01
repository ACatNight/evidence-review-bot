function Get-ReviewBotHome {
  if ($env:EVIDENCE_REVIEW_BOT_HOME) { return $env:EVIDENCE_REVIEW_BOT_HOME }
  if (Test-Path -LiteralPath 'D:\Tools\evidence-review-bot' -PathType Container) {
    return 'D:\Tools\evidence-review-bot'
  }
  return (Join-Path $env:LOCALAPPDATA 'EvidenceReviewBot')
}

function Get-ReviewBotConfig {
  $path = Join-Path (Get-ReviewBotHome) 'local-config.json'
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Configuration not found at $path. Run scripts/configure-windows.ps1 first."
  }
  return (Get-Content -LiteralPath $path -Raw | ConvertFrom-Json)
}

function Read-ReviewBotSecret([string] $path) {
  if (-not $path -or -not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Secret file not found: $path"
  }
  if ($path.EndsWith('.dpapi', [StringComparison]::OrdinalIgnoreCase)) {
    $secure = Get-Content -LiteralPath $path -Raw | ConvertTo-SecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
  }
  return (Get-Content -LiteralPath $path -Raw).Trim()
}

function Test-ReviewBotProcess($entry) {
  if (-not $entry -or -not $entry.pid -or -not $entry.startedAt) { return $false }
  $process = Get-Process -Id ([int] $entry.pid) -ErrorAction SilentlyContinue
  if (-not $process) { return $false }
  return $process.StartTime.ToUniversalTime().ToString('o') -eq ([datetime] $entry.startedAt).ToUniversalTime().ToString('o')
}
