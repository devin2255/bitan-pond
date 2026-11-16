param([Parameter(Mandatory=$true)][int]$X, [Parameter(Mandatory=$true)][int]$Y)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class TangliTestMouse {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int x, y; }
  [DllImport("shcore.dll")] public static extern int SetProcessDpiAwareness(int value);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int command);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder name, int length);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
}
'@
try { [void][TangliTestMouse]::SetProcessDpiAwareness(2) } catch { }
$old = New-Object TangliTestMouse+POINT
[void][TangliTestMouse]::GetCursorPos([ref]$old)
$foreground = [TangliTestMouse]::GetForegroundWindow()
$name = New-Object System.Text.StringBuilder 128
[void][TangliTestMouse]::GetClassName($foreground, $name, $name.Capacity)
$minimize = $foreground -ne [IntPtr]::Zero -and $name.ToString() -notin @('Progman', 'WorkerW') -and -not [TangliTestMouse]::IsIconic($foreground)
if ($minimize) { [void][TangliTestMouse]::ShowWindow($foreground, 6) }
try {
  Start-Sleep -Milliseconds 500
  if (-not [TangliTestMouse]::SetCursorPos($X, $Y)) { throw 'Cannot position test pointer' }
  Start-Sleep -Milliseconds 120
  [TangliTestMouse]::mouse_event(0x2, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 80
  [TangliTestMouse]::mouse_event(0x4, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 300
} finally { [void][TangliTestMouse]::SetCursorPos($old.x, $old.y); if ($minimize) { [void][TangliTestMouse]::ShowWindow($foreground, 9) } }
