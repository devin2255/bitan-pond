# Runs only on the disposable CI desktop. This checks whether a simple native
# window can be composited onto the real desktop without involving Chromium.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$file = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\wallpaper.ps1'))
$begin = $file.IndexOf('using System;')
$end = $file.IndexOf("`n`"@", $begin)
if ($begin -lt 0 -or $end -lt 0) { throw 'Cannot read native wallpaper code' }
Add-Type -TypeDefinition $file.Substring($begin, $end - $begin)
try { [void][DeskWp]::SetProcessDpiAwareness(2) } catch { }
. (Join-Path $PSScriptRoot 'test-desktop-visibility.ps1')
$form = New-Object System.Windows.Forms.Form
$minimized = @()
try {
  $form.StartPosition = 'Manual'; $form.FormBorderStyle = 'None'; $form.ShowInTaskbar = $false
  $form.Location = New-Object System.Drawing.Point(0, 0)
  $form.ClientSize = New-Object System.Drawing.Size(600, 500)
  $form.BackColor = [System.Drawing.Color]::FromArgb(239, 39, 63)
  $form.Show(); [System.Windows.Forms.Application]::DoEvents()
  Write-Output ([DeskWp]::Attach($form.Handle.ToInt64(), 0, 0, 600, 500, ''))
  $minimized = [TangliTestDesktop]::Minimize()
  for ($i = 0; $i -lt 20; $i++) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 100 }
  $rect = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $bitmap = New-Object System.Drawing.Bitmap($rect.Width, $rect.Height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $rect.Size)
    $bitmap.Save([IO.Path]::GetFullPath('dist/raised-solid-screen.png'), [System.Drawing.Imaging.ImageFormat]::Png)
  } finally { $graphics.Dispose(); $bitmap.Dispose() }
} finally { $form.Dispose(); [TangliTestDesktop]::Restore($minimized) }
