const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

for (const [description, file] of [
  ["raised desktop keeps both windows between icons and wallpaper", "raised-desktop-smoke.ps1"],
  ["desktop input recognizes nested shell windows and ignores hidden icons", "desk-input-smoke.ps1"],
]) {
  test(description, { skip: process.platform !== "win32", timeout: 30000 }, () => {
    const ps = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const result = spawnSync(ps, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "..", "tools", file)],
      { windowsHide: true, timeout: 25000, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout);
    assert.match(result.stdout, /^OK /);
  });
}
