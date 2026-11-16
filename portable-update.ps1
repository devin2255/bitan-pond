param(
  [Parameter(Mandatory = $true)][int]$ParentId,
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$Target,
  [Parameter(Mandatory = $true)][string]$Sha256,
  [Parameter(Mandatory = $true)][string]$ReadyToken,
  [string]$StatusFile = "",
  [switch]$NoRestart,
  [switch]$NoUserInterface
)

$ErrorActionPreference = 'Stop'
$stage = $null
$backup = $null
$replaced = $false
$started = $false
$ready = $null
$progressWindow = $null
$progressLabel = $null
function Save-UpdateStatus([string]$state, [string]$detail = "") {
  if (-not $StatusFile) { return }
  try {
    $payload = @{ state = $state; detail = $detail; time = [DateTime]::UtcNow.ToString("o") } | ConvertTo-Json -Compress
    [System.IO.File]::WriteAllText($StatusFile, $payload, [System.Text.UTF8Encoding]::new($false))
  } catch { }
}
function Set-UpdateProgress([string]$text) {
  if ($progressLabel) {
    $progressLabel.Text = $text
    $progressWindow.Refresh()
    [System.Windows.Forms.Application]::DoEvents()
  }
}
function Wait-UpdateTick([int]$milliseconds) {
  if ($progressWindow) { [System.Windows.Forms.Application]::DoEvents() }
  Start-Sleep -Milliseconds $milliseconds
}
try {
  if (-not $NoRestart -and -not $NoUserInterface) {
    try {
      Add-Type -AssemblyName System.Windows.Forms
      Add-Type -AssemblyName System.Drawing
      $progressWindow = New-Object System.Windows.Forms.Form
      $progressWindow.Text = '塘里更新'
      $progressWindow.Size = New-Object System.Drawing.Size(380, 130)
      $progressWindow.StartPosition = 'CenterScreen'
      $progressWindow.FormBorderStyle = 'FixedDialog'
      $progressWindow.ControlBox = $false
      $progressWindow.MaximizeBox = $false
      $progressWindow.MinimizeBox = $false
      $progressWindow.TopMost = $true
      $progressLabel = New-Object System.Windows.Forms.Label
      $progressLabel.Dock = 'Fill'
      $progressLabel.TextAlign = 'MiddleCenter'
      $progressLabel.Text = '正在准备更新，请稍候…'
      $progressWindow.Controls.Add($progressLabel)
      $progressWindow.Show()
      [System.Windows.Forms.Application]::DoEvents()
    } catch { $progressWindow = $null; $progressLabel = $null }
  }
  Save-UpdateStatus 'preparing'
  if ($Sha256 -notmatch '^[a-fA-F0-9]{64}$' -or $ReadyToken -notmatch '^[a-f0-9]{32}$') { throw 'Invalid update verification information.' }
  $sourcePath = [System.IO.Path]::GetFullPath($Source)
  $targetPath = [System.IO.Path]::GetFullPath($Target)
  if ($sourcePath -eq $targetPath -or [System.IO.Path]::GetExtension($targetPath) -ine '.exe') { throw 'Invalid update target.' }
  if (-not [System.IO.File]::Exists($sourcePath) -or -not [System.IO.File]::Exists($targetPath)) { throw 'Update source or original program is missing.' }
  $dir = [System.IO.Path]::GetDirectoryName($targetPath)
  $id = [Guid]::NewGuid().ToString('N')
  $stage = [System.IO.Path]::Combine($dir, '.tangli-update-' + $id + '.tmp')
  $backup = [System.IO.Path]::Combine($dir, '.tangli-previous-' + $id + '.exe')
  $ready = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), 'tangli-update-ready-' + $ReadyToken + '.ok')

  Set-UpdateProgress '正在关闭旧版本，请稍候…'
  $deadline = [DateTime]::UtcNow.AddSeconds(120)
  while (Get-Process -Id $ParentId -ErrorAction SilentlyContinue) {
    if ([DateTime]::UtcNow -ge $deadline) { throw '旧版本未能关闭，请退出塘里后重试。' }
    Wait-UpdateTick 250
  }
  Set-UpdateProgress '正在校验更新文件，请稍候…'
  Save-UpdateStatus 'verifying'
  [System.IO.File]::Copy($sourcePath, $stage, $false)
  $hasher = [System.Security.Cryptography.SHA256]::Create()
  $stream = [System.IO.File]::OpenRead($stage)
  try { $actualHash = [System.BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-', '') }
  finally { $stream.Dispose(); $hasher.Dispose() }
  if ($actualHash -ine $Sha256) { throw 'Update verification failed.' }

  # The portable launcher may hold the original file briefly after Electron exits.
  $moved = $false
  Set-UpdateProgress '正在替换程序，请稍候…'
  Save-UpdateStatus 'replacing'
  for ($i = 0; $i -lt 120; $i++) {
    try { [System.IO.File]::Move($targetPath, $backup); $moved = $true; break }
    catch { Wait-UpdateTick 500 }
  }
  if (-not $moved) { throw 'The original program is still in use.' }
  try { [System.IO.File]::Move($stage, $targetPath); $replaced = $true }
  catch { [System.IO.File]::Move($backup, $targetPath); throw }

  if ($NoRestart) {
    Remove-Item -LiteralPath $backup -Force
    exit 0
  }
  Set-UpdateProgress '更新已完成，正在启动塘里…'
  Save-UpdateStatus 'restarting'
  # This is the interactive app, so the application window must be visible.
  $process = Start-Process -FilePath $targetPath -WorkingDirectory $dir -ArgumentList ('--tangli-update-ready=' + $ReadyToken) -WindowStyle Normal -PassThru
  $started = $true
  for ($i = 0; $i -lt 180; $i++) {
    if ([System.IO.File]::Exists($ready)) { break }
    $process.Refresh()
    if ($process.HasExited) { break }
    Wait-UpdateTick 1000
  }
  if ([System.IO.File]::Exists($ready)) {
    Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $sourcePath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $ready -Force -ErrorAction SilentlyContinue
    Save-UpdateStatus 'complete'
  } else {
    # Keep the previous executable if the new application did not confirm startup.
    $process.Refresh()
    if ($process.HasExited) { $started = $false; throw '新版本启动失败，正在恢复旧版。' }
    throw ('新版本未能确认启动，旧版保留在：' + $backup)
  }
} catch {
  $message = $_.Exception.Message
  if ($NoRestart -or $NoUserInterface) { [Console]::Error.WriteLine($message) }
  if ($replaced -and -not $started -and $backup -and [System.IO.File]::Exists($backup)) {
    try {
      if ([System.IO.File]::Exists($targetPath)) { [System.IO.File]::Move($targetPath, $stage) }
      [System.IO.File]::Move($backup, $targetPath)
    } catch { $message += "`n旧版备份位置：" + $backup }
  }
  Save-UpdateStatus 'failed' $message
  if (-not $NoRestart -and -not $NoUserInterface) {
    if ($progressWindow) { $progressWindow.TopMost = $false; $progressWindow.Activate() }
    try { Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show("塘里更新未完成。`n" + $message, '塘里更新') | Out-Null } catch { }
    if (-not $started -and $targetPath -and [System.IO.File]::Exists($targetPath)) {
      try { Start-Process -FilePath $targetPath -WorkingDirectory $dir -WindowStyle Normal | Out-Null } catch { }
    }
  }
  exit 1
} finally {
  if ($progressWindow) { try { $progressWindow.Close(); $progressWindow.Dispose() } catch { } }
  if ($stage -and [System.IO.File]::Exists($stage)) { Remove-Item -LiteralPath $stage -Force -ErrorAction SilentlyContinue }
}
