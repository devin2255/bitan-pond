"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { verifyFeed, httpsURL, MAX_MANIFEST_BYTES } = require("./update-feed");
const { createSettings } = require("./update-settings");
const UPDATE_CHANNEL = createSettings(require("./update-channel.json"));

const REPOSITORY = UPDATE_CHANNEL.repository;
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

function timedSignal(timeout) {
  const controller = new AbortController();
  const timer = Number.isFinite(timeout) && timeout > 0 ? setTimeout(() => controller.abort(), timeout) : null;
  if (timer && timer.unref) timer.unref();
  return { signal: controller.signal, done: () => { if (timer) clearTimeout(timer); } };
}

function parseDomesticRelease(envelope, currentVersion, channel) {
  if (!channel || typeof channel.publicKey !== "string") throw new Error("更新签名公钥尚未配置");
  const release = verifyFeed(envelope, channel.publicKey, { parseVersion, compareVersions, maxUpdateBytes: MAX_UPDATE_BYTES, currentVersion });
  if (!release) return null;
  return Object.freeze({ ...release,
    url: `${REPOSITORY}/releases/download/${release.tag}/${release.name}`,
    releaseURL: `${REPOSITORY}/releases/tag/${release.tag}`,
  });
}

async function boundedJSON(response, maxBytes) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new Error("更新信息过大");
  if (!response.body) throw new Error("更新信息为空");
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0, done = false;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) { done = true; break; }
      total += next.value.length;
      if (total > maxBytes) throw new Error("更新信息过大");
      chunks.push(Buffer.from(next.value));
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { if (!done) await reader.cancel().catch(() => {}); }
}

async function checkFeed(fetch, currentVersion, timeout, channel, feedUrl) {
  const url = httpsURL(feedUrl);
  const timer = timedSignal(timeout);
  try {
    const response = await fetch(url, { headers: { "User-Agent": "Tangli-Updater" }, cache: "no-store", signal: timer.signal });
    if (!response.ok) throw new Error(`检查更新失败（HTTP ${response.status}）`);
    const envelope = await boundedJSON(response, MAX_MANIFEST_BYTES * 2);
    return parseDomesticRelease(envelope, currentVersion, channel);
  } finally { timer.done(); }
}

async function checkForUpdate(fetch, currentVersion, timeout = 5000, channel = UPDATE_CHANNEL) {
  if (!channel || !channel.publicKey) throw new Error("更新签名公钥尚未配置");
  const feedUrls = Array.isArray(channel.feedUrls) ? channel.feedUrls : [channel.feedUrl];
  if (!feedUrls.length || feedUrls.length > 10) throw new Error("更新清单地址无效");
  const checks = feedUrls.map((url) => checkFeed(fetch, currentVersion, timeout, channel, url));
  const results = await Promise.allSettled(checks);
  const releases = results.filter((result) => result.status === "fulfilled" && result.value).map((result) => result.value);
  // Query concurrently so a stale mirror cannot hide a newer signed release.
  releases.sort((a, b) => compareVersions(b.version, a.version));
  if (releases.length) return releases[0];
  if (results.some((result) => result.status === "fulfilled")) return null;
  throw results[0].reason;
}

