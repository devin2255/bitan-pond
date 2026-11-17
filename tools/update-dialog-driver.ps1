param([Parameter(Mandatory=$true)][string]$TestId)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false

# Only clicks the two update buttons belonging to an explicitly tagged test
# process. It does not use screen coordinates or change the user's pointer.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class TangliUpdateDialogDriver {
  delegate bool EnumProc(IntPtr h, IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumProc callback, IntPtr data);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out int pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder text, int size);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder text, int size);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  static HashSet<string> clicked = new HashSet<string>();
  public static string[] Scan(int[] pids) {
    var found = new List<string>();
    var allowed = new HashSet<int>(pids);
    EnumProc top = delegate(IntPtr h, IntPtr unused) {
      int pid; GetWindowThreadProcessId(h, out pid);
      if (!allowed.Contains(pid) || !IsWindowVisible(h)) return true;
      EnumProc child = delegate(IntPtr c, IntPtr unusedChild) {
        var title = new StringBuilder(512); var cls = new StringBuilder(128);
        GetWindowText(c, title, title.Capacity); GetClassName(c, cls, cls.Capacity);
        string text = title.ToString().Replace("&", "").Trim();
        if (cls.ToString() == "Button" && IsWindowVisible(c) && IsWindowEnabled(c) &&
            (text == "\u4e0b\u8f7d\u66f4\u65b0" || text == "\u7acb\u5373\u91cd\u542f\u5e76\u66f4\u65b0") && clicked.Add(c.ToInt64() + ":" + text)) {
          if (!PostMessage(c, 0x00F5, IntPtr.Zero, IntPtr.Zero)) throw new Exception("Cannot click update button");
          found.Add(text);
        }
        return true;
      };
      EnumChildWindows(h, child, IntPtr.Zero);
      return true;
    };
    EnumWindows(top, IntPtr.Zero);
    return found.ToArray();
  }
}
'@

$deadline = [DateTime]::UtcNow.AddSeconds(180)
$clicked = 0
while ([DateTime]::UtcNow -lt $deadline -and $clicked -lt 2) {
  $ids = @(Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -and $_.CommandLine.Contains('--tangli-e2e=' + $TestId) -and $_.Name -ne 'powershell.exe'
  } | ForEach-Object { [int]$_.ProcessId })
  foreach ($button in [TangliUpdateDialogDriver]::Scan($ids)) {
    $clicked++
    Write-Output ('clicked:' + $button)
  }
  Start-Sleep -Milliseconds 300
}
if ($clicked -ne 2) { Write-Error ('Expected two update buttons, clicked ' + $clicked); exit 1 }
