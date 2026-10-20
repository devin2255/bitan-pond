using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

internal static class DeskInput {
  const int WH_MOUSE_LL = 14;
  const int GA_ROOT = 2;
  const uint WM_MOUSEMOVE = 0x0200;
  const uint WM_LBUTTONDOWN = 0x0201;
  const uint WM_LBUTTONUP = 0x0202;
  const uint WM_RBUTTONDOWN = 0x0204;
  const uint WM_RBUTTONUP = 0x0205;
  const uint WM_MOUSEWHEEL = 0x020A;
  const uint LVM_GETITEMCOUNT = 0x1004;
  const uint LVM_GETITEMRECT = 0x100E;

  [StructLayout(LayoutKind.Sequential)]
  struct POINT { public int x; public int y; }

  [StructLayout(LayoutKind.Sequential)]
  struct RECT { public int left, top, right, bottom; }

  [StructLayout(LayoutKind.Sequential)]
  struct MSLLHOOKSTRUCT {
    public POINT pt;
    public uint mouseData;
    public uint flags;
    public uint time;
    public IntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct MSG {
    public IntPtr hwnd;
    public uint message;
    public IntPtr wParam;
    public IntPtr lParam;
    public uint time;
    public POINT pt;
  }

  delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);
  delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);

  [DllImport("shcore.dll")] static extern int SetProcessDpiAwareness(int value);
  [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, HookProc proc, IntPtr mod, uint tid);
  [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook, int nCode, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] static extern int GetMessage(out MSG msg, IntPtr hwnd, uint min, uint max);
  [DllImport("user32.dll")] static extern bool TranslateMessage(ref MSG msg);
  [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref MSG msg);
  [DllImport("user32.dll")] static extern IntPtr SetTimer(IntPtr hwnd, IntPtr id, uint ms, IntPtr fn);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT pt);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder sb, int max);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string name);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr hwnd, ref POINT pt);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out int pid);
  [DllImport("user32.dll")] static extern int SetWindowRgn(IntPtr hwnd, IntPtr rgn, bool redraw);
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr VirtualAllocEx(IntPtr proc, IntPtr addr, uint size, uint type, uint protect);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool WriteProcessMemory(IntPtr proc, IntPtr addr, byte[] buf, uint size, out UIntPtr written);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool ReadProcessMemory(IntPtr proc, IntPtr addr, byte[] buf, uint size, out UIntPtr read);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);

  static IntPtr hook;
  static HookProc keep;
  static IntPtr target;
  static IntPtr listView;
  static IntPtr proc;
  static IntPtr remote;
  static RECT[] icons = new RECT[0];
  static IntPtr defHost;
  static int lastMoveTick;
  static bool overPond;
  static int desktopGesture;
  static readonly ConcurrentQueue<string> queue = new ConcurrentQueue<string>();

  [STAThread]
  static int Main(string[] args) {
    try { SetProcessDpiAwareness(2); } catch { }
    if (args.Length < 2) return 2;
    target = new IntPtr(long.Parse(args[0]));
    int parentPid = int.Parse(args[1]);
    try {
      var parent = Process.GetProcessById(parentPid);
      var watcher = new Thread(() => {
        try { parent.WaitForExit(); } catch { }
        Environment.Exit(0);
      });
      watcher.IsBackground = true;
      watcher.Start();
    } catch { }
    var writer = new Thread(Writer);
    writer.IsBackground = true;
    writer.Start();
    SetWindowRgn(target, IntPtr.Zero, true);
    RefreshIcons();
    RECT wr;
    GetWindowRect(target, out wr);
    Emit("ready " + wr.left + " " + wr.top);
    keep = OnMouse;
    hook = SetWindowsHookEx(WH_MOUSE_LL, keep, IntPtr.Zero, 0);
    if (hook == IntPtr.Zero) return 3;
    SetTimer(IntPtr.Zero, new IntPtr(1), 700, IntPtr.Zero);
    MSG msg;
    while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) {
      if (msg.message == 0x0113) {
        RefreshIcons();
        GetWindowRect(target, out wr);
        Emit("origin " + wr.left + " " + wr.top);
        continue;
      }
      TranslateMessage(ref msg);
      DispatchMessage(ref msg);
    }
    if (hook != IntPtr.Zero) UnhookWindowsHookEx(hook);
    if (proc != IntPtr.Zero) CloseHandle(proc);
    return 0;
  }

  static void Writer() {
    while (true) {
      string line;
      bool any = false;
      while (queue.TryDequeue(out line)) {
        Console.WriteLine(line);
        any = true;
      }
      if (any) Console.Out.Flush();
      Thread.Sleep(8);
    }
  }

  static void Emit(string line) { queue.Enqueue(line); }

  static string ClassOf(IntPtr hwnd) {
    if (hwnd == IntPtr.Zero) return "";
    var sb = new StringBuilder(128);
    GetClassName(hwnd, sb, sb.Capacity);
    return sb.ToString();
  }

  static bool OnDesktop(IntPtr hwnd) {
    string cls = ClassOf(hwnd);
    string root = ClassOf(GetAncestor(hwnd, GA_ROOT));
    if (cls == "SysListView32" || cls == "SHELLDLL_DefView") return root == "Progman" || root == "WorkerW" || root == "";
    return cls == "Progman" || cls == "WorkerW";
  }

  static bool OnEnum(IntPtr hwnd, IntPtr lParam) {
    IntPtr def = FindWindowEx(hwnd, IntPtr.Zero, "SHELLDLL_DefView", null);
    if (def != IntPtr.Zero) defHost = hwnd;
    return true;
  }

  static IntPtr FindListView() {
    IntPtr progman = FindWindowEx(IntPtr.Zero, IntPtr.Zero, "Progman", null);
    defHost = IntPtr.Zero;
    EnumWindows(OnEnum, IntPtr.Zero);
    IntPtr parent = defHost != IntPtr.Zero ? defHost : progman;
    if (parent == IntPtr.Zero) return IntPtr.Zero;
    IntPtr def = FindWindowEx(parent, IntPtr.Zero, "SHELLDLL_DefView", null);
    if (def == IntPtr.Zero) return IntPtr.Zero;
    IntPtr lv = FindWindowEx(def, IntPtr.Zero, "SysListView32", "FolderView");
    if (lv == IntPtr.Zero) lv = FindWindowEx(def, IntPtr.Zero, "SysListView32", null);
    return lv;
  }

  static void EnsureRemote(IntPtr lv) {
    if (lv == IntPtr.Zero) return;
    if (lv != listView) {
      if (proc != IntPtr.Zero) CloseHandle(proc);
      proc = IntPtr.Zero;
      remote = IntPtr.Zero;
      listView = lv;
    }
    if (proc != IntPtr.Zero && remote != IntPtr.Zero) return;
    int pid;
    GetWindowThreadProcessId(lv, out pid);
    proc = OpenProcess(0x0008 | 0x0010 | 0x0020 | 0x0400, false, pid);
    if (proc == IntPtr.Zero) return;
    remote = VirtualAllocEx(proc, IntPtr.Zero, 32, 0x1000 | 0x2000, 0x04);
  }

  static bool ReadItemRect(int index, out RECT rect) {
    rect = new RECT();
    byte[] buf = new byte[16];
    UIntPtr wrote;
    if (!WriteProcessMemory(proc, remote, buf, 16, out wrote)) return false;
    SendMessage(listView, LVM_GETITEMRECT, new IntPtr(index), remote);
    UIntPtr read;
    if (!ReadProcessMemory(proc, remote, buf, 16, out read)) return false;
    rect.left = BitConverter.ToInt32(buf, 0);
    rect.top = BitConverter.ToInt32(buf, 4);
    rect.right = BitConverter.ToInt32(buf, 8);
    rect.bottom = BitConverter.ToInt32(buf, 12);
    if (rect.right <= rect.left || rect.bottom <= rect.top) return false;
    POINT a = new POINT { x = rect.left, y = rect.top };
    POINT b = new POINT { x = rect.right, y = rect.bottom };
    ClientToScreen(listView, ref a);
    ClientToScreen(listView, ref b);
    rect.left = a.x - 6;
    rect.top = a.y - 6;
    rect.right = b.x + 6;
    rect.bottom = b.y + 6;
    return true;
  }

  static void RefreshIcons() {
    try {
      IntPtr lv = FindListView();
      if (lv == IntPtr.Zero) return;
      EnsureRemote(lv);
      if (proc == IntPtr.Zero || remote == IntPtr.Zero) return;
      int count = (int)SendMessage(lv, LVM_GETITEMCOUNT, IntPtr.Zero, IntPtr.Zero);
      if (count < 0 || count > 400) count = 0;
      var next = new RECT[count];
      int n = 0;
      for (int i = 0; i < count; i++) {
        RECT r;
        if (ReadItemRect(i, out r)) next[n++] = r;
      }
      if (n != count) {
        var trimmed = new RECT[n];
        Array.Copy(next, trimmed, n);
        next = trimmed;
      }
      icons = next;
    } catch { }
  }

  static bool HitIcon(int x, int y) {
    RECT[] list = icons;
    for (int i = 0; i < list.Length; i++) {
      if (x >= list[i].left && x < list[i].right && y >= list[i].top && y < list[i].bottom) return true;
    }
    return false;
  }

  static void NoteDown(uint msg) {
    if (msg == WM_LBUTTONDOWN) desktopGesture |= 1;
    if (msg == WM_RBUTTONDOWN) desktopGesture |= 2;
  }

  static void NoteUp(uint msg) {
    if (msg == WM_LBUTTONUP) desktopGesture &= ~1;
    if (msg == WM_RBUTTONUP) desktopGesture &= ~2;
  }

  static IntPtr OnMouse(int nCode, IntPtr wParam, IntPtr lParam) {
    if (nCode < 0 || target == IntPtr.Zero) return CallNextHookEx(hook, nCode, wParam, lParam);
    var info = (MSLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(MSLLHOOKSTRUCT));
    uint msg = unchecked((uint)wParam.ToInt64());
    if (desktopGesture != 0) {
      NoteUp(msg);
      return CallNextHookEx(hook, nCode, wParam, lParam);
    }
    IntPtr under = WindowFromPoint(info.pt);
    bool icon = HitIcon(info.pt.x, info.pt.y);
    if (!OnDesktop(under) || icon) {
      if (icon && (msg == WM_LBUTTONDOWN || msg == WM_RBUTTONDOWN)) NoteDown(msg);
      if (overPond) { overPond = false; Emit("leave"); }
      return CallNextHookEx(hook, nCode, wParam, lParam);
    }
    overPond = true;
    if (msg == WM_MOUSEMOVE) {
      int now = Environment.TickCount;
      if (unchecked(now - lastMoveTick) >= 16) {
        lastMoveTick = now;
        Emit("move " + info.pt.x + " " + info.pt.y);
      }
    } else if (msg == WM_LBUTTONDOWN) Emit("down " + info.pt.x + " " + info.pt.y + " 0");
    else if (msg == WM_LBUTTONUP) Emit("up " + info.pt.x + " " + info.pt.y + " 0");
    else if (msg == WM_RBUTTONDOWN) Emit("down " + info.pt.x + " " + info.pt.y + " 2");
    else if (msg == WM_RBUTTONUP) Emit("up " + info.pt.x + " " + info.pt.y + " 2");
    else if (msg == WM_MOUSEWHEEL) {
      int delta = (short)((info.mouseData >> 16) & 0xffff);
      Emit("wheel " + info.pt.x + " " + info.pt.y + " " + delta);
    }
    bool button = msg == WM_LBUTTONDOWN || msg == WM_LBUTTONUP || msg == WM_RBUTTONDOWN || msg == WM_RBUTTONUP || msg == WM_MOUSEWHEEL;
    if (button) return (IntPtr)1;
    return CallNextHookEx(hook, nCode, wParam, lParam);
  }
}
