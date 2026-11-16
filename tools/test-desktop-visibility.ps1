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
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr FindWindow(string c, string n);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint command);
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr(IntPtr h, int index);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out Rect r);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attribute, out int value, int size);
  [StructLayout(LayoutKind.Sequential)] struct Rect { public int left, top, right, bottom; }
  public static string[] DescribeDesktop() {
    var lines = new List<string>();
    var progman = FindWindow("Progman", null);
    for (var h = GetWindow(progman, 5); h != IntPtr.Zero; h = GetWindow(h, 2)) {
      var name = new StringBuilder(128); GetClassName(h, name, name.Capacity);
      Rect r; GetWindowRect(h, out r); int cloak; DwmGetWindowAttribute(h, 14, out cloak, 4);
      lines.Add(h.ToInt64()+" "+name+" style="+GetWindowLongPtr(h,-16).ToInt64()+" ex="+GetWindowLongPtr(h,-20).ToInt64()+
        " visible="+IsWindowVisible(h)+" iconic="+IsIconic(h)+" cloak="+cloak+" rect="+r.left+","+r.top+","+r.right+","+r.bottom);
    }
    return lines.ToArray();
  }
}
'@
