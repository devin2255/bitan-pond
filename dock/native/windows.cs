using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

internal static class Program
{
    internal static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 8 * 1024 * 1024 };

    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            var utf8 = new UTF8Encoding(false);
            Console.SetIn(new StreamReader(Console.OpenStandardInput(), utf8));
            Console.SetOut(new StreamWriter(Console.OpenStandardOutput(), utf8) { AutoFlush = true });
            Console.SetError(new StreamWriter(Console.OpenStandardError(), utf8) { AutoFlush = true });
            try { DesktopApi.SetProcessDpiAwarenessContext(new IntPtr(-4)); }
            catch (EntryPointNotFoundException) { }
            switch (args[0])
            {
                case "guard": return TaskbarGuard.Run(args);
                case "repair": return TaskbarGuard.Repair(args[1]);
                case "taskbar-state": Write(TaskbarGuard.GetState()); return 0;
                case "preview": WindowPreview.Run(args); return 0;
                case "focus-clash": Write(DesktopApi.SwitchClash(false)); return 0;
            }

            string line;
            while ((line = Console.ReadLine()) != null)
            {
                int id = 0;
                try
                {
                    Dictionary<string, object> request = Json.Deserialize<Dictionary<string, object>>(line);
                    id = Convert.ToInt32(request["id"]);
                    object value = args[0] == "search"
                        ? SearchProviders.Execute(request)
                        : DesktopApi.Execute(request, Convert.ToUInt32(args[1]));
                    Write(new { id = id, value = value });
                }
                catch (Exception ex) { Write(new { id = id, error = ex.Message }); }
            }
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex.Message);
            return 1;
        }
    }

    internal static void Write(object value)
    {
        Console.WriteLine(Json.Serialize(value));
        Console.Out.Flush();
    }
}

internal sealed class WindowInfo
{
    public string id { get; set; }
    public string title { get; set; }
    public string name { get; set; }
    public string path { get; set; }
    public string appId { get; set; }
    public bool minimized { get; set; }
    public bool active { get; set; }
}

internal static class DesktopApi
{
    internal const int WmCopyData = 0x004A;
    internal const int WmClose = 0x0010;
    private const uint QueryProcess = 0x1000;
    private static readonly Dictionary<string, string> Names = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

