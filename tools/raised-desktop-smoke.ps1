# Exercise the actual native placement code against an isolated fake raised
# desktop. No Windows Explorer windows or user wallpaper are changed.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$file = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\wallpaper.ps1'))
$begin = $file.IndexOf('using System;')
$end = $file.IndexOf("`n`"@", $begin)
if ($begin -lt 0 -or $end -lt 0) { throw 'Cannot read native wallpaper code' }
$source = $file.Substring($begin, $end - $begin)
function ReplaceRequired([string]$from, [string]$to) {
  if (-not $script:source.Contains($from)) { throw 'Missing test injection point' }
  $script:source = $script:source.Replace($from, $to)
}
ReplaceRequired 'public static class DeskWp {' @'
public static class DeskWp {
  static IntPtr TestHost;
  static IntPtr TestView;
  public static void SetTestShell(long host, long view) { TestHost = new IntPtr(host); TestView = new IntPtr(view); }
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint command);
  [DllImport("user32.dll")] public static extern bool GetLayeredWindowAttributes(IntPtr h, out uint key, out byte alpha, out uint flags);
'@
ReplaceRequired 'public static IntPtr FindHost() {' 'public static IntPtr FindHost() { if (TestHost != IntPtr.Zero) return TestHost;'
ReplaceRequired 'if (parent == IntPtr.Zero || ClassOf(parent) != "Progman") return false;' 'if (parent != IntPtr.Zero && parent == TestHost) return true; if (parent == IntPtr.Zero || ClassOf(parent) != "Progman") return false;'
ReplaceRequired 'IntPtr after = IsRaisedDesktop(parent) ? FindWindowEx(parent, IntPtr.Zero, "SHELLDLL_DefView", null) : new IntPtr(1);' 'IntPtr after = IsRaisedDesktop(parent) ? (parent == TestHost ? TestView : FindWindowEx(parent, IntPtr.Zero, "SHELLDLL_DefView", null)) : new IntPtr(1);'
Add-Type -TypeDefinition $source
try { [void][DeskWp]::SetProcessDpiAwareness(2) } catch { }
$hostForm = New-Object System.Windows.Forms.Form
$first = New-Object System.Windows.Forms.Form
$second = New-Object System.Windows.Forms.Form
try {
  $hostForm.StartPosition = 'Manual'
  $hostForm.Location = New-Object System.Drawing.Point(-6000, -4000)
  $hostForm.ClientSize = New-Object System.Drawing.Size(1000, 600)
  $hostForm.ShowInTaskbar = $false
  $worker = New-Object System.Windows.Forms.Panel
  $view = New-Object System.Windows.Forms.Panel
  $worker.Dock = 'Fill'; $view.Dock = 'Fill'
  $hostForm.Controls.Add($worker); $hostForm.Controls.Add($view)
  $hostForm.Show(); $view.BringToFront()
  [DeskWp]::SetTestShell($hostForm.Handle.ToInt64(), $view.Handle.ToInt64())
  $origin = $hostForm.PointToScreen((New-Object System.Drawing.Point(0, 0)))
  foreach ($window in @($first, $second)) {
    $window.StartPosition = 'Manual'
    $window.Location = New-Object System.Drawing.Point(-7000, -5000)
    $window.ShowInTaskbar = $false
    $window.Show()
  }
  $one = [DeskWp]::Attach($first.Handle.ToInt64(), $origin.X, $origin.Y, 450, 500, '')
  $two = [DeskWp]::Attach($second.Handle.ToInt64(), ($origin.X + 450), $origin.Y, 450, 500, '')
  if (-not $one.StartsWith('OK ') -or -not $two.StartsWith('OK ')) { throw "Attach failed: $one / $two" }
  foreach ($window in @($first, $second)) {
    if ([DeskWp]::GetAncestor($window.Handle, 1) -ne $hostForm.Handle) { throw 'Wrong desktop parent' }
    if (([DeskWp]::GetWindowLongPtr($window.Handle, -20).ToInt64() -band 0x80000) -eq 0) { throw 'Missing layered style' }
    $key = [uint32]0; $alpha = [byte]0; $flags = [uint32]0
    if (-not [DeskWp]::GetLayeredWindowAttributes($window.Handle, [ref]$key, [ref]$alpha, [ref]$flags) -or $alpha -ne 255) { throw 'Layered opacity is wrong' }
  }
  $order = @(); $child = [DeskWp]::GetWindow($hostForm.Handle, 5)
  while ($child -ne [IntPtr]::Zero) { $order += $child.ToInt64(); $child = [DeskWp]::GetWindow($child, 2) }
  $vi = [array]::IndexOf($order, $view.Handle.ToInt64()); $wi = [array]::IndexOf($order, $worker.Handle.ToInt64())
  $ai = [array]::IndexOf($order, $first.Handle.ToInt64()); $bi = [array]::IndexOf($order, $second.Handle.ToInt64())
  if ($vi -lt 0 -or $wi -lt 0 -or $ai -lt 0 -or $bi -lt 0 -or $vi -ge $ai -or $vi -ge $bi -or $wi -le $ai -or $wi -le $bi) { throw ('Wrong desktop z-order: ' + ($order -join ',')) }
  $outside = [DeskWp]::Move($first.Handle.ToInt64(), ($origin.X - 5), $origin.Y, 450, 500)
  if (-not $outside.StartsWith('ERR host-coverage')) { throw 'Clipped desktop host was not detected' }
  Write-Output 'OK raised desktop: two layered windows behind icons, above wallpaper, and clipping detected'
} finally {
  $first.Dispose(); $second.Dispose(); $hostForm.Dispose()
}
