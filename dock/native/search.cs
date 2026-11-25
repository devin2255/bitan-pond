using System;
using System.Collections;
using System.Collections.Generic;
using System.Data.OleDb;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

internal sealed class SearchRow
{
    public string target { get; set; }
    public string name { get; set; }
    public string kind { get; set; }
    public string source { get; set; }
    public string type { get; set; }
    public string executable { get; set; }
}

internal static class SearchProviders
{
    internal static object Execute(Dictionary<string, object> request)
    {
        string command = Convert.ToString(request["command"]);
        if (command == "apps") return ApplicationList();
        if (command == "drives") return Drives();
        string root = Convert.ToString(request["root"]);
        string extension = Convert.ToString(request["extension"]);
        string category = Convert.ToString(request["category"]);
        var terms = new List<string>();
        foreach (object term in (IEnumerable)request["terms"]) terms.Add(Convert.ToString(term));
        if (command == "everything")
        {
            using (var window = new EverythingQuery())
            {
                return window.Search(terms, root, extension, category);
            }
        }
        if (command == "windows-search") return WindowsSearch(terms, root, extension, category);
        throw new ArgumentException("未知的搜索来源");
    }

    private static object Drives()
    {
        var result = new List<object>();
        foreach (DriveInfo drive in DriveInfo.GetDrives())
        {
            if (drive.DriveType != DriveType.Fixed && drive.DriveType != DriveType.Removable) continue;
            try
            {
                if (drive.IsReady) result.Add(new { root = drive.Name, label = drive.VolumeLabel });
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
        return result;
    }

    private static object ApplicationList()
    {
        object shell = null, folder = null, items = null;
        var result = new List<SearchRow>();
        try
        {
            shell = Activator.CreateInstance(Type.GetTypeFromProgID("Shell.Application"));
            folder = ((dynamic)shell).NameSpace("shell:AppsFolder");
            if (folder == null) return result;
            items = ((dynamic)folder).Items();
            foreach (object raw in (IEnumerable)items)
            {
                try
                {
                    dynamic item = raw;
                    string name = Convert.ToString(item.Name);
                    string target = Convert.ToString(item.Path);
                    if (String.IsNullOrWhiteSpace(name) || String.IsNullOrWhiteSpace(target)) continue;
                    string type = Path.IsPathRooted(target) ? "path" : "app";
                    string executable = "";
                    if (type == "app" && !target.Contains("!"))
                    {
                        try { executable = Convert.ToString(item.ExtendedProperty("System.Link.TargetParsingPath")); }
                        catch (COMException) { }
                    }
                    result.Add(new SearchRow { target = target, name = name, kind = "app", source = "开始菜单",
                        type = type, executable = executable });
                }
                catch (COMException) { }
                finally { Release(raw); }
            }
        }
        catch (COMException) { }
        finally { Release(items); Release(folder); Release(shell); }
        return result;
    }

    private static void Release(object item)
    {
        if (item != null && Marshal.IsComObject(item)) Marshal.ReleaseComObject(item);
    }

    private static string Sql(string value)
    {
        return "'" + value.Replace("'", "''") + "'";
    }

    private static string Pattern(string value)
    {
        return value.Replace("[", "[[]").Replace("%", "[%]").Replace("_", "[_]");
    }

    private static object WindowsSearch(List<string> terms, string root, string extension, string category)
    {
        var rows = new List<SearchRow>();
        using (var connection = new OleDbConnection("Provider=Search.CollatorDSO;Extended Properties='Application=Windows'"))
        {
            try { connection.Open(); }
            catch (OleDbException) { return new { available = false, rows = rows }; }
            var restrictions = new List<string> { "System.ItemUrl LIKE 'file:%'" };
            foreach (string term in terms)
                restrictions.Add("System.ItemPathDisplay LIKE " + Sql("%" + Pattern(term) + "%"));
            if (root.Length > 0) restrictions.Add("System.ItemPathDisplay LIKE " + Sql(root + "%"));
            if (extension.Length > 0) restrictions.Add("System.ItemName LIKE " + Sql("%" + Pattern(extension)));
            string query = "SELECT TOP 180 System.ItemPathDisplay, System.ItemName, System.FileAttributes FROM SystemIndex WHERE "
                + String.Join(" AND ", restrictions);
            using (var command = new OleDbCommand(query, connection) { CommandTimeout = 2 })
            using (OleDbDataReader reader = command.ExecuteReader())
            {
                while (reader.Read())
                {
                    string target = Convert.ToString(reader[0], CultureInfo.InvariantCulture);
                    if (!Path.IsPathRooted(target)) continue;
                    bool folder = !reader.IsDBNull(2) && (Convert.ToUInt32(reader[2]) & (uint)FileAttributes.Directory) != 0;
                    string kind = folder ? "folder" : "file";
                    if (category != "all" && category != kind) continue;
                    rows.Add(new SearchRow { target = target, name = Convert.ToString(reader[1]), kind = kind, source = "Windows 索引" });
                }
            }
        }
        return new { available = true, rows = rows };
    }
}

internal sealed class EverythingQuery : NativeWindow, IDisposable
{
    private const string ClassPrefix = "EVERYTHING_TASKBAR_NOTIFICATION";
    private const int Reply = 0x544C;
    private readonly List<SearchRow> rows = new List<SearchRow>();
    private IntPtr server;
    private bool received;

