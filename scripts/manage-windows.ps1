$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'local-common.ps1')

while ($true) {
  Write-Host ''
  Write-Host 'Evidence Review Bot - Windows'
  Write-Host '1. 配置资料（首次使用 / 修改配置）'
  Write-Host '2. 启动服务（安装依赖、构建、迁移和启动）'
  Write-Host '3. 检查运行状态和接入步骤'
  Write-Host '4. 停止服务'
  Write-Host '5. 复制 Webhook 密钥到剪贴板（用于平台设置）'
  Write-Host '0. 退出'
  $choice = Read-Host '请选择 0-5'
  if ($choice -eq '0') { break }
  if ($choice -eq '5') {
    try {
      $config = Get-ReviewBotConfig
      $platform = Read-Host '复制哪个平台的密钥？输入 github 或 gitee'
      $secretPath = switch ($platform) {
        'github' { $config.githubWebhookSecretFile }
        'gitee' { $config.giteeWebhookSecretFile }
        default { throw '请输入 github 或 gitee。' }
      }
      Read-ReviewBotSecret $secretPath | Set-Clipboard
      Write-Host '已复制。请粘贴到平台的 Webhook 密钥设置中；不要发送到聊天或 Issue。'
    } catch { Write-Host '复制失败，请先配置对应平台，并确认密钥文件可读取。' }
    continue
  }
  $scriptName = switch ($choice) {
    '1' { 'configure-windows.ps1' }
    '2' { 'start-windows.ps1' }
    '3' { 'status-windows.ps1' }
    '4' { 'stop-windows.ps1' }
    default { $null }
  }
  if (-not $scriptName) { Write-Host '请选择 0-5。'; continue }
  if ($choice -eq '2' -and -not (Test-Path -LiteralPath (Join-Path (Get-ReviewBotHome) 'local-config.json'))) {
    Write-Host '尚未配置，请先选择 1。'
    continue
  }
  # A child PowerShell keeps secrets and environment changes out of the menu process.
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot $scriptName)
  if ($LASTEXITCODE -ne 0) { Write-Host '操作失败。请查看上方原因；选择 3 可查看运行状态和日志位置。' }
}
