param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("probe", "attach", "detach", "remember", "restore")]
  [string]$Action,
  [string]$Hwnd = "0",
  [string]$Style = "0",
  [string]$Ex = "0",
  [int]$Width = 0,
  [int]$Height = 0,
  [string]$Backup = ""
)

$ProgressPreference = "SilentlyContinue"
$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class DeskWp {
  [UnmanagedFunctionPointer(CallingConvention.StdCall)]
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "FindWindowW")]
  public static extern IntPtr FindWindow(string cls, string name);

  [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "FindWindowExW")]
  public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string name);

  [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "SendMessageTimeoutW")]
  public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);

  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern IntPtr SetParent(IntPtr child, IntPtr parent);

  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
  public static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int index);

  [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")]
  public static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int index, IntPtr value);

  [DllImport("user32.dll")]
  public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);

  [DllImport("user32.dll")]
  public static extern bool GetClientRect(IntPtr hWnd, out RECT rect);

  [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "GetClassNameW")]
  public static extern int GetClassName(IntPtr hWnd, StringBuilder sb, int max);

  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int cmd);

  [DllImport("user32.dll")]
  public static extern IntPtr GetAncestor(IntPtr hWnd, uint flags);

  public struct RECT { public int left, top, right, bottom; }

  [ComImport, Guid("C2CF3110-460E-4fc1-B9D0-8A1C0C9CC4BD")]
  class DesktopWallpaper { }

  [ComImport, Guid("B92B56A9-8B55-4E14-9A89-0199BBB6F93B"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IDesktopWallpaper {
    void SetWallpaper([MarshalAs(UnmanagedType.LPWStr)] string monitorID, [MarshalAs(UnmanagedType.LPWStr)] string wallpaper);
  }

  static IntPtr worker;
  static IntPtr host;
  static EnumProc keep;

  static bool OnEnum(IntPtr hWnd, IntPtr lParam) {
    IntPtr def = FindWindowEx(hWnd, IntPtr.Zero, "SHELLDLL_DefView", null);
    if (def != IntPtr.Zero) {
      host = hWnd;
      worker = FindWindowEx(IntPtr.Zero, hWnd, "WorkerW", null);
    }
    return true;
  }

  public static IntPtr FindHost() {
    IntPtr progman = FindWindow("Progman", null);
    if (progman == IntPtr.Zero) return IntPtr.Zero;
    IntPtr result;
    SendMessageTimeout(progman, 0x052C, IntPtr.Zero, IntPtr.Zero, 0, 1000, out result);
    worker = IntPtr.Zero;
    host = IntPtr.Zero;
    keep = OnEnum;
    EnumWindows(keep, IntPtr.Zero);
    if (worker != IntPtr.Zero) return worker;
    if (host != IntPtr.Zero) return host;
    return progman;
  }

  static string ClassOf(IntPtr h) {
    StringBuilder sb = new StringBuilder(128);
    GetClassName(h, sb, sb.Capacity);
    return sb.ToString();
  }

  public static string Probe() {
    IntPtr parent = FindHost();
    if (parent == IntPtr.Zero) return "ERR no-host";
    RECT r;
    GetClientRect(parent, out r);
    int w = r.right - r.left;
    int h = r.bottom - r.top;
    return "OK parent=" + parent.ToInt64() + " class=" + ClassOf(parent) + " w=" + w + " h=" + h;
  }

  public static string Attach(long hwndValue, int fallbackW, int fallbackH, string backupFile) {
    Remember(backupFile);
    IntPtr hwnd = new IntPtr(hwndValue);
    IntPtr parent = FindHost();
    if (parent == IntPtr.Zero) return "ERR no-host";
    long style = GetWindowLongPtr(hwnd, -16).ToInt64();
    long ex = GetWindowLongPtr(hwnd, -20).ToInt64();
    long remove = 0x00C00000L | 0x00040000L | 0x00020000L | 0x00010000L | 0x00080000L | 0x00800000L | 0x00400000L;
    long next = style & ~remove;
    SetWindowLongPtr(hwnd, -16, new IntPtr(next));
    long ex2 = (ex | 0x80L | 0x08000000L) & ~0x00040000L;
    SetWindowLongPtr(hwnd, -20, new IntPtr(ex2));
    SetParent(hwnd, parent);
    IntPtr now = GetAncestor(hwnd, 1);
    if (now != parent) return "ERR parent style=" + style + " ex=" + ex + " now=" + now.ToInt64();
    RECT r;
    GetClientRect(parent, out r);
    int w = r.right - r.left;
    int h = r.bottom - r.top;
    if (w < 200 || h < 200) {
      w = fallbackW;
      h = fallbackH;
    }
    if (w < 200) w = 1920;
    if (h < 200) h = 1080;
    SetWindowRgn(hwnd, IntPtr.Zero, true);
    SetWindowPos(hwnd, new IntPtr(1), 0, 0, w, h, 0x0010 | 0x0020 | 0x0040);
    ShowWindow(hwnd, 8);
    return "OK style=" + style + " ex=" + ex + " w=" + w + " h=" + h + " parent=" + parent.ToInt64();
  }

  [DllImport("user32.dll")]
  public static extern int SetWindowRgn(IntPtr hWnd, IntPtr hRgn, bool redraw);

  [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "SystemParametersInfoW", SetLastError = true)]
  public static extern bool SpiGet(uint action, uint param, StringBuilder pv, uint winIni);

  [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "SystemParametersInfoW", SetLastError = true)]
  public static extern bool SpiSet(uint action, uint param, string pv, uint winIni);

  public static string CurrentWallpaper() {
    StringBuilder sb = new StringBuilder(4096);
    SpiGet(0x0073, (uint)sb.Capacity, sb, 0);
    string path = sb.ToString().Trim();
    if (path.Length == 0) {
      object reg = Microsoft.Win32.Registry.GetValue(@"HKEY_CURRENT_USER\Control Panel\Desktop", "Wallpaper", "");
      path = (reg as string ?? "").Trim();
    }
    return path;
  }

  public static void Remember(string backupFile) {
    if (string.IsNullOrEmpty(backupFile) || System.IO.File.Exists(backupFile)) return;
    string path = CurrentWallpaper();
    object color = Microsoft.Win32.Registry.GetValue(@"HKEY_CURRENT_USER\Control Panel\Colors", "Background", "0 0 0");
    string dir = System.IO.Path.GetDirectoryName(backupFile);
    if (!string.IsNullOrEmpty(dir)) System.IO.Directory.CreateDirectory(dir);
    System.IO.File.WriteAllText(backupFile, path + "\n" + (color as string ?? ""), System.Text.Encoding.UTF8);
  }

  public static string Restore(string backupFile) {
    string path = "";
    if (!string.IsNullOrEmpty(backupFile) && System.IO.File.Exists(backupFile)) {
      string[] lines = System.IO.File.ReadAllLines(backupFile, System.Text.Encoding.UTF8);
      if (lines.Length > 0) path = lines[0].Trim();
    }
    if (path.Length == 0 || !System.IO.File.Exists(path)) {
      string current = CurrentWallpaper();
      if (current.Length > 0 && System.IO.File.Exists(current)) path = current;
    }
    if (path.Length == 0 || !System.IO.File.Exists(path)) return "ERR no-wallpaper";
    bool ok = SpiSet(0x0014, 0, path, 0x01 | 0x02);
    try {
      IDesktopWallpaper wall = (IDesktopWallpaper)new DesktopWallpaper();
      wall.SetWallpaper(null, path);
    } catch { }
    return ok ? "OK restored=1" : "ERR set";
  }

  public static string Detach(long hwndValue, long style, long ex, string backupFile) {
    IntPtr hwnd = new IntPtr(hwndValue);
    SetWindowRgn(hwnd, IntPtr.Zero, true);
    SetParent(hwnd, IntPtr.Zero);
    SetWindowLongPtr(hwnd, -16, new IntPtr(style));
    SetWindowLongPtr(hwnd, -20, new IntPtr(ex));
    SetWindowPos(hwnd, IntPtr.Zero, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0004 | 0x0020 | 0x0040);
    ShowWindow(hwnd, 5);
    string restored = Restore(backupFile);
    return restored.StartsWith("OK") ? "OK restored=1" : restored;
  }
}
"@

switch ($Action) {
  "probe" { Write-Output ([DeskWp]::Probe()) }
  "remember" { [DeskWp]::Remember($Backup); Write-Output "OK" }
  "restore" { Write-Output ([DeskWp]::Restore($Backup)) }
  "attach" { Write-Output ([DeskWp]::Attach([int64]$Hwnd, $Width, $Height, $Backup)) }
  "detach" { Write-Output ([DeskWp]::Detach([int64]$Hwnd, [int64]$Style, [int64]$Ex, $Backup)) }
}
