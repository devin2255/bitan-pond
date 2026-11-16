param([Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class TangliScreenCapture {
  [DllImport("shcore.dll")] public static extern int SetProcessDpiAwareness(int value);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int command);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder name, int length);
}
'@
try { [void][TangliScreenCapture]::SetProcessDpiAwareness(2) } catch { }
$foreground = [TangliScreenCapture]::GetForegroundWindow()
$name = New-Object System.Text.StringBuilder 128
[void][TangliScreenCapture]::GetClassName($foreground, $name, $name.Capacity)
$minimize = $foreground -ne [IntPtr]::Zero -and $name.ToString() -notin @('Progman', 'WorkerW') -and -not [TangliScreenCapture]::IsIconic($foreground)
if ($minimize) { [void][TangliScreenCapture]::ShowWindow($foreground, 6) }
Start-Sleep -Milliseconds 800
$rect = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bitmap = New-Object System.Drawing.Bitmap($rect.Width, $rect.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
  $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $rect.Size)
  $bitmap.Save([IO.Path]::GetFullPath($Output), [System.Drawing.Imaging.ImageFormat]::Png)
} finally { $graphics.Dispose(); $bitmap.Dispose(); if ($minimize) { [void][TangliScreenCapture]::ShowWindow($foreground, 9) } }