    internal object Search(List<string> terms, string root, string extension, string category)
    {
        server = DesktopApi.FindWindow(ClassPrefix, null);
        if (server == IntPtr.Zero)
        {
            DesktopApi.EnumWindows(delegate(IntPtr hwnd, IntPtr data)
            {
                if (!DesktopApi.ClassName(hwnd).StartsWith(ClassPrefix + "_", StringComparison.Ordinal)) return true;
                server = hwnd;
                return false;
            }, IntPtr.Zero);
        }
        if (server == IntPtr.Zero) return new { available = false, rows = rows };
        CreateHandle(new CreateParams { Caption = "Tangli local file search" });

        var words = new List<string>();
        foreach (string term in terms) words.Add("\"" + term.Replace("\"", "") + "\"");
        if (root.Length > 0) words.Add("path:\"" + root + "\"");
        if (extension.Length > 0) words.Add("ext:" + extension.TrimStart('.'));
        if (category == "file") words.Add("file:");
        else if (category == "folder") words.Add("folder:");
        byte[] search = Encoding.Unicode.GetBytes(String.Join(" ", words) + "\0");
        byte[] query = new byte[20 + search.Length];
        Buffer.BlockCopy(BitConverter.GetBytes(unchecked((int)Handle.ToInt64())), 0, query, 0, 4);
        Buffer.BlockCopy(BitConverter.GetBytes(Reply), 0, query, 4, 4);
        Buffer.BlockCopy(BitConverter.GetBytes(4), 0, query, 8, 4);
        Buffer.BlockCopy(BitConverter.GetBytes(180), 0, query, 16, 4);
        Buffer.BlockCopy(search, 0, query, 20, search.Length);
        var memory = GCHandle.Alloc(query, GCHandleType.Pinned);
        try
        {
            var data = new DesktopApi.CopyData { Type = new IntPtr(2), Size = query.Length, Bytes = memory.AddrOfPinnedObject() };
            IntPtr result;
            if (DesktopApi.SendMessageTimeout(server, DesktopApi.WmCopyData, Handle, ref data, 2, 300, out result) == IntPtr.Zero
                || result == IntPtr.Zero) return new { available = false, rows = rows };
        }
        finally { memory.Free(); }
        Stopwatch timer = Stopwatch.StartNew();
        while (!received && timer.ElapsedMilliseconds < 900)
        {
            Application.DoEvents();
            if (!received) Thread.Sleep(10);
        }
        return new { available = received, rows = rows };
    }

    protected override void WndProc(ref Message message)
    {
        if (message.Msg == DesktopApi.WmCopyData && message.WParam == server && message.LParam != IntPtr.Zero)
        {
            var data = (DesktopApi.CopyData)Marshal.PtrToStructure(message.LParam, typeof(DesktopApi.CopyData));
            if (data.Type.ToInt64() == Reply && data.Size >= 28 && data.Size <= 4 * 1024 * 1024)
            {
                var bytes = new byte[data.Size];
                Marshal.Copy(data.Bytes, bytes, 0, bytes.Length);
                int count = Math.Min(180, Math.Min(BitConverter.ToInt32(bytes, 20), (bytes.Length - 28) / 12));
                for (int i = 0; i < count; i++)
                {
                    int offset = 28 + i * 12;
                    int flags = BitConverter.ToInt32(bytes, offset);
                    string name = ReadUnicode(bytes, BitConverter.ToInt32(bytes, offset + 4));
                    string path = ReadUnicode(bytes, BitConverter.ToInt32(bytes, offset + 8));
                    if (name.Length == 0 || (flags & 2) != 0 || !Path.IsPathRooted(path)) continue;
                    try
                    {
                        rows.Add(new SearchRow { target = Path.Combine(path, name), name = name,
                            kind = (flags & 1) != 0 ? "folder" : "file", source = "Everything" });
                    }
                    catch (ArgumentException) { }
                }
                received = true;
                message.Result = new IntPtr(1);
                return;
            }
        }
        base.WndProc(ref message);
    }

    private static string ReadUnicode(byte[] bytes, int offset)
    {
        if (offset < 28 || offset >= bytes.Length - 1) return "";
        int end = offset;
        while (end + 1 < bytes.Length && (bytes[end] != 0 || bytes[end + 1] != 0)) end += 2;
        return Encoding.Unicode.GetString(bytes, offset, end - offset);
    }

    public void Dispose() { if (Handle != IntPtr.Zero) DestroyHandle(); }
}
