$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'local-common.ps1')

$runPath = Join-Path (Get-ReviewBotHome) 'local-run.json'
if (-not (Test-Path -LiteralPath $runPath -PathType Leaf)) {
  Write-Output 'No managed API or worker is running.'
  exit 0
}
$run = Get-Content -LiteralPath $runPath -Raw | ConvertFrom-Json
foreach ($name in @('worker', 'api')) {
  $entry = $run.$name
  if (Test-ReviewBotProcess $entry) {
    Stop-Process -Id ([int] $entry.pid)
    Write-Output "Stopped $name (PID $($entry.pid))."
  }
}
Remove-Item -LiteralPath $runPath
