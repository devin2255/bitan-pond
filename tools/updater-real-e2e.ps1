param(
  [Parameter(Mandatory = $true)][string]$Portable,
  [Parameter(Mandatory = $true)][string]$Helper,
  [string]$InstalledSetup = '',
  [switch]$LegacyHelper
)
$ErrorActionPreference = 'Stop'
$workspace = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$testRoot = [System.IO.Path]::Combine($workspace, 'dist', 'update-real-e2e-' + [Guid]::NewGuid().ToString('N'))
$allowedRoot = [System.IO.Path]::Combine($workspace, 'dist') + [System.IO.Path]::DirectorySeparatorChar
if (-not $testRoot.StartsWith($allowedRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe test directory' }
[System.IO.Directory]::CreateDirectory($testRoot) | Out-Null
$token = [Guid]::NewGuid().ToString('N')
$source = [System.IO.Path]::Combine($testRoot, 'new-update.exe')
$installDir = [System.IO.Path]::Combine($testRoot, 'installed')
$target = if ($InstalledSetup) { [System.IO.Path]::Combine($installDir, '塘里.exe') } else { [System.IO.Path]::Combine($testRoot, 'current-app.exe') }
$profile = [System.IO.Path]::Combine($testRoot, 'profile')
$programs = [System.IO.Path]::Combine($testRoot, 'programs')
$status = [System.IO.Path]::Combine($testRoot, 'status.json')
$env:TANGLI_TEST_MODE = '1'
$env:TANGLI_TEST_USER_DATA = $profile
$env:TANGLI_TEST_PROGRAMS = $programs
$processes = @()
$helperProcess = $null
$succeeded = $false
try {
  [System.IO.File]::Copy([System.IO.Path]::GetFullPath($Portable), $source, $false)
  if ($InstalledSetup) {
    $setupArgs = @('/S', ('/TANGLI_TEST_ROOT="' + $testRoot + '"'), ('/TANGLI_TEST_ID=' + $token), ('/D=' + $installDir))
    $setup = Start-Process -FilePath ([System.IO.Path]::GetFullPath($InstalledSetup)) -ArgumentList $setupArgs -WindowStyle Hidden -Wait -PassThru
    if ($setup.ExitCode -ne 0 -or -not [System.IO.File]::Exists($target)) { throw 'Isolated setup failed' }
  } else { [System.IO.File]::WriteAllText($target, 'previous version') }
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $source).Hash
  $ps = [System.IO.Path]::Combine($env:SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  $arguments = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ('"' + [System.IO.Path]::GetFullPath($Helper) + '"'),
    '-ParentId', '2147483647', '-Source', ('"' + $source + '"'), '-Target', ('"' + $target + '"'),
    '-Sha256', $hash, '-ReadyToken', $token, '-NoUserInterface')
  if (-not $LegacyHelper) { $arguments += @('-StatusFile', ('"' + $status + '"')) }
  $helperProcess = Start-Process -FilePath $ps -ArgumentList $arguments -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput ([System.IO.Path]::Combine($testRoot, 'helper.stdout.log')) `
    -RedirectStandardError ([System.IO.Path]::Combine($testRoot, 'helper.stderr.log'))
  $null = $helperProcess.Handle
  $deadline = [DateTime]::UtcNow.AddSeconds(130)
  $visible = $false
  while ([DateTime]::UtcNow -lt $deadline) {
    $relatedProcesses = @(Get-CimInstance Win32_Process | Where-Object {
      $_.CommandLine -and $_.CommandLine.Contains('--tangli-update-ready=' + $token) -and
      $_.Name -ne 'powershell.exe' -and $_.ExecutablePath -and
      ($_.ExecutablePath.StartsWith($testRoot, [StringComparison]::OrdinalIgnoreCase) -or
       $_.ExecutablePath.StartsWith([System.IO.Path]::GetTempPath(), [StringComparison]::OrdinalIgnoreCase))
    })
    foreach ($match in $relatedProcesses) {
      if ($processes -notcontains [int]$match.ProcessId) { $processes += [int]$match.ProcessId }
      $appProcess = Get-Process -Id $match.ProcessId -ErrorAction SilentlyContinue
      if ($appProcess -and $appProcess.MainWindowHandle -ne [IntPtr]::Zero -and $appProcess.MainWindowTitle -eq '塘里') {
        $visible = $true
      }
    }
    $helperProcess.Refresh()
    if ($helperProcess.HasExited) { break }
    Start-Sleep -Milliseconds 500
  }
  $helperProcess.Refresh()
  if (-not $helperProcess.HasExited) { throw 'Updater timed out' }
  $helperProcess.WaitForExit()
  if ($helperProcess.ExitCode -ne 0) { throw "Updater failed: $($helperProcess.ExitCode)" }
  if (-not $visible) { throw 'The updated application did not open a visible window' }
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $target).Hash
  if ($actual -ne $hash) { throw 'Updated executable hash mismatch' }
  $shortcut = if ($InstalledSetup) { [System.IO.Path]::Combine($programs, '塘里', '塘里.lnk') } else { [System.IO.Path]::Combine($programs, '塘里 - 便携版.lnk') }
  if (-not [System.IO.File]::Exists($shortcut)) { throw 'Missing searchable start menu shortcut' }
  $link = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcut)
  if ($link.TargetPath -ne $target) { throw 'Shortcut points to the wrong file' }
  if (-not $LegacyHelper) {
    $state = Get-Content -LiteralPath $status -Raw | ConvertFrom-Json
    if ($state.state -ne 'complete') { throw 'Update did not record completion' }
  }
  $succeeded = $true
  Write-Output ('OK real portable update: visible window, shortcut and hash; legacy=' + [bool]$LegacyHelper)
} finally {
  foreach ($id in $processes) {
    $process = Get-Process -Id $id -ErrorAction SilentlyContinue
    if ($process -and $process.MainWindowHandle -ne [IntPtr]::Zero) { [void]$process.CloseMainWindow() }
  }
  Start-Sleep -Seconds 3
  foreach ($id in $processes) {
    $process = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $id) -ErrorAction SilentlyContinue
    if ($process -and $process.CommandLine -and $process.CommandLine.Contains('--tangli-update-ready=' + $token)) {
      Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
    }
  }
  if ($helperProcess) {
    $helperProcess.Refresh()
    if (-not $helperProcess.HasExited) { Stop-Process -Id $helperProcess.Id -Force -ErrorAction SilentlyContinue }
  }
  if ($InstalledSetup) {
    $uninstaller = [System.IO.Path]::Combine($installDir, '卸载塘里.exe')
    if ([System.IO.File]::Exists($uninstaller)) {
      $uninstallArgs = @('/S', ('/TANGLI_TEST_ROOT="' + $testRoot + '"'), ('/TANGLI_TEST_ID=' + $token))
      try { Start-Process -FilePath $uninstaller -ArgumentList $uninstallArgs -WindowStyle Hidden -Wait | Out-Null } catch { }
    }
  }
  if ($succeeded -and [System.IO.Directory]::Exists($testRoot)) {
    $resolved = (Resolve-Path -LiteralPath $testRoot).Path
    if ($resolved.StartsWith($allowedRoot, [StringComparison]::OrdinalIgnoreCase) -and
        [System.IO.Path]::GetFileName($resolved).StartsWith('update-real-e2e-')) {
      Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
  if (-not $succeeded) { Write-Output ('Test diagnostics retained at ' + $testRoot) }
}
