param([Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public static class TangliScreenCapture {
  [DllImport("shcore.dll")] public static extern int SetProcessDpiAwareness(int value);
}
'@
try { [void][TangliScreenCapture]::SetProcessDpiAwareness(2) } catch { }
$shell = New-Object -ComObject Shell.Application
$shell.ToggleDesktop()
Start-Sleep -Milliseconds 800
$rect = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bitmap = New-Object System.Drawing.Bitmap($rect.Width, $rect.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
  $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $rect.Size)
  $bitmap.Save([IO.Path]::GetFullPath($Output), [System.Drawing.Imaging.ImageFormat]::Png)
} finally { $graphics.Dispose(); $bitmap.Dispose(); $shell.ToggleDesktop() }
