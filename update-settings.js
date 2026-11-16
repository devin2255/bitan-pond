"use strict";

const crypto = require("node:crypto");
const { httpsURL } = require("./update-feed");

// One source of truth for the client endpoints and the publisher's asset URLs.
function createSettings(config) {
  if (!config || typeof config !== "object") throw new Error("更新配置无效");
  const repository = httpsURL(config.repository);
  const repo = new URL(repository);
  if (repo.hostname !== "github.com" || repo.search || !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo.pathname)) {
    throw new Error("GitHub 仓库地址无效");
  }
  const safePath = (value) => typeof value === "string" && /^[A-Za-z0-9._/-]+$/.test(value) &&
    !value.startsWith("/") && !value.endsWith("/") && !value.split("/").some((part) => !part || part === "." || part === "..");
  if (!safePath(config.legacyBranch) || !safePath(config.legacyPath)) throw new Error("旧版更新清单地址无效");
  const legacyFeed = httpsURL(`https://raw.githubusercontent.com${repo.pathname}/${config.legacyBranch}/${config.legacyPath}`);
  if (!Array.isArray(config.mirrors) || config.mirrors.length < 1 || config.mirrors.length > 4) throw new Error("镜像配置无效");
  const mirrors = config.mirrors.map((value) => {
    let parsed;
    try { parsed = new URL(value); } catch (_) { throw new Error("镜像地址无效"); }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.origin !== value ||
        parsed.pathname !== "/" || parsed.search || parsed.hash) throw new Error("镜像地址无效");
    return value;
  });
  if (new Set(mirrors).size !== mirrors.length) throw new Error("镜像地址重复");
  let key;
  try { key = crypto.createPublicKey(config.publicKey); } catch (_) { throw new Error("更新公钥无效"); }
  if (key.asymmetricKeyType !== "ed25519") throw new Error("更新公钥必须是 Ed25519");
  const officialFeed = `${repository}/releases/latest/download/latest.json`;
  const feedUrls = [officialFeed, ...mirrors.map((mirror) => `${mirror}/${officialFeed}`),
    ...mirrors.map((mirror) => `${mirror}/${legacyFeed}`), legacyFeed];
  return Object.freeze({ repository, legacyFeed, legacyBranch: config.legacyBranch, legacyPath: config.legacyPath,
    mirrors: Object.freeze(mirrors), publicKey: config.publicKey,
    officialFeed, feedUrls: Object.freeze(feedUrls) });
}

function partURLs(settings, version, name) {
  const original = `${settings.repository}/releases/download/v${version}/${name}`;
  return settings.mirrors.map((mirror) => `${mirror}/${original}`);
}

module.exports = { createSettings, partURLs };
