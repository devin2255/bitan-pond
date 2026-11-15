"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { compareVersions, parseRelease, parseDomesticRelease, checkForUpdate, downloadUpdate, RELEASE_API } = require("../updater");

const contents = Buffer.from("MZ test release executable");
const digest = (data) => crypto.createHash("sha256").update(data).digest("hex");
function release(version = "1.2.0", data = contents) {
  const tag = `v${version}`, name = `Tangli-v${version}-Windows-x64.exe`;
  return { tag_name: tag, draft: false, prerelease: false, body: "Release notes", assets: [{
    name, state: "uploaded", size: data.length, digest: `sha256:${digest(data)}`,
    browser_download_url: `https://github.com/devin2255/bitan-pond/releases/download/${tag}/${name}`,
  }] };
}
function domesticFixture(version = "1.2.0") {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const channel = { feedUrl: "https://mirror.example.com/latest.json", publicKey: publicKey.export({ type: "spki", format: "pem" }) };
  const buffers = [contents.subarray(0, 8), contents.subarray(8)];
  const manifest = { format: 1, version, name: `Tangli-v${version}-Windows-x64.exe`, size: contents.length,
    sha256: digest(contents), notes: "Domestic release", parts: buffers.map((part, index) => ({
      url: `https://mirror.example.com/v${version}/part-${index + 1}`, size: part.length, sha256: digest(part),
    })) };
  const sign = (value) => {
    const payload = Buffer.from(JSON.stringify(value));
    return { format: 1, payload: payload.toString("base64"), signature: crypto.sign(null, payload, privateKey).toString("base64") };
  };
  return { channel, buffers, manifest, sign, envelope: sign(manifest) };
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
  }, "1.0.0", 2000, null);
  assert.equal(found.version, "1.2.0");
  await assert.rejects(checkForUpdate(async () => new Response("", { status: 503 }), "1.0.0", 2000, null), /503/);
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

test("uses a signed domestic feed and downloads its parts when GitHub is unavailable", async (t) => {
  const root = await tempRoot(t), fixture = domesticFixture(), calls = [], progress = [];
  const fetch = async (url) => {
    calls.push(url);
    if (url === fixture.channel.feedUrl) return new Response(JSON.stringify(fixture.envelope));
    if (url === RELEASE_API || url.startsWith("https://github.com/")) throw new Error("GitHub unreachable");
    const index = fixture.manifest.parts.findIndex((part) => part.url === url);
    assert.notEqual(index, -1);
    return new Response(fixture.buffers[index]);
  };
  const item = await checkForUpdate(fetch, "1.0.0", 2000, fixture.channel);
  assert.equal(item.version, "1.2.0");
  const result = await downloadUpdate(fetch, item, { channel: fixture.channel, tempRoot: root, onProgress: (n) => progress.push(n) });
  assert.deepEqual(await fs.promises.readFile(result.file), contents);
  assert.equal(progress.at(-1), 100);
  assert.equal(calls.filter((url) => url.includes("part-")).length, 2);
  assert.equal(calls.some((url) => url.startsWith("https://github.com/")), false);
});

test("finds the update through the second feed when the first feed and GitHub are unavailable", async () => {
  const fixture = domesticFixture();
  const channel = { ...fixture.channel, feedUrls: ["https://offline.example.com/latest.json", fixture.channel.feedUrl] };
  const item = await checkForUpdate(async (url) => {
    if (url === fixture.channel.feedUrl) return new Response(JSON.stringify(fixture.envelope));
    throw new Error("offline");
  }, "1.0.0", 2000, channel);
  assert.equal(item.version, "1.2.0");
  assert.ok(item.parts);
});

test("rejects tampered or malformed signed metadata, then uses the official source", async () => {
  const fixture = domesticFixture(), altered = { ...fixture.manifest, size: fixture.manifest.size + 1 };
  const tampered = { ...fixture.envelope, payload: Buffer.from(JSON.stringify(altered)).toString("base64") };
  assert.throws(() => parseDomesticRelease(tampered, "1.0.0", fixture.channel), /签名无效/);
  const invalidParts = fixture.sign({ ...fixture.manifest, parts: [{ ...fixture.manifest.parts[0], url: "http://mirror.example.com/unsafe" }] });
  assert.throws(() => parseDomesticRelease(invalidParts, "1.0.0", fixture.channel), /地址无效/);
  const item = await checkForUpdate(async (url) => url === RELEASE_API ?
    new Response(JSON.stringify(release())) : new Response(JSON.stringify(tampered)), "1.0.0", 2000, fixture.channel);
  assert.equal(item.version, "1.2.0");
  assert.equal(item.parts, undefined);
});

test("prefers the newest valid version and prefers the domestic parts for matching versions", async () => {
  const fixture = domesticFixture();
  const check = (githubVersion) => checkForUpdate(async (url) => new Response(JSON.stringify(
    url === RELEASE_API ? release(githubVersion) : fixture.envelope)), "1.0.0", 2000, fixture.channel);
  assert.ok((await check("1.2.0")).parts);
  const newer = await check("1.3.0");
  assert.equal(newer.version, "1.3.0");
  assert.equal(newer.parts, undefined);
});