async function downloadSource(fetch, file, parts, verified, timer, idleTimeout, onProgress) {
  const output = await fs.promises.open(file, "wx");
  const stop = new AbortController();
  const offsets = [];
  let cursor = 0, next = 0, firstError = null, lastPercent = -1, closed = false;
  for (const part of parts) { offsets.push(cursor); cursor += part.size; }
  const progress = parts.map(() => 0);
  const report = () => {
    const percent = Math.min(100, Math.floor(progress.reduce((sum, bytes) => sum + bytes, 0) * 100 / verified.size));
    if (percent !== lastPercent) { lastPercent = percent; onProgress(percent); }
  };

  async function downloadPart(part, index) {
    let lastError = null;
    for (const url of part.urls) {
      let reader = null, idleTimer = null;
      const idle = new AbortController();
      const resetIdle = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => idle.abort(), idleTimeout);
        if (idleTimer.unref) idleTimer.unref();
      };
      try {
        resetIdle();
        const signal = AbortSignal.any([timer.signal, stop.signal, idle.signal]);
        const response = await fetch(url, { headers: { "User-Agent": "Tangli-Updater" }, signal });
        if (!response.ok || !response.body) throw new Error(`下载更新失败（HTTP ${response.status}）`);
        const reported = Number(response.headers.get("content-length") || 0);
        if (reported && reported !== part.size) throw new Error("更新包大小与发行信息不一致");
        reader = response.body.getReader();
        const partHash = crypto.createHash("sha256");
        let partBytes = 0;
        while (true) {
          const result = await reader.read();
          if (result.done) break;
          resetIdle();
          const buffer = Buffer.from(result.value);
          if (partBytes + buffer.length > part.size) throw new Error("下载内容超过发行包大小");
          partHash.update(buffer);
          for (let offset = 0; offset < buffer.length;) {
            const written = await output.write(buffer, offset, buffer.length - offset, offsets[index] + partBytes + offset);
            if (!written.bytesWritten) throw new Error("无法写入更新包");
            offset += written.bytesWritten;
          }
          partBytes += buffer.length; progress[index] = partBytes; report();
        }
        reader = null;
        if (partBytes !== part.size || partHash.digest("hex") !== part.sha256) throw new Error("更新包校验失败，已保留原程序");
        return;
      } catch (error) {
        lastError = error;
        if (reader) await reader.cancel().catch(() => {});
        progress[index] = 0; report();
        if (timer.signal.aborted || stop.signal.aborted) throw error;
      } finally { if (idleTimer) clearTimeout(idleTimer); }
    }
    throw lastError || new Error("没有可用的更新下载地址");
  }

  async function worker() {
    while (!stop.signal.aborted && next < parts.length) {
      const index = next++;
      try { await downloadPart(parts[index], index); }
      catch (error) {
        if (!firstError) firstError = error;
        stop.abort();
        return;
      }
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(3, parts.length) }, () => worker()));
    if (firstError) throw firstError;
    await output.close(); closed = true;
    const hash = crypto.createHash("sha256");
    let total = 0, signature = Buffer.alloc(0);
    for await (const buffer of fs.createReadStream(file)) {
      if (signature.length < 2) signature = Buffer.concat([signature, buffer.subarray(0, 2 - signature.length)]);
      total += buffer.length; hash.update(buffer);
    }
    if (total !== verified.size || hash.digest("hex") !== verified.sha256) throw new Error("更新包校验失败，已保留原程序");
    if (signature.length !== 2 || signature.toString("ascii") !== "MZ") throw new Error("更新包不是有效的 Windows 程序");
  } finally {
    stop.abort();
    if (!closed) await output.close().catch(() => {});
  }
}

async function downloadUpdate(fetch, release, { tempRoot = os.tmpdir(), onProgress = () => {}, timeout = null,
  idleTimeout = 20000, channel = UPDATE_CHANNEL } = {}) {
  // Every source, including GitHub itself, must be bound to our signed manifest.
  if (!release || !release.signedEnvelope) throw new Error("更新信息缺少项目签名");
  const verified = parseDomesticRelease(release.signedEnvelope, "0.0.0", channel);
  if (!verified) throw new Error("更新信息无效");
  const dir = await fs.promises.mkdtemp(path.join(tempRoot, "tangli-update-"));
  const file = path.join(dir, "update.exe");
  const timer = timedSignal(timeout);
  let succeeded = false;
  try {
    const github = [{ urls: [verified.url], size: verified.size, sha256: verified.sha256 }];
    const sources = verified.parts ? [verified.parts, github] : [github];
    const errors = [];
    for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
      try {
        if (sourceIndex) onProgress(0);
        await downloadSource(fetch, file, sources[sourceIndex], verified, timer, idleTimeout, onProgress);
        succeeded = true;
        return { file, dir, version: verified.version, sha256: verified.sha256 };
      } catch (error) {
        errors.push(error);
        await fs.promises.unlink(file).catch(() => {});
        if (timer.signal.aborted) break;
      }
    }
    throw errors[errors.length - 1];
  } finally {
    timer.done();
    if (!succeeded) {
      await fs.promises.unlink(file).catch(() => {});
      await fs.promises.rmdir(dir).catch(() => {});
    }
  }
}

module.exports = { MAX_UPDATE_BYTES, parseVersion, compareVersions, parseDomesticRelease, checkForUpdate, downloadUpdate };
