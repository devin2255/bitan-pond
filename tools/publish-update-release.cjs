"use strict";

// Publish already-built, verified assets. Safe to rerun after a partial upload.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createSettings } = require("../update-settings");
const { compareVersions, parseDomesticRelease } = require("../updater");
const { verifyPrepared, verifyEmbedded } = require("./verify-update-release.cjs");

function run(command, args, input) {
  const result = spawnSync(command, args, { encoding: "utf8", input, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`${command} 失败：${result.error?.message || result.stderr.trim() || result.status}`);
  return result.stdout.trim();
}

function inspectAssets(remoteAssets, expected) {
  const byName = new Map(remoteAssets.map((asset) => [asset.name, asset]));
  const extras = remoteAssets.filter((asset) => !expected.some((item) => item.name === asset.name));
  if (extras.length) throw new Error(`发行版含未预期附件：${extras.map((asset) => asset.name).join(", ")}`);
  return expected.filter((item) => {
    const remote = byName.get(item.name);
    if (!remote) return true;
    if (remote.state !== "uploaded" || remote.size !== item.size || remote.digest !== `sha256:${item.sha256}`) {
      throw new Error(`远端附件不一致：${item.name}`);
    }
    return false;
  });
}

async function waitForRelease(findRelease, attempts = 40, delayMs = 1500) {
  for (let index = 0; index < attempts; index++) {
    const release = findRelease();
    if (release) return release;
    if (index + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error("发行草稿暂时不可见，请稍后重试");
}

async function waitForAssets(findRelease, expected, requiredNames, attempts = 40, delayMs = 1500) {
  let lastError = null;
  for (let index = 0; index < attempts; index++) {
    const release = findRelease();
    if (release) {
      try {
        const missing = new Set(inspectAssets(release.assets || [], expected).map((item) => item.name));
        if (requiredNames.every((name) => !missing.has(name))) return release;
      } catch (error) { lastError = error; }
    }
    if (index + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw lastError || new Error("远端发行附件暂时不可见，请稍后重试");
}

async function assetInfo(file) {
  const hash = crypto.createHash("sha256");
  for await (const data of fs.createReadStream(file)) hash.update(data);
  return { file, name: path.basename(file), size: (await fs.promises.stat(file)).size, sha256: hash.digest("hex") };
}

async function publish({ executable, directory, unpackedAsar, notesFile, version, setupFile, dryRun = false,
  root = path.resolve(__dirname, ".."), adapters = {} }) {
  const pkg = JSON.parse(await fs.promises.readFile(path.join(root, "package.json"), "utf8"));
  const settings = createSettings(JSON.parse(await fs.promises.readFile(path.join(root, "update-channel.json"), "utf8")));
  if (pkg.version !== version) throw new Error("项目版本与发布版本不一致");
  const release = await verifyPrepared({ executable, directory, version, settings, setupFile });
  (adapters.verifyEmbedded || verifyEmbedded)({ executable, unpackedAsar, version, repoRoot: root });
  await fs.promises.access(notesFile, fs.constants.R_OK);
  const execute = adapters.run || run, pollDelay = adapters.pollDelayMs ?? 1500;
  const tag = `v${version}`, head = execute("git", ["rev-parse", "HEAD"]);
  if (head !== execute("git", ["rev-parse", `${tag}^{commit}`])) throw new Error("当前代码与版本标签不一致");
  const slug = new URL(settings.repository).pathname.slice(1);
  const gh = (args, input) => execute("gh", args, input);
  const api = (suffix) => JSON.parse(gh(["api", `repos/${slug}/${suffix}`]));
  const findRelease = () => api("releases?per_page=100").find((item) => item.tag_name === tag);
  const newerReleaseExists = () => api("releases?per_page=100").some((item) => !item.draft && !item.prerelease &&
    /^v\d+\.\d+\.\d+$/.test(item.tag_name) && compareVersions(item.tag_name, version) > 0);
  const legacyPath = settings.legacyPath.split("/").map(encodeURIComponent).join("/");
  const readLegacy = () => api(`contents/${legacyPath}?ref=${encodeURIComponent(settings.legacyBranch)}`);
  const signedBytes = await fs.promises.readFile(path.join(directory, "latest.json"));
  const inspectLegacy = () => {
    const legacy = readLegacy();
    const bytes = Buffer.from(String(legacy.content || "").replace(/\s/g, ""), "base64");
    const prior = parseDomesticRelease(JSON.parse(bytes.toString("utf8")), "0.0.0", settings);
    if (!prior || compareVersions(prior.version, version) > 0) throw new Error("旧版更新清单比本次发布更新，拒绝覆盖");
    if (prior.version === version && !bytes.equals(signedBytes)) throw new Error("同版本旧版清单内容不一致，拒绝覆盖");
    return { legacy, needsUpdate: !bytes.equals(signedBytes) };
  };
  if (newerReleaseExists()) throw new Error("已有更高的正式发行版，拒绝回退");
  inspectLegacy();
  const files = [executable, ...(release.setup ? [setupFile] : []), path.join(directory, "latest.json"), path.join(directory, "SHA256SUMS.txt"),
    ...release.parts.map((_, index) => path.join(directory, `${release.name}.part-${String(index + 1).padStart(3, "0")}`))];
  const expected = await Promise.all(files.map(assetInfo));
  let remote = findRelease();
  if (dryRun) {
    const missing = remote ? inspectAssets(remote.assets || [], expected) : expected;
    console.log(JSON.stringify({ dryRun: true, version, assetCount: expected.length, pendingAssets: missing.length,
      sha256: release.sha256, legacyBranch: settings.legacyBranch }));
    return;
  }
  if (!remote) {
    gh(["release", "create", tag, "--repo", slug, "--draft", "--verify-tag", "--title", `塘里 ${tag}`, "--notes-file", notesFile]);
    remote = await waitForRelease(findRelease, 40, pollDelay);
  }
  if (!remote || remote.prerelease) throw new Error("发行版状态无效");
  let missing = inspectAssets(remote.assets || [], expected);
  if (missing.length) {
    if (!remote.draft) throw new Error("已发布的发行版缺少附件，请手动检查");
    // Publish the signed manifest before the EXE. A retry only trusts a
    // recovered executable whose hash and version match this manifest.
    const manifest = expected.find((item) => item.name === "latest.json");
    const exe = expected[0];
    if (missing.some((item) => item.name === manifest.name)) {
      gh(["release", "upload", tag, "--repo", slug, manifest.file]);
      remote = await waitForAssets(findRelease, expected, [manifest.name], 40, pollDelay);
      missing = inspectAssets(remote.assets || [], expected);
    }
    if (missing.some((item) => item.name === exe.name)) {
      gh(["release", "upload", tag, "--repo", slug, exe.file]);
      remote = await waitForAssets(findRelease, expected, [manifest.name, exe.name], 40, pollDelay);
      missing = inspectAssets(remote.assets || [], expected);
    }
    if (missing.length) gh(["release", "upload", tag, "--repo", slug, ...missing.map((item) => item.file)]);
  }
  remote = await waitForAssets(findRelease, expected, expected.map((item) => item.name), 40, pollDelay);
  if (newerReleaseExists()) throw new Error("已有更高的正式发行版，拒绝回退");
  if (remote.draft) gh(["release", "edit", tag, "--repo", slug, "--draft=false", "--latest"]);
  const { legacy, needsUpdate } = inspectLegacy();
  if (needsUpdate) {
    const input = JSON.stringify({ message: `Publish signed ${tag} update feed`, content: signedBytes.toString("base64"),
      sha: legacy.sha, branch: settings.legacyBranch });
    gh(["api", "--method", "PUT", `repos/${slug}/contents/${legacyPath}`, "--input", "-"], input);
  }
  console.log(JSON.stringify({ ok: true, version, assets: expected.length, legacyUpdated: needsUpdate,
    releaseURL: `${settings.repository}/releases/tag/${tag}` }));
}

async function main() {
  const args = process.argv.slice(2), dryRun = args.includes("--dry-run");
  const [executable, directory, unpackedAsar, version, notesFile, setupFile] = args.filter((arg) => arg !== "--dry-run");
  if (!executable || !directory || !unpackedAsar || !version || !notesFile) {
    throw new Error("用法：node tools/publish-update-release.cjs <EXE> <清单目录> <app.asar> <版本> <说明文件>");
  }
  await publish({ executable, directory, unpackedAsar, version, notesFile, setupFile, dryRun });
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { inspectAssets, waitForRelease, waitForAssets, assetInfo, publish };
