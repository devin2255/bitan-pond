# Only used by the opted-in, disposable CI desktop tests.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class TangliTestDesktop {
  delegate bool EnumProc(IntPtr h, IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr data);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int command);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder name, int length);
  public static IntPtr[] Minimize() {
    var hidden = new List<IntPtr>();
    EnumProc callback = delegate(IntPtr h, IntPtr data) {
      var name = new StringBuilder(128); GetClassName(h, name, name.Capacity);
      string c = name.ToString();
      if (IsWindowVisible(h) && !IsIconic(h) && c != "Progman" && c != "WorkerW" &&
          c != "Shell_TrayWnd" && c != "Shell_SecondaryTrayWnd") {
        if (ShowWindow(h, 6)) hidden.Add(h);
      }
      return true;
    };
    EnumWindows(callback, IntPtr.Zero);
    return hidden.ToArray();
  }
  public static void Restore(IntPtr[] windows) {
    foreach (var h in windows) ShowWindow(h, 9);
  }
}
'@
