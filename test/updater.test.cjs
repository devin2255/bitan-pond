"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { compareVersions, parseRelease, checkForUpdate, downloadUpdate, RELEASE_API } = require("../updater");

const contents = Buffer.from("MZ test release executable");
const digest = (data) => crypto.createHash("sha256").update(data).digest("hex");
function release(version = "1.2.0", data = contents) {
  const tag = `v${version}`, name = `Tangli-v${version}-Windows-x64.exe`;
  return { tag_name: tag, draft: false, prerelease: false, body: "Release notes", assets: [{
    name, state: "uploaded", size: data.length, digest: `sha256:${digest(data)}`,
    browser_download_url: `https://github.com/devin2255/bitan-pond/releases/download/${tag}/${name}`,
  }] };
}
async function tempRoot(t) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tangli-updater-test-"));
  t.after(async () => {
    // Only delete files and directories created in this named test directory.
    for (const entry of await fs.promises.readdir(root, { withFileTypes: true })) {
      const item = path.join(root, entry.name);
      if (entry.isDirectory()) {
        for (const file of await fs.promises.readdir(item)) await fs.promises.unlink(path.join(item, file)).catch(() => {});
        await fs.promises.rmdir(item).catch(() => {});
      } else await fs.promises.unlink(item).catch(() => {});
    }
    await fs.promises.rmdir(root).catch(() => {});
  });
  return root;
}

test("compares stable numeric versions and never offers a downgrade", () => {
  assert.equal(compareVersions("v1.10.0", "1.2.9"), 1);
  assert.equal(compareVersions("1.2.0", "v1.2.0"), 0);
  assert.equal(parseRelease(release("1.2.0"), "1.2.0"), null);
  assert.equal(parseRelease(release("1.2.0"), "2.0.0"), null);
  assert.throws(() => compareVersions("v1.2.0-beta", "1.2.0"));
});

test("accepts only the expected official release and a verified digest", () => {
  const item = parseRelease(release(), "1.0.0");
  assert.equal(item.version, "1.2.0");
  assert.equal(item.sha256, digest(contents));
  const hostile = release(); hostile.assets[0].browser_download_url = "https://example.com/update.exe";
  assert.throws(() => parseRelease(hostile, "1.0.0"), /官方发行版/);
  const missingDigest = release(); missingDigest.assets[0].digest = null;
  assert.throws(() => parseRelease(missingDigest, "1.0.0"), /SHA-256/);
  const draft = release(); draft.draft = true;
  assert.throws(() => parseRelease(draft, "1.0.0"), /正式版本/);
});

test("fetches official release metadata and reports a failed request", async () => {
  const found = await checkForUpdate(async (url) => {
    assert.equal(url, RELEASE_API);
    return new Response(JSON.stringify(release()), { status: 200 });
  }, "1.0.0");
  assert.equal(found.version, "1.2.0");
  await assert.rejects(checkForUpdate(async () => new Response("", { status: 503 }), "1.0.0"), /503/);
});

test("streams and verifies the executable before returning it", async (t) => {
  const root = await tempRoot(t), progress = [];
  const item = parseRelease(release(), "1.0.0");
  const result = await downloadUpdate(async () => new Response(contents, { headers: { "content-length": String(contents.length) } }), item,
    { tempRoot: root, onProgress: (value) => progress.push(value) });
  assert.deepEqual(await fs.promises.readFile(result.file), contents);
  assert.equal(result.sha256, digest(contents));
  assert.equal(progress.at(-1), 100);
});

test("removes incomplete or altered downloads and preserves the existing app", async (t) => {
  const root = await tempRoot(t), item = parseRelease(release(), "1.0.0");
  const original = path.join(root, "existing.exe");
  await fs.promises.writeFile(original, "original");
  await assert.rejects(downloadUpdate(async () => new Response(Buffer.from("MZ altered executable!!")), item, { tempRoot: root }), /校验失败/);
  assert.equal(await fs.promises.readFile(original, "utf8"), "original");
  assert.deepEqual(await fs.promises.readdir(root), ["existing.exe"]);
});

test("rejects data that is not an executable even when its hash matches", async (t) => {
  const root = await tempRoot(t), html = Buffer.from("<html>not an executable</html>");
  const item = parseRelease(release("1.2.0", html), "1.0.0");
  await assert.rejects(downloadUpdate(async () => new Response(html), item, { tempRoot: root }), /Windows 程序/);
  assert.deepEqual(await fs.promises.readdir(root), []);
});

