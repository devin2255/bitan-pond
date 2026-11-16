"use strict";
// WScript.Shell reads some shortcut paths through the Windows ANSI code page.
// Query IShellLinkW directly so Chinese names are verified on English Windows too.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const script = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;
[ComImport, Guid("00021401-0000-0000-C000-000000000046")]
public class TangliShellLink {}
[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("000214F9-0000-0000-C000-000000000046")]
public interface ITangliShellLinkW {
  void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int length, IntPtr findData, uint flags);
}
public static class TangliShortcutReader {
  public static string Read(string shortcut) {
    var link = (ITangliShellLinkW)new TangliShellLink();
    ((IPersistFile)link).Load(shortcut, 0);
    var result = new StringBuilder(32768);
    link.GetPath(result, result.Capacity, IntPtr.Zero, 0);
    return result.ToString();
  }
}
'@
$target = [TangliShortcutReader]::Read($env:TANGLI_SHORTCUT_LINK)
[IO.File]::WriteAllText($env:TANGLI_SHORTCUT_RESULT, $target, (New-Object System.Text.UTF8Encoding($false)))
`;

function readShortcutTarget(shortcut, scratch) {
  const output = path.join(scratch, "shortcut-target-" + crypto.randomBytes(8).toString("hex") + ".txt");
  const ps = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const result = spawnSync(ps, ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], {
    windowsHide: true, encoding: "utf8", timeout: 30000,
    env: { ...process.env, TANGLI_SHORTCUT_LINK: shortcut, TANGLI_SHORTCUT_RESULT: output },
  });
  try {
    if (result.error || result.status !== 0 || !fs.existsSync(output)) {
      throw new Error("无法读取 Windows 快捷方式：" + (result.error?.message || result.stderr || result.status));
    }
    const target = fs.readFileSync(output, "utf8").trim();
    if (!target) throw new Error("Windows 快捷方式没有目标");
    return target;
  } finally { try { fs.unlinkSync(output); } catch (_) { /* The caller owns the scratch folder. */ } }
}
module.exports = { readShortcutTarget };
