"use strict";

// A domestic mirror is a transport, not a source of trust.  The release
// publisher signs this envelope offline; the app embeds only the public key.
const crypto = require("node:crypto");

const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_PARTS = 32;

function decodeBase64(value, maxBytes) {
  if (typeof value !== "string" || value.length > Math.ceil(maxBytes / 3) * 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error("更新清单编码无效");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length > maxBytes || bytes.toString("base64") !== value) throw new Error("更新清单编码无效");
  return bytes;
}

function httpsURL(value) {
  let url;
  try { url = new URL(value); } catch (_) { throw new Error("更新包地址无效"); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.href !== value) {
    throw new Error("更新包地址无效");
  }
  return url.href;
}

function verifyFeed(envelope, publicKey, { parseVersion, compareVersions, maxUpdateBytes, currentVersion = "0.0.0" }) {
  if (!envelope || envelope.format !== 1 || typeof publicKey !== "string") throw new Error("更新清单格式无效");
  const payload = decodeBase64(envelope.payload, MAX_MANIFEST_BYTES);
  const signature = decodeBase64(envelope.signature, 64);
  if (signature.length !== 64 || !crypto.verify(null, payload, publicKey, signature)) {
    throw new Error("更新清单签名无效");
  }
  let manifest;
  try { manifest = JSON.parse(payload.toString("utf8")); } catch (_) { throw new Error("更新清单格式无效"); }
  if (!manifest || manifest.format !== 1 || !parseVersion(manifest.version) || manifest.version.startsWith("v") ||
      manifest.name !== `Tangli-v${manifest.version}-Windows-x64.exe` ||
      !Number.isSafeInteger(manifest.size) || manifest.size <= 0 || manifest.size > maxUpdateBytes ||
      !/^[a-f0-9]{64}$/.test(manifest.sha256 || "") || !Array.isArray(manifest.parts) ||
      manifest.parts.length === 0 || manifest.parts.length > MAX_PARTS) {
    throw new Error("更新清单内容无效");
  }
  let total = 0;
  const parts = manifest.parts.map((part) => {
    if (!part || !Number.isSafeInteger(part.size) || part.size <= 0 ||
        !/^[a-f0-9]{64}$/.test(part.sha256 || "")) throw new Error("更新分片信息无效");
    const urls = Array.isArray(part.urls) ? part.urls : [part.url];
    if (!urls.length || urls.length > 4) throw new Error("更新分片地址无效");
    total += part.size;
    return Object.freeze({ urls: Object.freeze(urls.map(httpsURL)), size: part.size, sha256: part.sha256 });
  });
  if (total !== manifest.size) throw new Error("更新分片大小不匹配");
  let setup = null;
  if (manifest.setup != null) {
    const item = manifest.setup;
    if (!item || item.name !== `Tangli-v${manifest.version}-Setup.exe` ||
        !Number.isSafeInteger(item.size) || item.size <= 0 || item.size > maxUpdateBytes ||
        !/^[a-f0-9]{64}$/.test(item.sha256 || "")) throw new Error("安装包信息无效");
    setup = Object.freeze({ name: item.name, size: item.size, sha256: item.sha256 });
  }
  if (compareVersions(manifest.version, currentVersion) <= 0) return null;
  return Object.freeze({
    version: manifest.version, tag: `v${manifest.version}`, name: manifest.name,
    size: manifest.size, sha256: manifest.sha256,
    notes: String(manifest.notes || "").slice(0, 1200).trim(),
    parts: Object.freeze(parts), setup,
    // Keep the signed bytes so they can be authenticated again before download.
    signedEnvelope: Object.freeze({ format: 1, payload: envelope.payload, signature: envelope.signature }),
  });
}

module.exports = { MAX_MANIFEST_BYTES, MAX_PARTS, verifyFeed, httpsURL };