test("portable replacement keeps the old file when validation fails", { skip: process.platform !== "win32" }, async (t) => {
  const root = await tempRoot(t), source = path.join(root, "new.exe"), target = path.join(root, "old.exe");
  await fs.promises.writeFile(source, contents);
  await fs.promises.writeFile(target, "old version");
  const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const helper = path.resolve(__dirname, "..", "portable-update.ps1");
  const args = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", helper,
    "-ParentId", "2147483647", "-Source", source, "-Target", target, "-Sha256", "0".repeat(64), "-ReadyToken", "a".repeat(32), "-NoRestart"];
  const invalid = spawnSync(powershell, args, { windowsHide: true, timeout: 30000 });
  assert.equal(invalid.status, 1);
  assert.equal(await fs.promises.readFile(target, "utf8"), "old version");
  args[args.indexOf("-Sha256") + 1] = digest(contents);
  const valid = spawnSync(powershell, args, { windowsHide: true, timeout: 30000 });
  assert.equal(valid.status, 0, String(valid.stderr));
  assert.deepEqual(await fs.promises.readFile(target), contents);
  assert.deepEqual((await fs.promises.readdir(root)).sort(), ["new.exe", "old.exe"]);
});

test("portable update restarts the replacement and waits for its readiness signal", { skip: process.platform !== "win32" }, async (t) => {
  const root = await tempRoot(t), source = path.join(root, "new version.exe"), target = path.join(root, "current app.exe");
  const cs = path.join(root, "fake-app.cs");
  await fs.promises.writeFile(cs, `using System; using System.IO; class App { static void Main(string[] args) {
    foreach (var arg in args) if (arg.StartsWith("--tangli-update-ready=")) {
      var token=arg.Substring("--tangli-update-ready=".Length);
      File.WriteAllText(Path.Combine(Path.GetTempPath(), "tangli-update-ready-"+token+".ok"), "ready");
    }
  } }`);
  const system = process.env.SystemRoot || "C:\\Windows";
  const compiler = path.join(system, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
  if (!fs.existsSync(compiler)) return t.skip("Windows .NET compiler unavailable");
  const compilation = spawnSync(compiler, ["/nologo", `/out:${source}`, cs], { windowsHide: true, timeout: 30000 });
  assert.equal(compilation.status, 0, String(compilation.stderr));
  const expected = await fs.promises.readFile(source);
  await fs.promises.writeFile(target, "old version");
  const powershell = path.join(system, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const helper = path.resolve(__dirname, "..", "portable-update.ps1");
  const token = crypto.randomBytes(16).toString("hex");
  const result = spawnSync(powershell, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", helper,
    "-ParentId", "2147483647", "-Source", source, "-Target", target, "-Sha256", digest(expected), "-ReadyToken", token, "-NoUserInterface"],
  { windowsHide: true, timeout: 45000 });
  assert.equal(result.status, 0, String(result.stderr));
  assert.deepEqual(await fs.promises.readFile(target), expected);
  assert.equal(fs.existsSync(source), false);
  assert.equal(fs.existsSync(path.join(os.tmpdir(), `tangli-update-ready-${token}.ok`)), false);
  assert.equal((await fs.promises.readdir(root)).some((name) => name.startsWith(".tangli-previous-")), false);
});

test("failed restart restores the original executable", { skip: process.platform !== "win32" }, async (t) => {
  const root = await tempRoot(t), source = path.join(root, "bad.exe"), target = path.join(root, "current.exe");
  await fs.promises.writeFile(source, contents);
  await fs.promises.writeFile(target, "previous executable");
  const system = process.env.SystemRoot || "C:\\Windows";
  const powershell = path.join(system, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const helper = path.resolve(__dirname, "..", "portable-update.ps1");
  const result = spawnSync(powershell, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", helper,
    "-ParentId", "2147483647", "-Source", source, "-Target", target, "-Sha256", digest(contents), "-ReadyToken", "b".repeat(32), "-NoUserInterface"],
  { windowsHide: true, timeout: 30000 });
  assert.equal(result.status, 1);
  assert.equal(await fs.promises.readFile(target, "utf8"), "previous executable");
  assert.equal((await fs.promises.readdir(root)).some((name) => name.startsWith(".tangli-previous-")), false);
});
