"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createSettings } = require("../update-settings");
const { parseVersion, parseDomesticRelease } = require("../updater");
const { assetInfo } = require("./publish-update-release.cjs");

function chooseRecovery(release, name) {
  if (!release) return null;
  if (release.prerelease) throw new Error("不能恢复预发行版本");
  const assets = release.assets || [], executable = assets.find((item) => item.name === name);
  const manifest = assets.find((item) => item.name === "latest.json");
  if (!executable && assets.some((item) => item.name !== "latest.json")) throw new Error("已有草稿附件但缺少完整 EXE，需手动检查后恢复");
  if (!executable) return null;
  if (!manifest) throw new Error("远端 EXE 缺少已签名清单，不能自动恢复");
  for (const asset of [executable, manifest]) {
    if (asset.state !== "uploaded" || !Number.isSafeInteger(asset.size) || asset.size <= 0 ||
        !/^sha256:[a-f0-9]{64}$/.test(asset.digest || "")) throw new Error("远端附件尚未完成校验");
  }
  return { executable, manifest };
}

function validateRecovered(envelope, info, version, settings) {
  const signed = parseDomesticRelease(envelope, "0.0.0", settings);
  if (!signed || signed.version !== version || signed.size !== info.size || signed.sha256 !== info.sha256) {
    throw new Error("恢复的 EXE 与已签名版本不一致");
  }
  return signed;
}

function gh(args) {
  const result = spawnSync("gh", args, { encoding: "utf8", windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`gh 失败：${result.error?.message || result.stderr.trim() || result.status}`);
  return result.stdout.trim();
}

async function main() {
  const [executable, version] = process.argv.slice(2);
  if (!executable || !version || !parseVersion(version) || version.startsWith("v") ||
      path.basename(executable) !== `Tangli-v${version}-Windows-x64.exe`) throw new Error("恢复参数或版本无效");
  const root = path.resolve(__dirname, "..");
  const settings = createSettings(JSON.parse(await fs.promises.readFile(path.join(root, "update-channel.json"), "utf8")));
  const slug = new URL(settings.repository).pathname.slice(1), tag = `v${version}`;
  const releases = JSON.parse(gh(["api", `repos/${slug}/releases?per_page=100`]));
  const assets = chooseRecovery(releases.find((item) => item.tag_name === tag), path.basename(executable));
  if (!assets) { console.log(JSON.stringify({ recovered: false })); return; }
  const temp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tangli-release-recover-"));
  const downloaded = path.join(temp, assets.executable.name), manifestFile = path.join(temp, assets.manifest.name);
  try {
    gh(["release", "download", tag, "--repo", slug, "--pattern", assets.executable.name, "--pattern", assets.manifest.name, "--dir", temp]);
    const info = await assetInfo(downloaded);
    const manifestInfo = await assetInfo(manifestFile);
    if (info.size !== assets.executable.size || `sha256:${info.sha256}` !== assets.executable.digest ||
        manifestInfo.size !== assets.manifest.size || `sha256:${manifestInfo.sha256}` !== assets.manifest.digest) throw new Error("恢复的附件校验失败");
    validateRecovered(JSON.parse(await fs.promises.readFile(manifestFile, "utf8")), info, version, settings);
    await fs.promises.copyFile(downloaded, executable);
    console.log(JSON.stringify({ recovered: true, sha256: info.sha256 }));
  } finally {
    await fs.promises.unlink(downloaded).catch(() => {});
    await fs.promises.unlink(manifestFile).catch(() => {});
    await fs.promises.rmdir(temp).catch(() => {});
  }
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { chooseRecovery, validateRecovered };
