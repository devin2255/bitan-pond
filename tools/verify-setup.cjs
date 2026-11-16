"use strict";
// Exercise the actual setup in an isolated per-test directory and registry key.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

async function hash(file) {
  const digest = crypto.createHash("sha256");
  for await (const data of fs.createReadStream(file)) digest.update(data);
  return digest.digest("hex");
}

async function verifySetup(setup, portable) {
  if (process.platform !== "win32") throw new Error("安装包验证需要 Windows");
  setup = path.resolve(setup); portable = path.resolve(portable);
  const tempBase = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(tempBase, "tangli setup verify "));
  const isolated = path.join(root, "安装 测试"), install = path.join(isolated, "程序 目录");
  const id = crypto.randomBytes(16).toString("hex");
  const flags = ["/S", '/TANGLI_TEST_ROOT="' + isolated + '"', "/TANGLI_TEST_ID=" + id];
  const link = path.join(isolated, "Programs", "塘里", "塘里.lnk");
  const installed = path.join(install, "塘里.exe"), uninstaller = path.join(install, "卸载塘里.exe");
  const run = (file, args) => spawnSync(file, args, {
    windowsHide: true, windowsVerbatimArguments: true, timeout: 120000, encoding: "utf8",
  });
  let removedSuccessfully = false;
  try {
    const result = run(setup, [...flags, "/D=" + install]);
    if (result.error || result.status !== 0) throw new Error("安装包无法完成安装");
    if (!fs.existsSync(link) || !fs.existsSync(uninstaller) || !fs.existsSync(path.join(install, "tangli-install.marker"))) {
      throw new Error("安装包缺少开始菜单入口或卸载程序");
    }
    if (await hash(installed) !== await hash(portable)) throw new Error("安装包内的程序与发布程序不一致");
    const ps = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const query = spawnSync(ps, ["-NoProfile", "-NonInteractive", "-Command",
      "$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:TANGLI_TEST_LINK); [Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $s.TargetPath"],
    { windowsHide: true, encoding: "utf8", env: { ...process.env, TANGLI_TEST_LINK: link } });
    if (query.status !== 0 || query.stdout.trim().toLowerCase() !== installed.toLowerCase()) throw new Error("开始菜单快捷方式无效");
    const keep = path.join(install, "user data.txt");
    fs.writeFileSync(keep, "keep");
    const removed = run(uninstaller, flags);
    if (removed.error || removed.status !== 0) throw new Error("卸载程序无法运行");
    for (let i = 0; i < 80 && fs.existsSync(link); i++) await new Promise((resolve) => setTimeout(resolve, 100));
    if (fs.existsSync(link) || fs.existsSync(installed) || !fs.existsSync(keep)) throw new Error("卸载没有正确保留用户文件");
    const registry = spawnSync("reg.exe", ["query", "HKCU\\Software\\TangliDesktopPondSmoke\\" + id + "\\Uninstall"], { windowsHide: true });
    if (registry.status === 0) throw new Error("卸载项未清理");
    removedSuccessfully = true;
    return { ok: true, sha256: await hash(portable) };
  } finally {
    if (!removedSuccessfully && fs.existsSync(uninstaller)) run(uninstaller, flags);
    if (fs.existsSync(root)) {
      const resolved = fs.realpathSync(root);
      if (resolved.startsWith(tempBase + path.sep) && path.basename(resolved).startsWith("tangli setup verify ")) {
        fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
      }
    }
  }
}

if (require.main === module) {
  const [setup, portable] = process.argv.slice(2);
  if (!setup || !portable) { console.error("用法：node tools/verify-setup.cjs <安装包> <便携版>"); process.exitCode = 1; }
  else verifySetup(setup, portable).then((result) => console.log(JSON.stringify(result)))
    .catch((error) => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { verifySetup };
