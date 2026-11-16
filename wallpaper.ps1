param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("probe", "monitors", "attach", "move", "detach", "remember", "restore")]
  [string]$Action,
  [string]$Hwnd = "0",
  [string]$Style = "0",
  [string]$Ex = "0",
  [int]$Width = 0,
  [int]$Height = 0,
  [int]$Left = 0,
  [int]$Top = 0,
  [switch]$NoRestore,
  [string]$Backup = ""
)

$ProgressPreference = "SilentlyContinue"
$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;

public static class DeskWp {
  [UnmanagedFunctionPointer(CallingConvention.StdCall)]
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  public delegate bool MonitorProc(IntPtr monitor, IntPtr hdc, ref RECT bounds, IntPtr data);

  [DllImport("shcore.dll")] public static extern int SetProcessDpiAwareness(int value);
  [DllImport("user32.dll")] public static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorProc callback, IntPtr data);
  [DllImport("user32.dll")] public static extern int MapWindowPoints(IntPtr from, IntPtr to, ref POINT point, uint count);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool RedrawWindow(IntPtr hwnd, IntPtr update, IntPtr region, uint flags);

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

  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool SetLayeredWindowAttributes(IntPtr hWnd, uint key, byte alpha, uint flags);

  [DllImport("user32.dll")]
  public static extern IntPtr GetAncestor(IntPtr hWnd, uint flags);

  public struct RECT { public int left, top, right, bottom; }
  public struct POINT { public int x, y; }

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
    // The newer raised desktop uses a different activation message; the
    // legacy WorkerW arrangement retains its original parameters.
    bool raisedStyle = (GetWindowLongPtr(progman, -20).ToInt64() & 0x00200000L) != 0;
    SendMessageTimeout(progman, 0x052C, raisedStyle ? new IntPtr(0xD) : IntPtr.Zero,
      raisedStyle ? new IntPtr(1) : IntPtr.Zero, 0, 1000, out result);
    // Modern Windows 11 hosts the icon view and the wallpaper WorkerW as
    // children of Progman. A separate layered child must sit between them.
    if (IsRaisedDesktop(progman)) {
      if (Environment.GetEnvironmentVariable("TANGLI_TEST_MODE") == "1" &&
          Environment.GetEnvironmentVariable("TANGLI_TEST_RAISED_HOST") == "worker") {
        IntPtr childWorker = FindWindowEx(progman, IntPtr.Zero, "WorkerW", null);
        if (childWorker != IntPtr.Zero) return childWorker;
      }
      return progman;
    }
    worker = IntPtr.Zero;
    host = IntPtr.Zero;
    keep = OnEnum;
    EnumWindows(keep, IntPtr.Zero);
    if (worker != IntPtr.Zero) return worker;
    if (host != IntPtr.Zero) return host;
    return progman;
  }

  static bool IsRaisedDesktop(IntPtr parent) {
    if (parent == IntPtr.Zero || ClassOf(parent) != "Progman") return false;
    long ex = GetWindowLongPtr(parent, -20).ToInt64();
    return (ex & 0x00200000L) != 0 && FindWindowEx(parent, IntPtr.Zero, "SHELLDLL_DefView", null) != IntPtr.Zero;
  }

  static bool IsRaisedWorker(IntPtr parent) {
    return parent != IntPtr.Zero && ClassOf(parent) == "WorkerW" && IsRaisedDesktop(GetAncestor(parent, 1));
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
    return "OK parent=" + parent.ToInt64() + " class=" + ClassOf(parent) + " w=" + w + " h=" + h + " raised=" + (IsRaisedDesktop(parent) ? "1" : "0");
  }

  public static string Monitors() {
    var list = new List<string>();
    MonitorProc callback = delegate(IntPtr monitor, IntPtr hdc, ref RECT rect, IntPtr data) {
      list.Add(rect.left + "," + rect.top + "," + (rect.right - rect.left) + "," + (rect.bottom - rect.top));
      return true;
    };
    if (!EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, callback, IntPtr.Zero) || list.Count == 0) return "ERR no-monitors";
    return "OK displays=" + String.Join(";", list.ToArray());
  }

  static string Place(IntPtr hwnd, IntPtr parent, int left, int top, int width, int height) {
    if (width <= 0 || height <= 0) return "ERR invalid-size";
    RECT client;
    if (!GetClientRect(parent, out client)) return "ERR host-bounds";
    POINT origin = new POINT { x = client.left, y = client.top };
    MapWindowPoints(parent, IntPtr.Zero, ref origin, 1);
    long hostRight = (long)origin.x + client.right - client.left;
    long hostBottom = (long)origin.y + client.bottom - client.top;
    // A child outside its parent's client area is clipped even when
    // GetWindowRect reports the requested monitor bounds.
    if (left < origin.x - 2 || top < origin.y - 2 || (long)left + width > hostRight + 2 || (long)top + height > hostBottom + 2)
      return "ERR host-coverage x=" + origin.x + " y=" + origin.y + " w=" + (client.right - client.left) + " h=" + (client.bottom - client.top);
    POINT pos = new POINT { x = left, y = top };
    MapWindowPoints(IntPtr.Zero, parent, ref pos, 1);
    SetWindowRgn(hwnd, IntPtr.Zero, true);
    // Insert each wallpaper immediately below the icons, keeping all monitor
    // windows above the system's static wallpaper WorkerW.
    IntPtr after = IsRaisedDesktop(parent) ? FindWindowEx(parent, IntPtr.Zero, "SHELLDLL_DefView", null) : new IntPtr(1);
    if (!SetWindowPos(hwnd, after, pos.x, pos.y, width, height, 0x0010 | 0x0020 | 0x0040)) return "ERR position";
    if (IsRaisedDesktop(parent)) {
      IntPtr background = FindWindowEx(parent, IntPtr.Zero, "WorkerW", null);
      if (background != IntPtr.Zero) SetWindowPos(background, new IntPtr(1), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010);
    }
    ShowWindow(hwnd, 8);
    RECT actual;
    if (!GetWindowRect(hwnd, out actual)) return "ERR bounds";
    return " x=" + actual.left + " y=" + actual.top + " w=" + (actual.right - actual.left) + " h=" + (actual.bottom - actual.top);
  }

  public static string Move(long hwndValue, int left, int top, int width, int height) {
    IntPtr hwnd = new IntPtr(hwndValue);
    IntPtr parent = GetAncestor(hwnd, 1);
    if (parent == IntPtr.Zero) return "ERR no-parent";
    string result = Place(hwnd, parent, left, top, width, height);
    return result.StartsWith("ERR") ? result : "OK" + result;
  }

  public static string Attach(long hwndValue, int left, int top, int width, int height, string backupFile) {
    Remember(backupFile);
    IntPtr hwnd = new IntPtr(hwndValue);
    IntPtr parent = FindHost();
    if (parent == IntPtr.Zero) return "ERR no-host";
    long style = GetWindowLongPtr(hwnd, -16).ToInt64();
    long ex = GetWindowLongPtr(hwnd, -20).ToInt64();
    long remove = 0x00C00000L | 0x00040000L | 0x00020000L | 0x00010000L | 0x00080000L | 0x00800000L | 0x00400000L;
    long next = (style & ~remove & ~0x80000000L) | 0x40000000L; // WS_CHILD, not WS_POPUP
    SetWindowLongPtr(hwnd, -16, new IntPtr(next));
    long ex2 = (ex | 0x80L | 0x08000000L) & ~0x00040000L;
    bool raised = IsRaisedDesktop(parent) || IsRaisedWorker(parent);
    if (raised) ex2 |= 0x00080000L; // WS_EX_LAYERED on the raised desktop
    SetWindowLongPtr(hwnd, -20, new IntPtr(ex2));
    if (raised && !SetLayeredWindowAttributes(hwnd, 0, 255, 0x2)) {
      SetWindowLongPtr(hwnd, -16, new IntPtr(style));
      SetWindowLongPtr(hwnd, -20, new IntPtr(ex));
      return "ERR layered";
    }
    SetParent(hwnd, parent);
    IntPtr now = GetAncestor(hwnd, 1);
    if (now != parent) {
      SetWindowLongPtr(hwnd, -16, new IntPtr(style));
      SetWindowLongPtr(hwnd, -20, new IntPtr(ex));
      return "ERR parent style=" + style + " ex=" + ex + " now=" + now.ToInt64();
    }
    string result = Place(hwnd, parent, left, top, width, height);
    if (result.StartsWith("ERR")) {
      SetParent(hwnd, IntPtr.Zero);
      SetWindowLongPtr(hwnd, -16, new IntPtr(style));
      SetWindowLongPtr(hwnd, -20, new IntPtr(ex));
      return result;
    }
    return "OK style=" + style + " ex=" + ex + result + " parent=" + parent.ToInt64();
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

  public static string Detach(long hwndValue, long style, long ex, string backupFile, bool noRestore) {
    IntPtr hwnd = new IntPtr(hwndValue);
    IntPtr oldParent = GetAncestor(hwnd, 1);
    SetWindowRgn(hwnd, IntPtr.Zero, true);
    SetParent(hwnd, IntPtr.Zero);
    SetWindowLongPtr(hwnd, -16, new IntPtr(style));
    SetWindowLongPtr(hwnd, -20, new IntPtr(ex));
    SetWindowPos(hwnd, IntPtr.Zero, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0004 | 0x0020 | 0x0040);
    ShowWindow(hwnd, 5);
    if (noRestore) {
      if (oldParent != IntPtr.Zero) RedrawWindow(oldParent, IntPtr.Zero, IntPtr.Zero, 0x0001 | 0x0080 | 0x0400);
      return "OK detached=1";
    }
    string restored = Restore(backupFile);
    return restored.StartsWith("OK") ? "OK restored=1" : restored;
  }
}
"@

try { [void][DeskWp]::SetProcessDpiAwareness(2) } catch { }

switch ($Action) {
  "probe" { Write-Output ([DeskWp]::Probe()) }
  "monitors" { Write-Output ([DeskWp]::Monitors()) }
  "remember" { [DeskWp]::Remember($Backup); Write-Output "OK" }
  "restore" { Write-Output ([DeskWp]::Restore($Backup)) }
  "attach" { Write-Output ([DeskWp]::Attach([int64]$Hwnd, $Left, $Top, $Width, $Height, $Backup)) }
  "move" { Write-Output ([DeskWp]::Move([int64]$Hwnd, $Left, $Top, $Width, $Height)) }
  "detach" { Write-Output ([DeskWp]::Detach([int64]$Hwnd, [int64]$Style, [int64]$Ex, $Backup, [bool]$NoRestore)) }
}