    [StructLayout(LayoutKind.Sequential)]
    internal struct Rect {
        public int Left, Top, Right, Bottom;
        public int Width { get { return Right - Left; } }
        public int Height { get { return Bottom - Top; } }
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct MonitorInfo
    {
        public int Size;
        public Rect Monitor, Work;
        public uint Flags;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct CopyData { public IntPtr Type; public int Size; public IntPtr Bytes; }

    [StructLayout(LayoutKind.Sequential)]
    private struct PropertyKey { public Guid Format; public uint Id; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct ShellExecuteInfo
    {
        public int Size;
        public uint Mask;
        public IntPtr Window;
        public string Verb, File, Parameters, Directory;
        public int Show;
        public IntPtr Instance, Item, ClassName, ClassKey;
        public uint HotKey;
        public IntPtr IconOrMonitor, Process;
    }

    [StructLayout(LayoutKind.Explicit, Size = 24)]
    private struct PropVariant
    {
        [FieldOffset(0)] public ushort Type;
        [FieldOffset(8)] public IntPtr Value;
    }

    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPropertyStore
    {
        [PreserveSig] int GetCount(out uint count);
        [PreserveSig] int GetAt(uint index, out PropertyKey key);
        [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
    }

    internal delegate bool WindowCallback(IntPtr hwnd, IntPtr data);
    [DllImport("user32.dll")] internal static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] internal static extern bool EnumWindows(WindowCallback callback, IntPtr data);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr parent, WindowCallback callback, IntPtr data);
    [DllImport("user32.dll")] internal static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool IsWindowEnabled(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool IsZoomed(IntPtr hwnd);
    [DllImport("user32.dll")] internal static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")] private static extern IntPtr GetLastActivePopup(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr hwnd, uint cmd);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] private static extern int GetWindowLong(IntPtr hwnd, int index);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hwnd, StringBuilder buffer, int max);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr hwnd, StringBuilder buffer, int max);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] internal static extern IntPtr FindWindow(string name, string title);
    [DllImport("user32.dll")] internal static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")] internal static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll")] private static extern bool ShowWindowAsync(IntPtr hwnd, int command);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] internal static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint process);
    [DllImport("user32.dll")] private static extern bool AttachThreadInput(uint thread, uint other, bool attach);
    [DllImport("user32.dll")] private static extern short GetKeyState(int key);
    [DllImport("user32.dll")] private static extern bool FlashWindow(IntPtr hwnd, bool invert);
    [DllImport("user32.dll")] internal static extern bool PostMessage(IntPtr hwnd, int message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] private static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] internal static extern IntPtr SendMessageTimeout(IntPtr hwnd, int msg,
        IntPtr wParam, ref CopyData data, uint flags, uint timeout, out IntPtr result);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern bool QueryFullProcessImageName(IntPtr handle, uint flags, StringBuilder name, ref int count);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern int GetApplicationUserModelId(IntPtr process, ref uint length, StringBuilder value);
    [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr hwnd, uint attribute, out int value, int size);
    [DllImport("shell32.dll")] private static extern int SHGetPropertyStoreForWindow(IntPtr hwnd, ref Guid iid, out IPropertyStore store);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool ShellExecuteEx(ref ShellExecuteInfo info);
    [DllImport("ole32.dll")] private static extern int PropVariantClear(ref PropVariant value);

    private static readonly HashSet<string> ShellWindows = new HashSet<string>
    {
        "Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd",
        "DV2ControlHost", "MultitaskingViewFrame", "DesktopApi.UI.Core.CoreWindow",
    };

    internal static object Execute(Dictionary<string, object> request, uint ownPid)
    {
        string command = Convert.ToString(request["command"]);
        switch (command)
        {
            case "windows": return Snapshot(ownPid, Convert.ToInt64(request["monitorWindow"]));
            case "icon": return DockAppearance.IconFor(request);
            case "backdrop":
                IntPtr handle = new IntPtr(Convert.ToInt64(request["handle"]));
                uint pid;
                GetWindowThreadProcessId(handle, out pid);
                return pid == ownPid && DockAppearance.Backdrop(handle, Convert.ToBoolean(request["enabled"]), Convert.ToBoolean(request["dark"]));
            case "activate":
                IntPtr target = new IntPtr(Convert.ToInt64(request["handle"]));
                if (Activate(target, Convert.ToBoolean(request["toggle"]))) return true;
                if (!IsWindow(target) || !IsWindowVisible(target)) return false;
                throw new InvalidOperationException("Windows 未能将此窗口切到前台，请重试");
            case "switch-clash": return SwitchClash(Convert.ToBoolean(request["toggle"]));
            case "open-app":
                OpenApp(Convert.ToString(request["appId"]));
                return true;
            case "close": return PostMessage(new IntPtr(Convert.ToInt64(request["handle"])), WmClose, IntPtr.Zero, IntPtr.Zero);
            case "start": SendChord(0x11, 0x1B); return true;
            case "desktop":
                ShowDesktop(request.ContainsKey("action") ? Convert.ToString(request["action"]) : "toggle");
                return true;
            case "quick-settings": SendChord(0x5B, 0x41); return true;
            case "notifications":
                int build;
                Int32.TryParse(Convert.ToString(Registry.GetValue(
                    @"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion", "CurrentBuildNumber", "0")), out build);
                SendChord(0x5B, build >= 22000 ? (byte)0x4E : (byte)0x41);
                return true;
            default: throw new ArgumentException("未知的桌面操作");
        }
    }

    internal static string Title(IntPtr hwnd)
    {
        var text = new StringBuilder(1024);
        GetWindowText(hwnd, text, text.Capacity);
        return text.ToString().Trim();
    }

    internal static string ClassName(IntPtr hwnd)
    {
        var text = new StringBuilder(256);
        GetClassName(hwnd, text, text.Capacity);
        return text.ToString();
    }

    internal static string ImagePath(uint pid)
    {
        if (pid == 0) return "";
        IntPtr process = OpenProcess(QueryProcess, false, pid);
        if (process == IntPtr.Zero) return "";
        try
        {
            var name = new StringBuilder(32768);
            int size = name.Capacity;
            return QueryFullProcessImageName(process, 0, name, ref size) ? name.ToString() : "";
        }
        finally { CloseHandle(process); }
    }

    private static string AppUserModelId(IntPtr hwnd)
    {
        IPropertyStore store = null;
        var iid = typeof(IPropertyStore).GUID;
        var key = new PropertyKey { Format = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), Id = 5 };
        try
        {
            if (SHGetPropertyStoreForWindow(hwnd, ref iid, out store) != 0 || store == null) return "";
            PropVariant value;
            if (store.GetValue(ref key, out value) != 0) return "";
            try { return value.Type == 31 ? Marshal.PtrToStringUni(value.Value) ?? "" : ""; }
            finally { PropVariantClear(ref value); }
        }
        catch (COMException) { return ""; }
        finally { if (store != null) Marshal.ReleaseComObject(store); }
    }

    private static string ProcessAppId(uint pid)
    {
        IntPtr process = OpenProcess(QueryProcess, false, pid);
        if (process == IntPtr.Zero) return "";
        try
        {
            uint length = 256;
            var value = new StringBuilder((int)length);
            return GetApplicationUserModelId(process, ref length, value) == 0 ? value.ToString() : "";
        }
        finally { CloseHandle(process); }
    }

    private static string AppName(string image, string title)
    {
        if (String.IsNullOrEmpty(image)) return title;
        string name;
        if (Names.TryGetValue(image, out name)) return name;
        name = Path.GetFileNameWithoutExtension(image);
        try
        {
            string description = FileVersionInfo.GetVersionInfo(image).FileDescription;
            if (!String.IsNullOrWhiteSpace(description)) name = description.Trim();
        }
        catch { }
        if (Names.Count > 256) Names.Clear();
        Names[image] = name;
        return name;
    }

    private static object Snapshot(uint ownPid, long monitorWindow)
    {
        IntPtr foreground = GetForegroundWindow();
        IntPtr foregroundRoot = GetAncestor(foreground, 3);
        var windows = new List<WindowInfo>();
        EnumWindows(delegate(IntPtr hwnd, IntPtr ignored)
        {
            uint pid;
            GetWindowThreadProcessId(hwnd, out pid);
            if (pid == ownPid || !IsWindowVisible(hwnd)) return true;
            int styles = GetWindowLong(hwnd, -20);
            bool taskButton = (styles & 0x40000) != 0;
            if (!taskButton && ((styles & 0x80) != 0 || GetWindow(hwnd, 4) != IntPtr.Zero)) return true;
            int cloaked;
            if (DwmGetWindowAttribute(hwnd, 14, out cloaked, 4) == 0 && cloaked != 0) return true;
            string cls = ClassName(hwnd);
            if (ShellWindows.Contains(cls)) return true;
            string title = Title(hwnd);
            if (title.Length == 0) return true;

            string image = ImagePath(pid);
            string appId = AppUserModelId(hwnd);
            if (cls == "ApplicationFrameWindow")
            {
                string childImage = "";
                string childApp = "";
                EnumChildWindows(hwnd, delegate(IntPtr child, IntPtr data)
                {
                    uint childPid;
                    GetWindowThreadProcessId(child, out childPid);
                    if (childPid == pid || childPid == 0) return true;
                    childImage = ImagePath(childPid);
                    childApp = AppUserModelId(child);
                    if (childApp.Length == 0) childApp = ProcessAppId(childPid);
                    return childImage.Length == 0;
                }, IntPtr.Zero);
                if (childImage.Length != 0) image = childImage;
                if (appId.Length == 0) appId = childApp;
            }
            if (appId.Length == 0) appId = ProcessAppId(pid);
            windows.Add(new WindowInfo
            {
                id = hwnd.ToInt64().ToString(), title = title, name = AppName(image, title), path = image,
                appId = appId, minimized = IsIconic(hwnd), active = hwnd == foreground || hwnd == foregroundRoot,
            });
            return true;
        }, IntPtr.Zero);
        IntPtr dockMonitor = MonitorFromWindow(new IntPtr(monitorWindow), 0);
        return new
        {
            windows = windows,
            fullscreen = IsFullscreen(foreground, dockMonitor, ownPid),
            maximized = IsMaximizedOnMonitor(foreground, dockMonitor) || IsMaximizedOnMonitor(foregroundRoot, dockMonitor),
        };
    }

    private static bool IsMaximizedOnMonitor(IntPtr hwnd, IntPtr monitor)
    {
        return hwnd != IntPtr.Zero && monitor != IntPtr.Zero && IsWindowVisible(hwnd) && !IsIconic(hwnd)
            && IsZoomed(hwnd) && MonitorFromWindow(hwnd, 2) == monitor;
    }

    private static bool IsFullscreen(IntPtr hwnd, IntPtr monitor, uint ownPid)
    {
        if (hwnd == IntPtr.Zero || monitor == IntPtr.Zero || IsZoomed(hwnd) || IsIconic(hwnd) || ShellWindows.Contains(ClassName(hwnd))) return false;
        uint pid;
        GetWindowThreadProcessId(hwnd, out pid);
        if (pid == ownPid || MonitorFromWindow(hwnd, 2) != monitor) return false;
        var info = new MonitorInfo { Size = Marshal.SizeOf(typeof(MonitorInfo)) };
        Rect rect;
        if (!GetMonitorInfo(monitor, ref info) || !GetWindowRect(hwnd, out rect)) return false;
        return Math.Abs(rect.Left - info.Monitor.Left) <= 2 && Math.Abs(rect.Top - info.Monitor.Top) <= 2
            && Math.Abs(rect.Right - info.Monitor.Right) <= 2 && Math.Abs(rect.Bottom - info.Monitor.Bottom) <= 2;
    }

    internal static string SwitchClash(bool toggle)
    {
        IntPtr mainWindow = IntPtr.Zero;
        EnumWindows(delegate(IntPtr window, IntPtr unused) {
            // The tray can hide the real top-level window. Ignore secondary startup error dialogs.
            if (ClassName(window) != "Tauri Window" || Title(window) != "Clash Verge") return true;
            uint pid;
            GetWindowThreadProcessId(window, out pid);
            if (!String.Equals(Path.GetFileName(ImagePath(pid)), "clash-verge.exe", StringComparison.OrdinalIgnoreCase)) return true;
            mainWindow = window;
            return false;
        }, IntPtr.Zero);
        if (mainWindow == IntPtr.Zero) return "missing";
        if (Activate(mainWindow, toggle, true)) return "switched";
        return IsWindow(mainWindow) ? "blocked" : "missing";
    }

    internal static bool Activate(IntPtr hwnd, bool toggle, bool reveal = false)
    {
        if (!IsWindowVisible(hwnd) && !reveal) return false;
        IntPtr foreground = GetForegroundWindow();
        if (toggle && IsWindowVisible(hwnd) && !IsIconic(hwnd) && OwnsForeground(hwnd, foreground))
            return ShowWindowAsync(hwnd, 6); // SW_MINIMIZE
        if (IsIconic(hwnd)) ShowWindowAsync(hwnd, 9); // SW_RESTORE
        else if (!IsWindowVisible(hwnd)) ShowWindowAsync(hwnd, 5); // SW_SHOW
        if (reveal)
        {
            for (int attempt = 0; attempt < 32 && IsWindow(hwnd) && (!IsWindowVisible(hwnd) || IsIconic(hwnd)); attempt++)
                Thread.Sleep(25);
            if (!IsWindowVisible(hwnd)) return false;
        }
        IntPtr target = hwnd;
        if (!IsWindowEnabled(hwnd))
        {
            IntPtr popup = GetLastActivePopup(hwnd);
            if (IsWindowVisible(popup) && IsWindowEnabled(popup) && !IsIconic(popup)) target = popup;
        }
        if (SetForegroundWindow(target) && WaitForActivation(hwnd, reveal)) return true;

        GetKeyState(0);
        uint ignored;
        uint current = GetCurrentThreadId();
        uint previous = GetWindowThreadProcessId(foreground, out ignored);
        if (foreground == GetForegroundWindow() && previous != 0 && previous != current && AttachThreadInput(current, previous, true))
        {
            try { SetForegroundWindow(target); }
            finally { AttachThreadInput(current, previous, false); }
        }
        if (WaitForActivation(hwnd, reveal)) return true;
        FlashWindow(hwnd, true);
        return false;
    }

    private static bool OwnsForeground(IntPtr hwnd, IntPtr foreground)
    {
        return foreground == hwnd || GetAncestor(foreground, 3) == hwnd;
    }

    private static bool WaitForActivation(IntPtr hwnd, bool restoringClash)
    {
        // Restoring a window can give it focus briefly during its show animation.
        int samples = 0, needed = restoringClash ? 7 : 1;
        for (int attempt = 0; attempt < 18 && IsWindowVisible(hwnd); attempt++)
        {
            samples = !IsIconic(hwnd) && OwnsForeground(hwnd, GetForegroundWindow()) ? samples + 1 : 0;
            if (samples >= needed) return true;
            Thread.Sleep(25);
        }
        return false;
    }

    private static void OpenApp(string appId)
    {
        var info = new ShellExecuteInfo {
            Size = Marshal.SizeOf(typeof(ShellExecuteInfo)),
            Mask = 0x0000000C | 0x00000100 | 0x00000400, // INVOKEIDLIST, NOASYNC, FLAG_NO_UI
            File = @"shell:AppsFolder\" + appId,
            Show = 1,
        };
        if (!ShellExecuteEx(ref info))
            throw new Win32Exception(Marshal.GetLastWin32Error(), "无法打开这个应用，请检查它是否仍然安装");
    }

    private static void ShowDesktop(string action)
    {
        if (action == "toggle")
        {
            SendChord(0x5B, 0x44);
            return;
        }
        object shell = Activator.CreateInstance(Type.GetTypeFromProgID("Shell.Application"));
        try
        {
            // Minimize only app windows. Explorer's desktop layer continues to host the pond.
            if (action == "minimize") ((dynamic)shell).MinimizeAll();
            else if (action == "restore") ((dynamic)shell).UndoMinimizeALL();
            else throw new ArgumentException("未知的显示桌面操作");
        }
        finally { Marshal.ReleaseComObject(shell); }
    }

    private static void SendChord(byte modifier, byte key)
    {
        keybd_event(modifier, 0, 0, UIntPtr.Zero);
        keybd_event(key, 0, 0, UIntPtr.Zero);
        keybd_event(key, 0, 2, UIntPtr.Zero);
        keybd_event(modifier, 0, 2, UIntPtr.Zero);
    }
}
