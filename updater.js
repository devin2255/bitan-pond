"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const RELEASE_API = "https://api.github.com/repos/devin2255/bitan-pond/releases/latest";
const REPOSITORY = "https://github.com/devin2255/bitan-pond";
const MAX_UPDATE_BYTES = 700 * 1024 * 1024;

function parseVersion(value) {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(String(value || ""));
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

function compareVersions(left, right) {
  const a = parseVersion(left), b = parseVersion(right);
  if (!a || !b) throw new Error("版本号格式不正确");
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

function parseRelease(release, currentVersion) {
  if (!release || release.draft !== false || release.prerelease !== false || !parseVersion(release.tag_name)) {
    throw new Error("更新信息不是有效的正式版本");
  }
  const version = release.tag_name.replace(/^v/, "");
  if (compareVersions(version, currentVersion) <= 0) return null;
  const tag = release.tag_name;
  const expectedName = `Tangli-v${version}-Windows-x64.exe`;
  const asset = Array.isArray(release.assets) ? release.assets.find((item) => item && item.name === expectedName && item.state === "uploaded") : null;
  if (!asset) throw new Error("新版本尚未提供 Windows 更新包");
  const digest = /^sha256:([a-f0-9]{64})$/i.exec(String(asset.digest || ""));
  if (!digest) throw new Error("更新包缺少可信的 SHA-256 校验值");
  if (!Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_UPDATE_BYTES) {
    throw new Error("更新包大小不正确");
  }
  const expectedURL = `${REPOSITORY}/releases/download/${tag}/${expectedName}`;
  if (asset.browser_download_url !== expectedURL) throw new Error("更新包地址不属于官方发行版");
  return Object.freeze({
    version,
    tag,
    name: expectedName,
    size: asset.size,
    sha256: digest[1].toLowerCase(),
    url: expectedURL,
    releaseURL: `${REPOSITORY}/releases/tag/${tag}`,
    notes: String(release.body || "").slice(0, 1200).trim(),
  });
}

function timedSignal(timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  if (timer.unref) timer.unref();
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

async function checkForUpdate(fetch, currentVersion, timeout = 20000) {
  const timer = timedSignal(timeout);
  try {
    const response = await fetch(RELEASE_API, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "Tangli-Updater" },
      cache: "no-store", signal: timer.signal,
    });
    if (!response.ok) throw new Error(`检查更新失败（HTTP ${response.status}）`);
    const length = Number(response.headers.get("content-length") || 0);
    if (length > 1024 * 1024) throw new Error("更新信息过大");
    return parseRelease(await response.json(), currentVersion);
  } finally { timer.done(); }
}

async function downloadUpdate(fetch, release, { tempRoot = os.tmpdir(), onProgress = () => {}, timeout = 30 * 60 * 1000 } = {}) {
  // Revalidate all fields, including the trusted URL, immediately before download.
  const verified = parseRelease({ tag_name: release.tag, draft: false, prerelease: false, body: release.notes,
    assets: [{ name: release.name, state: "uploaded", size: release.size, digest: `sha256:${release.sha256}`, browser_download_url: release.url }] }, "0.0.0");
  if (!verified) throw new Error("更新信息无效");
  const dir = await fs.promises.mkdtemp(path.join(tempRoot, "tangli-update-"));
  const file = path.join(dir, "update.exe");
  const timer = timedSignal(timeout);
  let output = null, reader = null, succeeded = false;
  try {
    const response = await fetch(verified.url, { headers: { "User-Agent": "Tangli-Updater" }, signal: timer.signal });
    if (!response.ok || !response.body) throw new Error(`下载更新失败（HTTP ${response.status}）`);
    const reported = Number(response.headers.get("content-length") || 0);
    if (reported && reported !== verified.size) throw new Error("更新包大小与发行信息不一致");
    output = await fs.promises.open(file, "wx");
    reader = response.body.getReader();
    const hash = crypto.createHash("sha256");
    let total = 0, lastPercent = -1, signature = Buffer.alloc(0);
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      const buffer = Buffer.from(result.value);
      if (signature.length < 2) signature = Buffer.concat([signature, buffer.subarray(0, 2 - signature.length)]);
      total += buffer.length;
      if (total > verified.size) throw new Error("下载内容超过发行包大小");
      hash.update(buffer);
      for (let offset = 0; offset < buffer.length;) {
        const written = await output.write(buffer, offset, buffer.length - offset);
        if (!written.bytesWritten) throw new Error("无法写入更新包");
        offset += written.bytesWritten;
      }
      const percent = Math.min(100, Math.floor(total * 100 / verified.size));
      if (percent !== lastPercent) { lastPercent = percent; onProgress(percent); }
    }
    await output.close(); output = null;
    if (total !== verified.size || hash.digest("hex") !== verified.sha256) throw new Error("更新包校验失败，已保留原程序");
    if (signature.length !== 2 || signature.toString("ascii") !== "MZ") throw new Error("更新包不是有效的 Windows 程序");
    succeeded = true;
    return { file, dir, version: verified.version, sha256: verified.sha256 };
  } finally {
    timer.done();
    if (reader && !succeeded) await reader.cancel().catch(() => {});
    if (output) await output.close().catch(() => {});
    if (!succeeded) {
      await fs.promises.unlink(file).catch(() => {});
      await fs.promises.rmdir(dir).catch(() => {});
    }
  }
}

module.exports = { RELEASE_API, MAX_UPDATE_BYTES, parseVersion, compareVersions, parseRelease, checkForUpdate, downloadUpdate };
