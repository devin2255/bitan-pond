// Native screen probe for tools/dock-smoke.cjs. The pattern has 4px fine stripes
// over broad bands. Frost should suppress only the fine detail.
using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using System.Windows.Automation;

internal sealed class TestPlate : Form
{
    private readonly Image scene;
    private readonly string modeFile;
    private string mode = "pattern";
    private readonly Timer refresh = new Timer { Interval = 90 };
    private TestPlate(string picture, string control)
    {
        scene = Image.FromFile(picture);
        modeFile = control;
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.Manual;
        ShowInTaskbar = false;
        DoubleBuffered = true;
        Rectangle area = Screen.PrimaryScreen.WorkingArea;
        Bounds = new Rectangle(area.X, area.Bottom - 180, area.Width, 180);
        refresh.Tick += delegate {
            var next = File.Exists(modeFile) ? File.ReadAllText(modeFile) : "pattern";
            if (mode != next) { mode = next; Invalidate(); }
        };
        refresh.Start();
    }
    protected override void OnPaint(PaintEventArgs e)
    {
        if (mode == "scene")
        {
            var band = new Rectangle(0, scene.Height / 2, scene.Width, Math.Max(1, scene.Width * Height / Width));
            e.Graphics.DrawImage(scene, ClientRectangle, band, GraphicsUnit.Pixel);
            return;
        }
        for (int x = 0; x < Width; x += 4)
        {
            int offset = (x / 4 % 2 == 0 ? -44 : 44) + (x / 96 % 2 == 0 ? -48 : 48);
            using (var brush = new SolidBrush(Color.FromArgb(134 + offset, 131 + offset, 128 + offset)))
                e.Graphics.FillRectangle(brush, x, 0, 4, Height);
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] private static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr hwnd, int command);
    [DllImport("user32.dll")] private static extern bool ShowWindowAsync(IntPtr hwnd, int command);
    [DllImport("user32.dll")] private static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] private static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern IntPtr FindWindow(string cls, string name);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string title);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out Rect rect, int size);

    private static int MeasureMaximized(bool hold)
    {
        using (var window = new Form { Text = "塘里最大化验收", StartPosition = FormStartPosition.CenterScreen })
        using (var timer = new Timer { Interval = 400 })
        {
            window.Shown += delegate { window.WindowState = FormWindowState.Maximized; window.Activate(); timer.Start(); };
            timer.Tick += delegate {
                timer.Stop();
                Rect frame;
                if (DwmGetWindowAttribute(window.Handle, 9, out frame, Marshal.SizeOf(typeof(Rect))) != 0)
                    throw new InvalidOperationException("DWM frame unavailable");
                var screen = Screen.FromHandle(window.Handle);
                Console.WriteLine(new JavaScriptSerializer().Serialize(new {
                    frame = new[] { frame.Left, frame.Top, frame.Right, frame.Bottom },
                    screen = new[] { screen.Bounds.Left, screen.Bounds.Top, screen.Bounds.Right, screen.Bounds.Bottom },
                    work = new[] { screen.WorkingArea.Left, screen.WorkingArea.Top, screen.WorkingArea.Right, screen.WorkingArea.Bottom }
                }));
                if (!hold) window.Close();
            };
            Application.Run(window);
        }
        return 0;
    }

    private static int ReadBin(string name)
    {
        foreach (string cls in new[] { "Progman", "WorkerW" }) {
            IntPtr parent = IntPtr.Zero;
            while ((parent = FindWindowEx(IntPtr.Zero, parent, cls, null)) != IntPtr.Zero) {
                IntPtr view = FindWindowEx(parent, IntPtr.Zero, "SHELLDLL_DefView", null);
                if (view == IntPtr.Zero) continue;
                IntPtr list = FindWindowEx(view, IntPtr.Zero, "SysListView32", null);
                if (list == IntPtr.Zero) continue;
                var desktop = AutomationElement.FromHandle(list);
                var item = desktop.FindFirst(TreeScope.Children, new PropertyCondition(AutomationElement.NameProperty, name));
                Console.WriteLine(item == null ? "hidden" : "visible");
                return 0;
            }
        }
        return 1;
    }

    [STAThread]
    private static int Main(string[] args)
    {
        SetProcessDpiAwarenessContext(new IntPtr(-4));
        if (args[0] == "max") return MeasureMaximized(args.Length > 1 && args[1] == "hold");
        if (args[0] == "pixel")
        {
            using (var image = new Bitmap(1, 1))
            {
                using (var graphics = Graphics.FromImage(image))
                    graphics.CopyFromScreen(Int32.Parse(args[1]), Int32.Parse(args[2]), 0, 0, image.Size);
                Color pixel = image.GetPixel(0, 0);
                Console.WriteLine(new JavaScriptSerializer().Serialize(new[] { pixel.R, pixel.G, pixel.B }));
            }
            return 0;
        }
        if (args[0] == "hide") return ShowWindowAsync(new IntPtr(Int64.Parse(args[1])), 0) ? 0 : 1;
        if (args[0] == "foreground")
        {
            using (var window = new Form { Text = "Tangli foreground fixture", StartPosition = FormStartPosition.CenterScreen })
            {
                window.Shown += delegate { ShowWindow(window.Handle, 5); window.Activate(); };
                Application.Run(window);
            }
            return 0;
        }
        if (args[0] == "cursor")
        {
            if (args.Length == 1) Console.WriteLine(new JavaScriptSerializer().Serialize(new[] { Cursor.Position.X, Cursor.Position.Y }));
            else if (!SetCursorPos(Int32.Parse(args[1]), Int32.Parse(args[2]))) return 1;
            else if (args.Length > 3)
            {
                mouse_event(2, 0, 0, 0, UIntPtr.Zero);
                System.Threading.Thread.Sleep(50);
                mouse_event(4, 0, 0, 0, UIntPtr.Zero);
            }
            return 0;
        }
        if (args[0] == "bin") return ReadBin(args[1]);
        if (args[0] == "plate") { Application.Run(new TestPlate(args[1], args[2])); return 0; }
        IntPtr shell = FindWindow("Shell_TrayWnd", null);
        IntPtr hwnd = IntPtr.Zero;
        uint pid = 0;
        while ((hwnd = FindWindowEx(IntPtr.Zero, hwnd, null, "塘里 Dock")) != IntPtr.Zero)
        {
            GetWindowThreadProcessId(hwnd, out pid);
            if (pid == UInt32.Parse(args[1])) break;
        }
        Rect r = new Rect();
        GetWindowRect(hwnd, out r);
        int w = r.Right - r.Left, h = r.Bottom - r.Top;
        double fine = 0, broad = 0;
        if (args.Length > 2 && w > 0 && h > 0)
        {
            var monitor = Screen.FromHandle(hwnd).Bounds;
            Rectangle crop = Rectangle.Intersect(monitor, new Rectangle(r.Left - 8, r.Top - 8, w + 16, h + 16));
            using (var image = new Bitmap(crop.Width, crop.Height))
            {
                using (var g = Graphics.FromImage(image)) g.CopyFromScreen(crop.Location, Point.Empty, crop.Size);
                image.Save(args[2], ImageFormat.Png);
                int y = r.Top - crop.Top + 4;
                int count = 0;
                for (int x = r.Left + 23; x + 97 < r.Right - 23; x++)
                {
                    if ((x & 7) != 1 || x % 96 > 86) continue;
                    int first = image.GetPixel(x - crop.Left,y).R;
                    fine += Math.Abs(first - image.GetPixel(x - crop.Left + 4,y).R);
                    broad += Math.Abs(first - image.GetPixel(x - crop.Left + 96,y).R);
                    count++;
                }
                if (count > 0) { fine /= count; broad /= count; }
            }
        }
        Console.WriteLine(new JavaScriptSerializer().Serialize(new {
            x = r.Left, y = r.Top, width = w, height = h, visible = IsWindowVisible(hwnd),
            taskbarVisible = IsWindowVisible(shell), fine = fine, broad = broad
        }));
        return 0;
    }
}
