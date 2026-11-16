# Read-only hash of each monitor's Windows wallpaper, for the desktop smoke test.
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
[ComImport, Guid("C2CF3110-460E-4FC1-B9D0-8A1C0C9CC4BD")] class DesktopWallpaperClass {}
[ComImport, Guid("B92B56A9-8B55-4E14-9A89-0199BBB6F93B"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IDesktopWallpaperTest {
  void SetWallpaper([MarshalAs(UnmanagedType.LPWStr)] string id, [MarshalAs(UnmanagedType.LPWStr)] string path);
  [return:MarshalAs(UnmanagedType.LPWStr)] string GetWallpaper([MarshalAs(UnmanagedType.LPWStr)] string id);
  [return:MarshalAs(UnmanagedType.LPWStr)] string GetMonitorDevicePathAt(uint index);
  uint GetMonitorDevicePathCount();
}
public static class WallpaperSnapshot {
  public static string Read() {
    var wallpaper = (IDesktopWallpaperTest)new DesktopWallpaperClass();
    var text = new StringBuilder();
    uint count = wallpaper.GetMonitorDevicePathCount();
    for (uint i = 0; i < count; i++) {
      string id = wallpaper.GetMonitorDevicePathAt(i);
      text.Append(id).Append("\n").Append(wallpaper.GetWallpaper(id)).Append("\n");
    }
    using (var hash = SHA256.Create())
      return count + ":" + BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(text.ToString())));
  }
}
"@
[WallpaperSnapshot]::Read()
