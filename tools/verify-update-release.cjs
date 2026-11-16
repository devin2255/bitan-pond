"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const asar = require("@electron/asar");
const { createSettings, partURLs } = require("../update-settings");
const { parseDomesticRelease } = require("../updater");

async function fileHash(file) {
  const hash = crypto.createHash("sha256");
  for await (const data of fs.createReadStream(file)) hash.update(data);
  return hash.digest("hex");
}

async function verifyPrepared({ executable, directory, version, settings }) {
  const envelope = JSON.parse(await fs.promises.readFile(path.join(directory, "latest.json"), "utf8"));
  const release = parseDomesticRelease(envelope, "0.0.0", settings);
  if (!release || release.version !== version || path.basename(executable) !== release.name) throw new Error("签名清单、文件名和版本不一致");
  const exeStat = await fs.promises.stat(executable);
  if (exeStat.size !== release.size || await fileHash(executable) !== release.sha256) throw new Error("EXE 与签名清单不一致");
  const combined = crypto.createHash("sha256");
  const sums = [`${release.sha256}  ${release.name}`];
  for (let index = 0; index < release.parts.length; index++) {
    const part = release.parts[index], name = `${release.name}.part-${String(index + 1).padStart(3, "0")}`;
    if (JSON.stringify(part.urls) !== JSON.stringify(partURLs(settings, version, name))) throw new Error("分片镜像地址与更新配置不一致");
    const file = path.join(directory, name), stat = await fs.promises.stat(file);
    if (stat.size !== part.size) throw new Error("分片大小不一致");
    const hash = crypto.createHash("sha256");
    for await (const data of fs.createReadStream(file)) { hash.update(data); combined.update(data); }
    if (hash.digest("hex") !== part.sha256) throw new Error("分片哈希不一致");
    sums.push(`${part.sha256}  ${name}`);
  }
  if (combined.digest("hex") !== release.sha256) throw new Error("分片合并结果与 EXE 不一致");
  const recorded = (await fs.promises.readFile(path.join(directory, "SHA256SUMS.txt"), "utf8")).replace(/\r\n/g, "\n");
  if (recorded !== sums.join("\n") + "\n") throw new Error("SHA256SUMS.txt 与发行文件不一致");
  return release;
}

function verifyEmbedded({ executable, unpackedAsar, version, repoRoot }) {
  // Compare the app.asar actually inside the portable EXE with the build output,
  // then check its version and updater sources before signing a release.
  const result = spawnSync(require("7zip-bin").path7za, ["x", "-so", executable, "resources/app.asar"],
    { encoding: null, maxBuffer: 512 * 1024 * 1024, timeout: 180000, windowsHide: true });
  if (result.error || result.status !== 0 || !result.stdout) throw new Error("无法检查 EXE 中的应用内容");
  const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
  if (hash(result.stdout) !== hash(fs.readFileSync(unpackedAsar))) throw new Error("EXE 内容与当前构建输出不一致");
  const packageData = JSON.parse(asar.extractFile(unpackedAsar, "package.json").toString("utf8"));
  if (packageData.version !== version) throw new Error("EXE 内部版本与发布版本不一致");
  for (const file of ["main.js", "updater.js", "update-feed.js", "update-settings.js", "update-channel.json", "portable-update.ps1"]) {
    if (!asar.extractFile(unpackedAsar, file).equals(fs.readFileSync(path.join(repoRoot, file)))) {
      throw new Error(`EXE 中的 ${file} 与当前源代码不一致`);
    }
  }
}

async function main() {
  const [executable, directory, version, unpackedAsar] = process.argv.slice(2);
  if (!executable || !directory || !version || !unpackedAsar) {
    throw new Error("用法：node tools/verify-update-release.cjs <EXE> <清单目录> <版本> <win-unpacked/resources/app.asar>");
  }
  const repoRoot = path.resolve(__dirname, "..");
  const packageVersion = JSON.parse(await fs.promises.readFile(path.join(repoRoot, "package.json"), "utf8")).version;
  if (packageVersion !== version) throw new Error("项目版本与发布版本不一致");
  const settings = createSettings(JSON.parse(await fs.promises.readFile(path.join(repoRoot, "update-channel.json"), "utf8")));
  const release = await verifyPrepared({ executable, directory, version, settings });
  verifyEmbedded({ executable, unpackedAsar, version, repoRoot });
  console.log(JSON.stringify({ ok: true, version, size: release.size, sha256: release.sha256, parts: release.parts.length }));
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { verifyPrepared, verifyEmbedded };
