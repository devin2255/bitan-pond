using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using Microsoft.Win32;

internal static class DockAppearance
{
    [StructLayout(LayoutKind.Sequential)]
    private struct Accent { public int State, Flags; public uint Tint; public int Animation; }
    [StructLayout(LayoutKind.Sequential)]
    private struct Composition { public int Attribute; public IntPtr Data, Size; }
    [DllImport("user32.dll")] private static extern bool SetWindowCompositionAttribute(IntPtr window, ref Composition attribute);
    [DllImport("dwmapi.dll")] private static extern int DwmSetWindowAttribute(IntPtr window, int attribute, ref int value, int size);

    internal static bool Backdrop(IntPtr hwnd, bool enabled, bool dark)
    {
        enabled = enabled && !SystemInformation.HighContrast && !Equals(Registry.GetValue(
            @"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "EnableTransparency", 1), 0);
        int build;
        Int32.TryParse(Convert.ToString(Registry.GetValue(@"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion", "CurrentBuildNumber", "0")), out build);
        if (build >= 22621)
        {
            int theme = dark ? 1 : 0, material = enabled ? 3 : 1;
            DwmSetWindowAttribute(hwnd, 20, ref theme, 4);
            if (DwmSetWindowAttribute(hwnd, 38, ref material, 4) == 0 && enabled) return true;
        }
        if (build < 17763) return false;
        var accent = new Accent { State = enabled ? 4 : 0, Tint = dark ? 0x50231e1bu : 0x32e4e9e8u };
        int bytes = Marshal.SizeOf(typeof(Accent));
        IntPtr buffer = Marshal.AllocHGlobal(bytes);
        try
        {
            Marshal.StructureToPtr(accent, buffer, false);
            var data = new Composition { Attribute = 19, Data = buffer, Size = new IntPtr(bytes) };
            return SetWindowCompositionAttribute(hwnd, ref data) && enabled;
        }
        catch (EntryPointNotFoundException) { return false; }
        finally { Marshal.FreeHGlobal(buffer); }
    }

    [ComImport, Guid("BCC18B79-BA16-442F-80C4-8A59C30C463B"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IImageFactory
    {
        [PreserveSig] int GetImage(Size size, uint flags, out IntPtr bitmap);
    }
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] private static extern int SHCreateItemFromParsingName(string name, IntPtr context, ref Guid iid, out IImageFactory item);
    [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr handle);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern uint PrivateExtractIcons(string file, int index, int width, int height, out IntPtr icon, out uint id, uint count, uint flags);
    [DllImport("user32.dll")] private static extern bool DestroyIcon(IntPtr handle);
    [DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW")] private static extern IntPtr IconMessage(IntPtr hwnd, int msg, IntPtr kind, IntPtr dpi, uint flags, uint timeout, out IntPtr icon);
    [DllImport("user32.dll", EntryPoint = "GetClassLongPtrW")] private static extern IntPtr ClassIcon(IntPtr hwnd, int index);
    [DllImport("user32.dll", EntryPoint = "LoadIconW")] private static extern IntPtr LoadIcon(IntPtr instance, IntPtr resource);
    [DllImport("gdi32.dll")] private static extern int GetDIBits(IntPtr dc, IntPtr bitmap, uint start, uint rows, IntPtr data, ref BitmapHeader info, uint usage);
    [DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleDC(IntPtr dc);
    [DllImport("gdi32.dll")] private static extern bool DeleteDC(IntPtr dc);
    [StructLayout(LayoutKind.Sequential)]
    private struct BitmapHeader
    {
        public uint Size;
        public int Width, Height;
        public ushort Planes, Bits;
        public uint Compression, ImageSize;
        public int X, Y;
        public uint Used, Important;
    }

    private static string Encode(Bitmap bitmap)
    {
        using (var stream = new MemoryStream())
        {
            bitmap.Save(stream, ImageFormat.Png);
            return Convert.ToBase64String(stream.ToArray());
        }
    }

    private static string ShellIcon(string target)
    {
        if (String.IsNullOrEmpty(target)) return "";
        IImageFactory item = null;
        IntPtr image = IntPtr.Zero;
        try
        {
            Guid iid = typeof(IImageFactory).GUID;
            if (SHCreateItemFromParsingName(target, IntPtr.Zero, ref iid, out item) != 0 || item == null) return "";
            if (item.GetImage(new Size(96, 96), 4, out image) != 0 || image == IntPtr.Zero) return "";
            using (var dimensions = Image.FromHbitmap(image))
            using (var bitmap = new Bitmap(dimensions.Width, dimensions.Height, PixelFormat.Format32bppPArgb))
            {
                var bounds = new Rectangle(Point.Empty, bitmap.Size);
                var pixels = bitmap.LockBits(bounds, ImageLockMode.WriteOnly, bitmap.PixelFormat);
                IntPtr dc = CreateCompatibleDC(IntPtr.Zero);
                try
                {
                    var header = new BitmapHeader { Size = 40, Width = bitmap.Width, Height = -bitmap.Height, Planes = 1, Bits = 32 };
                    if (GetDIBits(dc, image, 0, (uint)bitmap.Height, pixels.Scan0, ref header, 0) == 0) return "";
                    // Some legacy shell extensions return opaque RGB with a zero alpha channel.
                    int length = pixels.Stride * bitmap.Height;
                    byte[] data = new byte[length];
                    Marshal.Copy(pixels.Scan0, data, 0, length);
                    bool hasAlpha = false;
                    for (int i = 3; i < length && !hasAlpha; i += 4) hasAlpha = data[i] != 0;
                    if (!hasAlpha)
                    {
                        for (int i = 3; i < length; i += 4) data[i] = 255;
                        Marshal.Copy(data, 0, pixels.Scan0, length);
                    }
                }
                finally { DeleteDC(dc); bitmap.UnlockBits(pixels); }
                return Encode(bitmap);
            }
        }
        finally
        {
            if (image != IntPtr.Zero) DeleteObject(image);
            if (item != null) Marshal.ReleaseComObject(item);
        }
    }

    private static string PackageLogo(string appId)
    {
        object shell = null, folder = null, entry = null;
        try
        {
            shell = Activator.CreateInstance(Type.GetTypeFromProgID("Shell.Application"));
            folder = ((dynamic)shell).NameSpace("shell:AppsFolder");
            entry = ((dynamic)folder).ParseName(appId);
            if (entry == null) return "";
            string root = Convert.ToString(((dynamic)entry).ExtendedProperty("System.AppUserModel.PackageInstallPath"));
            string relative = Convert.ToString(((dynamic)entry).ExtendedProperty("System.Tile.SmallLogoPath"));
            if (String.IsNullOrEmpty(root) || String.IsNullOrEmpty(relative) || Path.IsPathRooted(relative)) return "";
            string logo = Path.GetFullPath(Path.Combine(root, relative));
            if (!logo.StartsWith(root.TrimEnd('\\') + "\\", StringComparison.OrdinalIgnoreCase)) return "";
            string basename = Path.Combine(Path.GetDirectoryName(logo), Path.GetFileNameWithoutExtension(logo));
            foreach (string variant in new[] { "_altform-unplated", "_altform-lightunplated", "" })
            {
                foreach (int size in new[] { 96, 80, 72, 64, 256, 60, 48, 40, 32 })
                {
                    string file = basename + ".targetsize-" + size + variant + ".png";
                    if (File.Exists(file)) return Convert.ToBase64String(File.ReadAllBytes(file));
                }
            }
            return "";
        }
        catch (UnauthorizedAccessException) { return ""; }
        catch (IOException) { return ""; }
        finally
        {
            if (entry != null) Marshal.ReleaseComObject(entry);
            if (folder != null) Marshal.ReleaseComObject(folder);
            if (shell != null) Marshal.ReleaseComObject(shell);
        }
    }

    private static string IconData(IntPtr icon)
    {
        if (icon == IntPtr.Zero) return "";
        using (var wrapper = Icon.FromHandle(icon))
        using (var bitmap = wrapper.ToBitmap()) return Encode(bitmap);
    }

    private static string ResourceIcon(string file, int index)
    {
        if (String.IsNullOrWhiteSpace(file)) return "";
        IntPtr icon;
        uint id;
        uint count = PrivateExtractIcons(Environment.ExpandEnvironmentVariables(file.Trim('"')), index, 96, 96, out icon, out id, 1, 0);
        if (count != 1 || icon == IntPtr.Zero) return "";
        try { return IconData(icon); }
        finally { DestroyIcon(icon); }
    }

    private static string WindowIcon(IntPtr hwnd)
    {
        if (!DesktopApi.IsWindow(hwnd)) return "";
        IntPtr generic = LoadIcon(IntPtr.Zero, new IntPtr(32512));
        foreach (int kind in new[] { 1, 2, 0 })
        {
            IntPtr icon;
            if (IconMessage(hwnd, 0x7F, new IntPtr(kind), IntPtr.Zero, 2, 65, out icon) == IntPtr.Zero) break;
            if (icon != IntPtr.Zero && icon != generic) return IconData(icon);
        }
        foreach (int index in new[] { -14, -34 })
        {
            IntPtr icon = ClassIcon(hwnd, index);
            if (icon != IntPtr.Zero && icon != generic) return IconData(icon);
        }
        return "";
    }

    internal static string IconFor(Dictionary<string, object> request)
    {
        string appId = Convert.ToString(request["appId"]), file = Convert.ToString(request["file"]);
        string shortcut = Convert.ToString(request["shortcutTarget"]);
        IntPtr hwnd = new IntPtr(Convert.ToInt64(request["handle"]));
        var sources = new List<Func<string>>();
        if (file.EndsWith(".lnk", StringComparison.OrdinalIgnoreCase))
        {
            sources.Add(() => ResourceIcon(Convert.ToString(request["shortcutIcon"]), Convert.ToInt32(request["shortcutIndex"])));
            sources.Add(() => ShellIcon(file));
        }
        if (appId.Contains("!")) sources.Add(() => PackageLogo(appId));
        if (appId.Length > 0) sources.Add(() => ShellIcon(@"shell:AppsFolder\" + appId));
        if (hwnd != IntPtr.Zero) sources.Add(() => WindowIcon(hwnd));
        if (!String.IsNullOrEmpty(shortcut)) sources.Add(() => ShellIcon(shortcut));
        if (file.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) sources.Add(() => ResourceIcon(file, 0));
        if (file.Length > 0) sources.Add(() => ShellIcon(file));
        foreach (var source in sources)
        {
            try { string result = source(); if (result.Length != 0) return result; }
            catch (ExternalException) { }
            catch (ArgumentException) { }
        }
        return "";
    }
}
