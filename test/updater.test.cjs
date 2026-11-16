"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { compareVersions, parseDomesticRelease, checkForUpdate, downloadUpdate } = require("../updater");
const { createSettings, partURLs } = require("../update-settings");
const { verifyPrepared } = require("../tools/verify-update-release.cjs");
const { inspectAssets } = require("../tools/publish-update-release.cjs");

const contents = Buffer.from("MZ test release executable");
const digest = (data) => crypto.createHash("sha256").update(data).digest("hex");
function domesticFixture(version = "1.2.0", data = contents) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const channel = { feedUrl: "https://mirror.example.com/latest.json", publicKey: publicKey.export({ type: "spki", format: "pem" }) };
  const buffers = [data.subarray(0, 8), data.subarray(8)];
  const manifest = { format: 1, version, name: `Tangli-v${version}-Windows-x64.exe`, size: data.length,
    sha256: digest(data), notes: "Domestic release", parts: buffers.map((part, index) => ({
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

test("derives all endpoints and release part URLs from one validated configuration", () => {
  const fixture = domesticFixture();
  const config = { repository: "https://github.com/example/pond", legacyBranch: "main", legacyPath: "latest.json",
    mirrors: ["https://mirror.example.com", "https://backup.example.com"], publicKey: fixture.channel.publicKey };
  const settings = createSettings(config);
  assert.deepEqual(settings.feedUrls, [
    "https://github.com/example/pond/releases/latest/download/latest.json",
    "https://mirror.example.com/https://github.com/example/pond/releases/latest/download/latest.json",
    "https://backup.example.com/https://github.com/example/pond/releases/latest/download/latest.json",
    "https://mirror.example.com/https://raw.githubusercontent.com/example/pond/main/latest.json",
    "https://backup.example.com/https://raw.githubusercontent.com/example/pond/main/latest.json",
    "https://raw.githubusercontent.com/example/pond/main/latest.json",
  ]);
  assert.deepEqual(partURLs(settings, "1.2.0", "part-001"), [
    "https://mirror.example.com/https://github.com/example/pond/releases/download/v1.2.0/part-001",
    "https://backup.example.com/https://github.com/example/pond/releases/download/v1.2.0/part-001",
  ]);
  assert.throws(() => createSettings({ ...config, mirrors: ["http://mirror.example.com"] }), /镜像地址无效/);
  assert.throws(() => createSettings({ ...config, mirrors: [config.mirrors[0], config.mirrors[0]] }), /重复/);
  assert.throws(() => createSettings({ ...config, legacyPath: "../other.json" }), /旧版/);
  assert.throws(() => createSettings({ ...config, publicKey: "invalid" }), /公钥/);
});

test("only accepts release assets whose names, sizes and hashes match", () => {
  const expected = [{ name: "latest.json", size: 3, sha256: "a".repeat(64) }, { name: "part-001", size: 5, sha256: "b".repeat(64) }];
  const valid = expected.map((item) => ({ ...item, state: "uploaded", digest: `sha256:${item.sha256}` }));
  assert.deepEqual(inspectAssets(valid, expected), []);
  assert.deepEqual(inspectAssets(valid.slice(0, 1), expected), [expected[1]]);
  assert.throws(() => inspectAssets([{ ...valid[0], digest: `sha256:${"0".repeat(64)}` }], expected), /不一致/);
  assert.throws(() => inspectAssets([...valid, { name: "unexpected" }], expected), /未预期/);
});

test("compares stable numeric versions and never offers a downgrade", () => {
  assert.equal(compareVersions("v1.10.0", "1.2.9"), 1);
  assert.equal(compareVersions("1.2.0", "v1.2.0"), 0);
  const fixture = domesticFixture();
  assert.equal(parseDomesticRelease(fixture.envelope, "1.2.0", fixture.channel), null);
  assert.equal(parseDomesticRelease(fixture.envelope, "2.0.0", fixture.channel), null);
  assert.throws(() => compareVersions("v1.2.0-beta", "1.2.0"));
});

test("requires a signed version and rejects relabelled old packages", () => {
  const fixture = domesticFixture();
  const item = parseDomesticRelease(fixture.envelope, "1.0.0", fixture.channel);
  assert.equal(item.version, "1.2.0");
  assert.equal(item.sha256, digest(contents));
  const altered = { ...fixture.manifest, version: "9.0.0", name: "Tangli-v9.0.0-Windows-x64.exe" };
  const tampered = { ...fixture.envelope, payload: Buffer.from(JSON.stringify(altered)).toString("base64") };
  assert.throws(() => parseDomesticRelease(tampered, "1.0.0", fixture.channel), /签名无效/);
});

test("requires a signed official feed and reports a failed request", async () => {
  const fixture = domesticFixture();
  const found = await checkForUpdate(async (url) => {
    assert.equal(url, fixture.channel.feedUrl);
    return new Response(JSON.stringify(fixture.envelope), { status: 200 });
  }, "1.0.0", 2000, fixture.channel);
  assert.equal(found.version, "1.2.0");
  await assert.rejects(checkForUpdate(async () => new Response("", { status: 503 }), "1.0.0", 2000, fixture.channel), /503/);
  await assert.rejects(downloadUpdate(async () => { throw new Error("must not fetch"); }, { version: "1.2.0", sha256: digest(contents) }), /缺少项目签名/);
});

test("streams and verifies the executable before returning it", async (t) => {
  const root = await tempRoot(t), progress = [], fixture = domesticFixture();
  const item = parseDomesticRelease(fixture.envelope, "1.0.0", fixture.channel);
  const result = await downloadUpdate(async (url) => {
    const index = fixture.manifest.parts.findIndex((part) => part.url === url);
    assert.notEqual(index, -1);
    return new Response(fixture.buffers[index]);
  }, item, { tempRoot: root, channel: fixture.channel, onProgress: (value) => progress.push(value) });
  assert.deepEqual(await fs.promises.readFile(result.file), contents);
  assert.equal(result.sha256, digest(contents));
  assert.equal(progress.at(-1), 100);
});

test("removes incomplete or altered downloads and preserves the existing app", async (t) => {
  const root = await tempRoot(t), fixture = domesticFixture(), item = parseDomesticRelease(fixture.envelope, "1.0.0", fixture.channel);
  const original = path.join(root, "existing.exe");
  await fs.promises.writeFile(original, "original");
  await assert.rejects(downloadUpdate(async () => new Response(Buffer.from("MZ altered executable!!")), item, { tempRoot: root, channel: fixture.channel }), /校验失败|超过/);
  assert.equal(await fs.promises.readFile(original, "utf8"), "original");
  assert.deepEqual(await fs.promises.readdir(root), ["existing.exe"]);
});

test("rejects data that is not an executable even when its hash matches", async (t) => {
  const root = await tempRoot(t), html = Buffer.from("<html>not an executable</html>");
  const fixture = domesticFixture("1.2.0", html), item = parseDomesticRelease(fixture.envelope, "1.0.0", fixture.channel);
  await assert.rejects(downloadUpdate(async (url) => {
    if (url.startsWith("https://github.com/")) return new Response(html);
    return new Response(fixture.buffers[fixture.manifest.parts.findIndex((part) => part.url === url)]);
  }, item, { tempRoot: root, channel: fixture.channel }), /Windows 程序/);
  assert.deepEqual(await fs.promises.readdir(root), []);
});

test("uses a signed domestic feed and downloads its parts when GitHub is unavailable", async (t) => {
  const root = await tempRoot(t), fixture = domesticFixture(), calls = [], progress = [];
  const fetch = async (url) => {
    calls.push(url);
    if (url === fixture.channel.feedUrl) return new Response(JSON.stringify(fixture.envelope));
    if (url.startsWith("https://github.com/")) throw new Error("GitHub unreachable");
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

test("downloads signed parts concurrently and reconstructs them in the right order", async (t) => {
  const root = await tempRoot(t), fixture = domesticFixture(), started = [];
  const item = parseDomesticRelease(fixture.envelope, "1.0.0", fixture.channel);
  let releaseGate, overlap = false;
  const gate = new Promise((resolve) => { releaseGate = resolve; });
  const guard = setTimeout(() => releaseGate(), 250);
  t.after(() => clearTimeout(guard));
  const result = await downloadUpdate(async (url) => {
    started.push(url);
    if (started.length === fixture.buffers.length) { overlap = true; releaseGate(); }
    await gate;
    const index = fixture.manifest.parts.findIndex((part) => part.url === url);
    assert.notEqual(index, -1);
    return new Response(fixture.buffers[index]);
  }, item, { tempRoot: root, channel: fixture.channel });
  assert.equal(overlap, true, "parts did not overlap");
  assert.deepEqual(await fs.promises.readFile(result.file), contents);
});

test("cancels other part requests before falling back to the full package", async (t) => {
  const root = await tempRoot(t), fixture = domesticFixture();
  const item = parseDomesticRelease(fixture.envelope, "1.0.0", fixture.channel);
  let interrupted = false;
  const result = await downloadUpdate((url, options) => {
    if (url.startsWith("https://github.com/")) return Promise.resolve(new Response(contents));
    if (url === fixture.manifest.parts[0].url) return Promise.resolve(new Response(Buffer.alloc(fixture.buffers[0].length)));
    return new Promise((resolve, reject) => options.signal.addEventListener("abort", () => {
      interrupted = true; reject(new Error("cancelled"));
    }, { once: true }));
  }, item, { tempRoot: root, channel: fixture.channel, idleTimeout: 1000 });
  assert.equal(interrupted, true);
  assert.deepEqual(await fs.promises.readFile(result.file), contents);
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

test("times out a dead check endpoint and still accepts another signed feed", async (t) => {
  const fixture = domesticFixture(), channel = { ...fixture.channel,
    feedUrls: ["https://dead.example.com/latest.json", fixture.channel.feedUrl] };
  const keepAlive = setTimeout(() => {}, 1000);
  t.after(() => clearTimeout(keepAlive));
  const item = await checkForUpdate((url, options) => {
    if (url === fixture.channel.feedUrl) return Promise.resolve(new Response(JSON.stringify(fixture.envelope)));
    return new Promise((resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("timed out")), { once: true }));
  }, "1.0.0", 30, channel);
  assert.equal(item.version, "1.2.0");
});

test("allows a slow transfer that keeps making progress beyond the idle interval", async (t) => {
  const root = await tempRoot(t), fixture = domesticFixture();
  const manifest = { ...fixture.manifest, parts: [{ url: "https://mirror.example.com/slow", size: contents.length, sha256: digest(contents) }] };
  const item = parseDomesticRelease(fixture.sign(manifest), "1.0.0", fixture.channel);
  const result = await downloadUpdate(async () => {
    let offset = 0, interval;
    return new Response(new ReadableStream({
      start(controller) {
        interval = setInterval(() => {
          if (offset >= contents.length) { clearInterval(interval); controller.close(); return; }
          const next = Math.min(contents.length, offset + 4);
          controller.enqueue(contents.subarray(offset, next)); offset = next;
        }, 20);
      },
      cancel() { clearInterval(interval); },
    }));
  }, item, { tempRoot: root, channel: fixture.channel, idleTimeout: 70 });
  assert.deepEqual(await fs.promises.readFile(result.file), contents);
});

test("rejects tampered metadata from one source and uses a valid signed source", async () => {
  const fixture = domesticFixture(), altered = { ...fixture.manifest, size: fixture.manifest.size + 1 };
  const tampered = { ...fixture.envelope, payload: Buffer.from(JSON.stringify(altered)).toString("base64") };
  assert.throws(() => parseDomesticRelease(tampered, "1.0.0", fixture.channel), /签名无效/);
  const invalidParts = fixture.sign({ ...fixture.manifest, parts: [{ ...fixture.manifest.parts[0], url: "http://mirror.example.com/unsafe" }] });
  assert.throws(() => parseDomesticRelease(invalidParts, "1.0.0", fixture.channel), /地址无效/);
  const channel = { ...fixture.channel, feedUrls: ["https://official.example.com/latest.json", fixture.channel.feedUrl] };
  const item = await checkForUpdate(async (url) => url === fixture.channel.feedUrl ?
    new Response(JSON.stringify(fixture.envelope)) : new Response(JSON.stringify(tampered)), "1.0.0", 2000, channel);
  assert.equal(item.version, "1.2.0");
  assert.ok(item.parts);
});

test("chooses the newest signed version across concurrent sources", async () => {
  const fixture = domesticFixture();
  const channel = { ...fixture.channel, feedUrls: ["https://official.example.com/latest.json", fixture.channel.feedUrl] };
  const newerManifest = { ...fixture.manifest, version: "1.3.0", name: "Tangli-v1.3.0-Windows-x64.exe" };
  const newer = await checkForUpdate(async (url) => new Response(JSON.stringify(
    url === fixture.channel.feedUrl ? fixture.envelope : fixture.sign(newerManifest))), "1.0.0", 2000, channel);
  assert.equal(newer.version, "1.3.0");
  assert.ok(newer.parts);
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
  const root = await tempRoot(t), key = path.join(root, "private.pem"), executable = path.join(root, "Tangli-v1.2.0-Windows-x64.exe");
  const output = path.join(root, "out"), tool = path.resolve(__dirname, "../tools/prepare-domestic-update.cjs");
  await fs.promises.writeFile(executable, contents);
  const generated = spawnSync(process.execPath, [tool, "keygen", key], { encoding: "utf8" });
  assert.equal(generated.status, 0, generated.stderr);
  const privateKey = crypto.createPrivateKey(await fs.promises.readFile(key));
  const channel = { publicKey: crypto.createPublicKey(privateKey).export({ type: "spki", format: "pem" }),
    repository: "https://github.com/example/pond", legacyBranch: "main", legacyPath: "latest.json",
    mirrors: ["https://mirror.example.com"] };
  const channelFile = path.join(root, "channel.json");
  await fs.promises.writeFile(channelFile, JSON.stringify(channel));
  const prepared = spawnSync(process.execPath, [tool, "build", executable, "1.2.0", output, key, "", channelFile], { encoding: "utf8" });
  assert.equal(prepared.status, 0, prepared.stderr);
  const envelope = JSON.parse(await fs.promises.readFile(path.join(output, "latest.json"), "utf8"));
  const item = parseDomesticRelease(envelope, "1.0.0", channel);
  assert.equal(item.sha256, digest(contents));
  assert.deepEqual(await fs.promises.readFile(path.join(output, path.basename(new URL(item.parts[0].urls[0]).pathname))), contents);
  const settings = createSettings(channel);
  assert.equal((await verifyPrepared({ executable, directory: output, version: "1.2.0", settings })).sha256, digest(contents));
  await fs.promises.writeFile(path.join(output, "SHA256SUMS.txt"), "wrong checksum\n");
  await assert.rejects(verifyPrepared({ executable, directory: output, version: "1.2.0", settings }), /SHA256SUMS/);
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
