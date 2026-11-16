"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createSettings, partURLs } = require("../update-settings");
const { parseDomesticRelease } = require("../updater");

const root = path.resolve(__dirname, "..");
const settings = createSettings(JSON.parse(fs.readFileSync(path.join(root, "update-channel.json"), "utf8")));
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
for (const file of ["updater.js", "update-feed.js", "update-settings.js", "update-channel.json", "portable-update.ps1"]) {
  if (!pkg.build.files.includes(file)) throw new Error(`更新模块未被打包：${file}`);
}
const legacy = JSON.parse(fs.readFileSync(path.join(root, "updates/latest.json"), "utf8"));
const release = parseDomesticRelease(legacy, "0.0.0", settings);
if (!release) throw new Error("旧版更新清单无效");
for (let index = 0; index < release.parts.length; index++) {
  const name = `${release.name}.part-${String(index + 1).padStart(3, "0")}`;
  const allowed = new Set(partURLs(settings, release.version, name));
  if (!release.parts[index].urls.every((url) => allowed.has(url))) throw new Error("旧版清单的镜像地址与配置不一致");
}
console.log(JSON.stringify({ ok: true, mirrors: settings.mirrors.length, endpoints: settings.feedUrls.length, legacyVersion: release.version }));
