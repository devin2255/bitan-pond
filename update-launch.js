"use strict";

const path = require("node:path");

function quotePowerShell(value) {
  const text = String(value);
  if (text.includes("\0")) throw new Error("更新参数无效");
  return "'" + text.replace(/'/g, "''") + "'";
}

// PowerShell can exit without executing a script when it is itself started as
// a detached Windows console process. A detached cmd process stays alive and
// waits for its PowerShell child, including after Electron has exited. All
// variable values live inside the encoded PowerShell command, not cmd syntax.
function createUpdaterLaunch(powershell, helper, parameters) {
  if (!path.isAbsolute(powershell) || !path.isAbsolute(helper) || /["\r\n\0]/.test(powershell)) throw new Error("更新助手路径无效");
  const args = Object.entries(parameters).map(([name, value]) => {
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name)) throw new Error("更新参数无效");
    if (value === true) return `-${name}`;
    if (value === false || value == null) return "";
    return `-${name} ${quotePowerShell(value)}`;
  }).filter(Boolean);
  const invocation = `& ${quotePowerShell(helper)} ${args.join(" ")}`;
  const encoded = Buffer.from(invocation, "utf16le").toString("base64");
  const command = `""%TANGLI_UPDATER_POWERSHELL%" -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encoded}"`;
  return {
    executable: path.join(process.env.SystemRoot || "C:\\Windows", "System32", "cmd.exe"),
    args: ["/d", "/v:off", "/s", "/c", command],
    env: { ...process.env, TANGLI_UPDATER_POWERSHELL: powershell },
  };
}

module.exports = { createUpdaterLaunch };
