param(
  [Parameter(Mandatory = $true)][int]$ParentId,
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$Target,
  [Parameter(Mandatory = $true)][string]$Sha256,
  [Parameter(Mandatory = $true)][string]$ReadyToken,
  [switch]$NoRestart,
  [switch]$NoUserInterface
)

$ErrorActionPreference = 'Stop'
$stage = $null
$backup = $null
$replaced = $false
$started = $false
$ready = $null
try {
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

  if (Get-Process -Id $ParentId -ErrorAction SilentlyContinue) { Wait-Process -Id $ParentId -Timeout 120 -ErrorAction Stop }
  [System.IO.File]::Copy($sourcePath, $stage, $false)
  $hasher = [System.Security.Cryptography.SHA256]::Create()
  $stream = [System.IO.File]::OpenRead($stage)
  try { $actualHash = [System.BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-', '') }
  finally { $stream.Dispose(); $hasher.Dispose() }
  if ($actualHash -ine $Sha256) { throw 'Update verification failed.' }

  # The portable launcher may hold the original file briefly after Electron exits.
  $moved = $false
  for ($i = 0; $i -lt 120; $i++) {
    try { [System.IO.File]::Move($targetPath, $backup); $moved = $true; break }
    catch { Start-Sleep -Milliseconds 500 }
  }
  if (-not $moved) { throw 'The original program is still in use.' }
  try { [System.IO.File]::Move($stage, $targetPath); $replaced = $true }
  catch { [System.IO.File]::Move($backup, $targetPath); throw }

  if ($NoRestart) {
    Remove-Item -LiteralPath $backup -Force
    exit 0
  }
  $process = Start-Process -FilePath $targetPath -WorkingDirectory $dir -ArgumentList ('--tangli-update-ready=' + $ReadyToken) -WindowStyle Hidden -PassThru
  $started = $true
  for ($i = 0; $i -lt 180; $i++) {
    if ([System.IO.File]::Exists($ready)) { break }
    $process.Refresh()
    if ($process.HasExited) { break }
    Start-Sleep -Seconds 1
  }
  if ([System.IO.File]::Exists($ready)) {
    Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $sourcePath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $ready -Force -ErrorAction SilentlyContinue
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
  if (-not $NoRestart -and -not $NoUserInterface) {
    try { Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show("塘里更新未完成。`n" + $message, '塘里更新') | Out-Null } catch { }
    if (-not $started -and $targetPath -and [System.IO.File]::Exists($targetPath)) {
      try { Start-Process -FilePath $targetPath -WorkingDirectory $dir -WindowStyle Hidden | Out-Null } catch { }
    }
  }
  exit 1
} finally {
  if ($stage -and [System.IO.File]::Exists($stage)) { Remove-Item -LiteralPath $stage -Force -ErrorAction SilentlyContinue }
}
