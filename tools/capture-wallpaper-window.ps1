param([Parameter(Mandatory=$true)][long]$Hwnd, [Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class TangliWindowCapture {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int left, top, right, bottom; }
  [DllImport("shcore.dll")] public static extern int SetProcessDpiAwareness(int value);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
}
'@
try { [void][TangliWindowCapture]::SetProcessDpiAwareness(2) } catch { }
$rect = New-Object TangliWindowCapture+RECT
if (-not [TangliWindowCapture]::GetWindowRect([IntPtr]$Hwnd, [ref]$rect)) { throw 'Could not measure window' }
$width = $rect.right - $rect.left; $height = $rect.bottom - $rect.top
if ($width -le 0 -or $height -le 0 -or $width -gt 8192 -or $height -gt 8192) { throw 'Invalid window size' }
$bitmap = New-Object System.Drawing.Bitmap($width, $height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
  $dc = $graphics.GetHdc()
  try { $ok = [TangliWindowCapture]::PrintWindow([IntPtr]$Hwnd, $dc, 2) } finally { $graphics.ReleaseHdc($dc) }
  if (-not $ok) { throw 'Could not capture native window' }
  $bitmap.Save([IO.Path]::GetFullPath($Output), [System.Drawing.Imaging.ImageFormat]::Png)
} finally { $graphics.Dispose(); $bitmap.Dispose() }