test("restarts a corrupted domestic download from the verified GitHub package", async (t) => {
  const root = await tempRoot(t), fixture = domesticFixture(), attempts = [];
  const item = parseDomesticRelease(fixture.envelope, "1.0.0", fixture.channel);
  const result = await downloadUpdate(async (url) => {
    attempts.push(url);
    if (url.startsWith("https://github.com/")) return new Response(contents);
    return new Response(Buffer.alloc(fixture.buffers[0].length));
  }, item, { tempRoot: root, channel: fixture.channel });
  assert.deepEqual(await fs.promises.readFile(result.file), contents);
  assert.equal(attempts.at(-1), item.url);
});

test("falls back to a second signed mirror when the first is unavailable", async (t) => {
  const root = await tempRoot(t), fixture = domesticFixture(), calls = [];
  const parts = fixture.manifest.parts.map((part, index) => ({ size: part.size, sha256: part.sha256,
    urls: [part.url, `https://backup.example.com/part-${index + 1}`] }));
  const item = parseDomesticRelease(fixture.sign({ ...fixture.manifest, parts }), "1.0.0", fixture.channel);
  const result = await downloadUpdate(async (url) => {
    calls.push(url);
    if (url.startsWith("https://mirror.example.com/")) throw new Error("offline");
    const index = parts.findIndex((part) => part.urls[1] === url);
    assert.notEqual(index, -1);
    return new Response(fixture.buffers[index]);
  }, item, { tempRoot: root, channel: fixture.channel });
  assert.deepEqual(await fs.promises.readFile(result.file), contents);
  assert.equal(calls.filter((url) => url.startsWith("https://backup.example.com/")).length, 2);
});

test("keeps already verified parts when a later part must switch mirrors", async (t) => {
  const root = await tempRoot(t), fixture = domesticFixture(), calls = [];
  const parts = fixture.manifest.parts.map((part, index) => ({ size: part.size, sha256: part.sha256,
    urls: [part.url, `https://backup.example.com/part-${index + 1}`] }));
  const item = parseDomesticRelease(fixture.sign({ ...fixture.manifest, parts }), "1.0.0", fixture.channel);
  const result = await downloadUpdate(async (url) => {
    calls.push(url);
    if (url === parts[1].urls[0]) return new Response(Buffer.alloc(parts[1].size));
    const index = parts.findIndex((part) => part.urls.includes(url));
    assert.notEqual(index, -1);
    return new Response(fixture.buffers[index]);
  }, item, { tempRoot: root, channel: fixture.channel });
  assert.deepEqual(await fs.promises.readFile(result.file), contents);
  assert.deepEqual(calls, [parts[0].urls[0], parts[1].urls[0], parts[1].urls[1]]);
});

test("switches sources when a domestic download stalls", async (t) => {
  const root = await tempRoot(t), fixture = domesticFixture();
  const item = parseDomesticRelease(fixture.envelope, "1.0.0", fixture.channel);
  const keepAlive = setTimeout(() => {}, 1000);
  t.after(() => clearTimeout(keepAlive));
  const result = await downloadUpdate((url, options) => {
    if (url.startsWith("https://github.com/")) return Promise.resolve(new Response(contents));
    return new Promise((resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("mirror stalled")), { once: true }));
  }, item, { tempRoot: root, channel: fixture.channel, idleTimeout: 30 });
  assert.deepEqual(await fs.promises.readFile(result.file), contents);
});

test("cannot install a changed or unauthenticated domestic update", async (t) => {
  const root = await tempRoot(t), fixture = domesticFixture();
  const item = parseDomesticRelease(fixture.envelope, "1.0.0", fixture.channel);
  const tampered = { ...item, signedEnvelope: { ...item.signedEnvelope, signature: Buffer.alloc(64).toString("base64") } };
  await assert.rejects(downloadUpdate(async () => { throw new Error("must not download"); }, tampered,
    { tempRoot: root, channel: fixture.channel }), /签名无效/);
  await assert.rejects(downloadUpdate(async () => new Response(Buffer.alloc(1)), item,
    { tempRoot: root, channel: fixture.channel }), /校验失败/);
  assert.deepEqual(await fs.promises.readdir(root), []);
});

test("release preparation signs a complete manifest using an external private key", async (t) => {
  const root = await tempRoot(t), key = path.join(root, "private.pem"), executable = path.join(root, "release.exe");
  const output = path.join(root, "out"), tool = path.resolve(__dirname, "../tools/prepare-domestic-update.cjs");
  await fs.promises.writeFile(executable, contents);
  const generated = spawnSync(process.execPath, [tool, "keygen", key], { encoding: "utf8" });
  assert.equal(generated.status, 0, generated.stderr);
  const privateKey = crypto.createPrivateKey(await fs.promises.readFile(key));
  const channel = { publicKey: crypto.createPublicKey(privateKey).export({ type: "spki", format: "pem" }) };
  const channelFile = path.join(root, "channel.json");
  await fs.promises.writeFile(channelFile, JSON.stringify({ domestic: channel }));
  const prepared = spawnSync(process.execPath, [tool, "build", executable, "1.2.0", "https://mirror.example.com/v1.2.0", output, key, "", channelFile], { encoding: "utf8" });
  assert.equal(prepared.status, 0, prepared.stderr);
  const envelope = JSON.parse(await fs.promises.readFile(path.join(output, "latest.json"), "utf8"));
  const item = parseDomesticRelease(envelope, "1.0.0", channel);
  assert.equal(item.sha256, digest(contents));
  assert.deepEqual(await fs.promises.readFile(path.join(output, path.basename(new URL(item.parts[0].urls[0]).pathname))), contents);
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
