using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

internal sealed class TaskbarGuard : NativeWindow, IDisposable
{
    private const uint ReadState = 4, WriteState = 10;
    private const ulong AutoHide = 1;
    private const string MutexName = @"Local\Tangli.Dock.TaskbarGuard";
    private readonly string journal;
    private readonly int parentPid;
    private readonly System.Windows.Forms.Timer monitor;
    private IntPtr originalShell;
    private IntPtr shellEventHook;
    private readonly WinEvent onShow;
    private ulong before, applied;
    private bool stopping;

    [StructLayout(LayoutKind.Sequential)]
    private struct AppBarData
    {
        public uint Size;
        public IntPtr Hwnd;
        public uint CallbackMessage, Edge;
        public DesktopApi.Rect Area;
        public IntPtr Parameter;
    }

    [DllImport("shell32.dll")] private static extern UIntPtr SHAppBarMessage(uint message, ref AppBarData data);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr handle);
    [DllImport("user32.dll")] private static extern bool ShowWindowAsync(IntPtr handle, int command);
    private delegate void WinEvent(IntPtr hook, uint evt, IntPtr window, int obj, int child, uint thread, uint time);
    [DllImport("user32.dll")] private static extern IntPtr SetWinEventHook(uint first, uint last, IntPtr library, WinEvent callback, uint pid, uint thread, uint flags);
    [DllImport("user32.dll")] private static extern bool UnhookWinEvent(IntPtr hook);

    private TaskbarGuard(int pid, string file)
    {
        journal = file;
        parentPid = pid;
        onShow = delegate(IntPtr hook, uint evt, IntPtr window, int obj, int child, uint thread, uint time) {
            if (!stopping && window == originalShell && obj == 0 && child == 0 && IsWindowVisible(window))
                ShowWindowAsync(window, 0);
        };
        CreateHandle(new CreateParams { Caption = "Tangli taskbar recovery", Style = unchecked((int)0x80000000) });
        monitor = new System.Windows.Forms.Timer { Interval = 350 };
        monitor.Tick += Check;
    }

    private static AppBarData Data(IntPtr handle)
    {
        return new AppBarData { Size = (uint)Marshal.SizeOf(typeof(AppBarData)), Hwnd = handle };
    }

    private static IntPtr Shell { get { return DesktopApi.FindWindow("Shell_TrayWnd", null); } }
    internal static ulong GetState()
    {
        var data = Data(Shell);
        return SHAppBarMessage(ReadState, ref data).ToUInt64();
    }

    private static void SetState(IntPtr handle, ulong value)
    {
        var data = Data(handle);
        data.Parameter = new IntPtr(unchecked((long)value));
        SHAppBarMessage(WriteState, ref data);
    }

    private static bool TakeMutex(Mutex mutex)
    {
        try { return mutex.WaitOne(0); }
        catch (AbandonedMutexException) { return true; }
    }

    internal static int Run(string[] args)
    {
        using (var mutex = new Mutex(false, MutexName))
        {
            if (!TakeMutex(mutex)) throw new InvalidOperationException("任务栏恢复助手正在运行");
            try
            {
                if (!RepairLocked(args[2])) throw new InvalidOperationException("原任务栏状态暂时无法恢复");
                using (var guard = new TaskbarGuard(Int32.Parse(args[1]), args[2]))
                {
                    guard.Start();
                    var input = new Thread(delegate()
                    {
                        Console.ReadLine();
                        if (guard.Handle != IntPtr.Zero)
                            DesktopApi.PostMessage(guard.Handle, DesktopApi.WmClose, IntPtr.Zero, IntPtr.Zero);
                    });
                    input.IsBackground = true;
                    input.Start();
                    Application.Run();
                }
                return 0;
            }
            finally { mutex.ReleaseMutex(); }
        }
    }

    internal static int Repair(string file)
    {
        using (var mutex = new Mutex(false, MutexName))
        {
            if (!TakeMutex(mutex)) return 0;
            try { return RepairLocked(file) ? 0 : 1; }
            finally { mutex.ReleaseMutex(); }
        }
    }

    private static bool RepairLocked(string file)
    {
        if (!File.Exists(file)) return true;
        string[] values = File.ReadAllLines(file);
        ulong before, applied;
        if ((values.Length < 2 || values.Length > 4) || !UInt64.TryParse(values[0], out before) || !UInt64.TryParse(values[1], out applied))
            return false;
        if (Shell == IntPtr.Zero) return false;
        if (before != applied && (GetState() & AutoHide) == (applied & AutoHide))
        {
            ulong current = GetState();
            SetState(Shell, (current & ~AutoHide) | (before & AutoHide));
            if ((GetState() & AutoHide) != (before & AutoHide)) return false;
        }
        if (values.Length >= 3)
        {
            bool show = values[2] == "visible";
            if (!SetVisible(Shell, show)) return false;
            if (show && (before & AutoHide) == 0)
            {
                // Explorer can apply a queued hide after it has already reported the restored state.
                for (int attempt = 0; attempt < 4; attempt++)
                {
                    Thread.Sleep(100);
                    if (!SetVisible(Shell, true)) return false;
                }
            }
        }
        if (values.Length == 4 && ReadBinPreference() == "1") WriteBinPreference(values[3]);
        File.Delete(file);
        return true;
    }

    private static bool SetVisible(IntPtr window, bool show)
    {
        if (IsWindowVisible(window) == show) return true;
        ShowWindowAsync(window, show ? 8 : 0); // SW_SHOWNA preserves the foreground app.
        for (int i = 0; i < 12 && IsWindowVisible(window) != show; i++) Thread.Sleep(20);
        return IsWindowVisible(window) == show;
    }

    private void Start()
    {
        if (Screen.AllScreens.Length != 1 || Shell == IntPtr.Zero || !ParentAlive())
            throw new InvalidOperationException("任务栏接管需要可用的单屏 Windows 桌面");
        originalShell = Shell;
        uint shellPid;
        DesktopApi.GetWindowThreadProcessId(originalShell, out shellPid);
        shellEventHook = SetWinEventHook(0x8002, 0x8002, IntPtr.Zero, onShow, shellPid, 0, 0); // EVENT_OBJECT_SHOW
        before = GetState();
        applied = before | AutoHide;
        Directory.CreateDirectory(Path.GetDirectoryName(journal));
        string temporary = journal + ".tmp";
        File.WriteAllLines(temporary, new[] { before.ToString(CultureInfo.InvariantCulture), applied.ToString(CultureInfo.InvariantCulture),
            IsWindowVisible(originalShell) ? "visible" : "hidden", ReadBinPreference() });
        File.Move(temporary, journal);
        WriteBinPreference("1");
        SetState(originalShell, applied);
        if ((GetState() & AutoHide) == 0) throw new InvalidOperationException("Windows 未确认任务栏自动隐藏");
        if (!SetVisible(originalShell, false)) throw new InvalidOperationException("Windows 任务栏仍然可见，已取消接管");

        // Explorer can briefly show its taskbar again while applying the new work area.
        for (int i = 0; i < 5; i++) {
            Thread.Sleep(55);
            if (!SetVisible(originalShell, false)) throw new InvalidOperationException("系统任务栏未能保持隐藏");
        }
        Program.Write(new { ready = true });
        monitor.Start();
    }

    private const string DesktopIcons = @"Software\Microsoft\Windows\CurrentVersion\Explorer\HideDesktopIcons\NewStartPanel";
    private const string Bin = "{645FF040-5081-101B-9F08-00AA002F954E}";

    private static string ReadBinPreference()
    {
        using (var key = Registry.CurrentUser.OpenSubKey(DesktopIcons))
        {
            object value = key == null ? null : key.GetValue(Bin);
            if (value == null) return "missing";
            if (!(value is int)) throw new InvalidDataException("回收站图标设置格式异常");
            return ((int)value).ToString(CultureInfo.InvariantCulture);
        }
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string name);

    private static void WriteBinPreference(string saved)
    {
        if (ReadBinPreference() == saved) return;
        using (var key = Registry.CurrentUser.CreateSubKey(DesktopIcons))
        {
            if (saved == "missing") key.DeleteValue(Bin, false);
            else key.SetValue(Bin, Int32.Parse(saved, CultureInfo.InvariantCulture), RegistryValueKind.DWord);
            key.Flush();
        }
        // Refresh the desktop folder view (including WorkerW-hosted desktops).
        DesktopApi.EnumWindows(delegate(IntPtr window, IntPtr unused) {
            string cls = DesktopApi.ClassName(window);
            if (cls != "Progman" && cls != "WorkerW") return true;
            IntPtr view = FindWindowEx(window, IntPtr.Zero, "SHELLDLL_DefView", null);
            if (view == IntPtr.Zero) return true;
            DesktopApi.PostMessage(view, 0x111, new IntPtr(0x7103), IntPtr.Zero);
            return false;
        }, IntPtr.Zero);
    }

    private bool ParentAlive()
    {
        try { using (var parent = Process.GetProcessById(parentPid)) return !parent.HasExited; }
        catch { return false; }
    }

    private void Check(object sender, EventArgs args)
    {
        if (!ParentAlive() || Screen.AllScreens.Length != 1 || Shell != originalShell || (GetState() & AutoHide) == 0)
            Stop();
        else if (!SetVisible(originalShell, false)) Stop();
    }

    private void Stop()
    {
        if (stopping) return;
        stopping = true;
        monitor.Stop();
        Application.ExitThread();
    }

    protected override void WndProc(ref Message message)
    {
        if (message.Msg == DesktopApi.WmClose) { Stop(); return; }
        base.WndProc(ref message);
    }

    public void Dispose()
    {
        monitor.Dispose();
        stopping = true;
        if (shellEventHook != IntPtr.Zero) UnhookWinEvent(shellEventHook);
        try
        {
            for (int attempt = 0; attempt < 32 && !RepairLocked(journal); attempt++) Thread.Sleep(250);
        }
        finally { DestroyHandle(); }
    }
}
