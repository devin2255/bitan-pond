const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { buildSetup } = require("../tools/build-setup.cjs");

test("Windows setup creates a searchable shortcut and uninstalls without removing user files",
  { skip: process.platform !== "win32", timeout: 180000 }, async (t) => {
    const tempBase = fs.realpathSync(os.tmpdir());
    const root = fs.mkdtempSync(path.join(tempBase, "tangli setup test "));
    const isolated = path.join(root, "池塘 测试");
    const install = path.join(isolated, "程序 目录");
    const id = crypto.randomBytes(16).toString("hex");
    const source = path.join(root, "fake.cs"), portable = path.join(root, "portable.exe");
    const setup = path.join(root, "Tangli-v1.2.0-Setup.exe");
    const uninstaller = path.join(install, "卸载塘里.exe");
    const link = path.join(isolated, "Programs", "塘里", "塘里.lnk");
    const flags = ["/S", '/TANGLI_TEST_ROOT="' + isolated + '"', "/TANGLI_TEST_ID=" + id];
    const run = (file, args, timeout = 60000) => spawnSync(file, args, {
      windowsHide: true, windowsVerbatimArguments: true, timeout, encoding: "utf8",
    });
    t.after(() => {
      if (fs.existsSync(uninstaller)) run(uninstaller, flags);
      if (fs.existsSync(root)) {
        const resolved = fs.realpathSync(root);
        if (resolved.startsWith(tempBase + path.sep) && path.basename(resolved).startsWith("tangli setup test ")) {
          fs.rmSync(resolved, { recursive: true, force: true });
        }
      }
    });
    fs.writeFileSync(source, "class P { static void Main() {} }");
    const csc = path.join(process.env.SystemRoot || "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
    const compiled = spawnSync(csc, ["/nologo", "/target:winexe", "/out:" + portable, source], { windowsHide: true, encoding: "utf8" });
    assert.equal(compiled.status, 0, compiled.stderr);
    await buildSetup(portable, setup, "1.2.0");
    const installed = run(setup, [...flags, "/D=" + install]);
    assert.equal(installed.status, 0, installed.stderr);
    assert.deepEqual(fs.readFileSync(path.join(install, "塘里.exe")), fs.readFileSync(portable));
    assert(fs.existsSync(path.join(install, "tangli-install.marker")));
    assert(fs.existsSync(link));
    const ps = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const query = spawnSync(ps, ["-NoProfile", "-NonInteractive", "-Command",
      "$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:TANGLI_TEST_LINK); [Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $s.TargetPath"],
    { windowsHide: true, encoding: "utf8", env: { ...process.env, TANGLI_TEST_LINK: link } });
    assert.equal(query.status, 0, query.stderr);
    assert.equal(query.stdout.trim().toLowerCase(), path.join(install, "塘里.exe").toLowerCase());
    const backup = path.join(install, ".tangli-install-previous.exe");
    fs.writeFileSync(backup, "preserve backup");
    const blocked = run(setup, [...flags, "/D=" + install]);
    assert.notEqual(blocked.status, 0);
    assert.equal(fs.readFileSync(backup, "utf8"), "preserve backup");
    assert.deepEqual(fs.readFileSync(path.join(install, "塘里.exe")), fs.readFileSync(portable));
    fs.unlinkSync(backup);
    const keep = path.join(install, "user file.txt");
    fs.writeFileSync(keep, "preserve user data");
    const removed = run(uninstaller, flags);
    assert.equal(removed.status, 0, removed.stderr);
    // NSIS starts its uninstaller from a temporary copy before removing itself.
    for (let i = 0; i < 50 && fs.existsSync(link); i++) await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(fs.readFileSync(keep, "utf8"), "preserve user data");
    assert.equal(fs.existsSync(link), false);
    assert.equal(fs.existsSync(path.join(install, "塘里.exe")), false);
    const registry = spawnSync("reg.exe", ["query", "HKCU\\Software\\TangliDesktopPondSmoke\\" + id + "\\Uninstall"], { windowsHide: true });
    assert.notEqual(registry.status, 0);
  });
