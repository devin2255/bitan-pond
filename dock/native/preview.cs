using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

internal sealed class WindowPreview : Form
{
    [StructLayout(LayoutKind.Sequential)]
    private struct ThumbnailProperties
    {
        public uint Flags;
        public DesktopApi.Rect Destination, Source;
        public byte Opacity;
        [MarshalAs(UnmanagedType.Bool)] public bool Visible, SourceClientAreaOnly;
    }

    [DllImport("dwmapi.dll")] private static extern int DwmRegisterThumbnail(IntPtr destination, IntPtr source, out IntPtr preview);
    [DllImport("dwmapi.dll")] private static extern int DwmUpdateThumbnailProperties(IntPtr preview, ref ThumbnailProperties properties);
    [DllImport("dwmapi.dll")] private static extern int DwmUnregisterThumbnail(IntPtr preview);

    private readonly List<IntPtr> previews = new List<IntPtr>();
    private readonly Timer monitor = new Timer { Interval = 500 };

    internal static void Run(string[] args)
    {
        Application.EnableVisualStyles();
        using (var preview = new WindowPreview(args)) Application.Run(preview);
    }

    private WindowPreview(string[] args)
    {
        int parentPid = Int32.Parse(args[1]);
        var handles = new List<IntPtr>();
        foreach (string item in args[2].Split(','))
        {
            IntPtr hwnd = new IntPtr(Int64.Parse(item));
            if (DesktopApi.IsWindow(hwnd)) handles.Add(hwnd);
        }
        if (handles.Count == 0) throw new InvalidOperationException("没有可切换的窗口");
        var anchor = new Point(Int32.Parse(args[3]), Int32.Parse(args[4]));
        var work = Screen.FromPoint(anchor).WorkingArea;
        string edge = args[5];
        int columns = Math.Max(1, Math.Min(4, work.Width / 210));
        int tileWidth = Math.Min(210, Math.Max(100, work.Width - 20));
        int tileHeight = 144;

        BackColor = Color.FromArgb(26, 41, 46);
        ForeColor = Color.WhiteSmoke;
        Font = new Font("Microsoft YaHei UI", 9);
        Text = "选择窗口";
        FormBorderStyle = FormBorderStyle.FixedToolWindow;
        ShowInTaskbar = false;
        TopMost = true;
        KeyPreview = true;
        AutoScroll = true;
        StartPosition = FormStartPosition.Manual;
        ClientSize = new Size(Math.Min(columns, handles.Count) * tileWidth + 16,
            Math.Min(work.Height - 50, ((handles.Count + columns - 1) / columns) * tileHeight + 8));
        int left = edge == "left" ? anchor.X + 10 : edge == "right" ? anchor.X - Width - 10 : anchor.X - Width / 2;
        int top = edge == "bottom" ? anchor.Y - Height - 8 : anchor.Y - Height / 2;
        Location = new Point(Math.Max(work.Left, Math.Min(left, work.Right - Width)),
            Math.Max(work.Top, Math.Min(top, work.Bottom - Height)));
        KeyDown += delegate(object sender, KeyEventArgs e) { if (e.KeyCode == Keys.Escape) Close(); };
        Deactivate += delegate { Close(); };
        monitor.Tick += delegate
        {
            try { using (var p = Process.GetProcessById(parentPid)) if (p.HasExited) Close(); }
            catch { Close(); }
        };

        for (int i = 0; i < handles.Count; i++)
        {
            IntPtr hwnd = handles[i];
            var button = new Button
            {
                Text = DesktopApi.Title(hwnd), TextAlign = ContentAlignment.BottomCenter,
                ForeColor = Color.WhiteSmoke, BackColor = Color.FromArgb(37, 57, 61),
                FlatStyle = FlatStyle.Flat, AutoEllipsis = true,
                Bounds = new Rectangle(4 + i % columns * tileWidth, 4 + i / columns * tileHeight, tileWidth - 6, tileHeight - 5),
            };
            button.Click += delegate {
                if (DesktopApi.Activate(hwnd, false)) Close();
                else Text = "无法切换到此窗口";
            };
            Controls.Add(button);
        }
        Shown += delegate { Redraw(handles); monitor.Start(); };
        Scroll += delegate { Redraw(handles); };
    }

    private void Redraw(List<IntPtr> handles)
    {
        Clear();
        for (int i = 0; i < handles.Count; i++)
        {
            Rectangle bounds = Rectangle.Intersect(ClientRectangle, Controls[i].Bounds);
            if (bounds.Height < 40) continue;
            IntPtr thumbnail;
            if (DwmRegisterThumbnail(Handle, handles[i], out thumbnail) != 0) continue;
            previews.Add(thumbnail);
            var properties = new ThumbnailProperties
            {
                Flags = 1 | 4 | 8, Opacity = 255, Visible = true,
                Destination = new DesktopApi.Rect { Left = bounds.Left + 8, Right = bounds.Right - 8, Top = bounds.Top + 6, Bottom = bounds.Bottom - 27 },
            };
            DwmUpdateThumbnailProperties(thumbnail, ref properties);
        }
    }

    private void Clear()
    {
        foreach (IntPtr preview in previews) DwmUnregisterThumbnail(preview);
        previews.Clear();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) { Clear(); monitor.Dispose(); }
        base.Dispose(disposing);
    }
}
