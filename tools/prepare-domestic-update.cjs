"use strict";

// Run locally by the release owner; never publish or commit the private key.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { parseVersion, MAX_UPDATE_BYTES } = require("../updater");
const { createSettings, partURLs } = require("../update-settings");

const PART_BYTES = 48 * 1024 * 1024;
const repo = path.resolve(__dirname, "..");
const relativeToRepo = (file) => path.relative(repo, file);
const insideRepo = (file) => {
  const relative = relativeToRepo(file);
  return relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative));
};

function usage() {
  throw new Error("用法：node tools/prepare-domestic-update.cjs keygen <仓库外私钥路径>\n" +
    "或：node tools/prepare-domestic-update.cjs build <EXE路径> <版本号> <输出目录> <私钥路径> [更新说明文件]");
}

async function generateKey(keyFile) {
  if (!keyFile) usage();
  keyFile = path.resolve(keyFile);
  if (insideRepo(keyFile)) throw new Error("私钥必须保存在项目仓库之外");
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  await fs.promises.mkdir(path.dirname(keyFile), { recursive: true, mode: 0o700 });
  await fs.promises.writeFile(keyFile, privateKey.export({ format: "pem", type: "pkcs8" }), { flag: "wx", mode: 0o600 });
  console.log("已生成私钥；请妥善保管并安全备份，不要提交到仓库或上传。\n公钥：\n" + publicKey.export({ format: "pem", type: "spki" }));
}

async function writeAll(output, buffer, length) {
  for (let offset = 0; offset < length;) {
    const result = await output.write(buffer, offset, length - offset);
    if (!result.bytesWritten) throw new Error("写入分片失败");
    offset += result.bytesWritten;
  }
}

async function build(file, version, out, keyFile, notesFile, channelFile = path.join(repo, "update-channel.json")) {
  if (!file || !version || !out || !keyFile) usage();
  if (!parseVersion(version) || version.startsWith("v")) throw new Error("版本号必须是 1.2.3 格式");
  file = path.resolve(file); out = path.resolve(out); keyFile = path.resolve(keyFile);
  if (path.basename(file) !== `Tangli-v${version}-Windows-x64.exe`) throw new Error("EXE 文件名与版本号不一致");
  if (insideRepo(keyFile)) throw new Error("私钥必须保存在项目仓库之外");
  const info = await fs.promises.stat(file);
  if (!info.isFile() || info.size <= 0 || info.size > MAX_UPDATE_BYTES) throw new Error("EXE 文件大小无效");
  const key = crypto.createPrivateKey(await fs.promises.readFile(keyFile));
  if (key.asymmetricKeyType !== "ed25519") throw new Error("更新签名私钥不是 Ed25519");
  const channel = createSettings(JSON.parse(await fs.promises.readFile(channelFile, "utf8")));
  const publicKey = crypto.createPublicKey(key).export({ format: "pem", type: "spki" });
  if (channel.publicKey !== publicKey) throw new Error("签名私钥与应用内的公钥不匹配");
  const notes = notesFile ? (await fs.promises.readFile(notesFile, "utf8")).replace(/\r\n/g, "\n").slice(0, 1200) : "";
  await fs.promises.mkdir(out); // Fail rather than overwrite a previous release.
  const source = await fs.promises.open(file, "r");
  const whole = crypto.createHash("sha256"), parts = [];
  const buffer = Buffer.alloc(1024 * 1024);
  let position = 0;
  try {
    while (position < info.size) {
      const name = `Tangli-v${version}-Windows-x64.exe.part-${String(parts.length + 1).padStart(3, "0")}`;
      const length = Math.min(PART_BYTES, info.size - position), hash = crypto.createHash("sha256");
      const output = await fs.promises.open(path.join(out, name), "wx");
      try {
        let written = 0;
        while (written < length) {
          const read = await source.read(buffer, 0, Math.min(buffer.length, length - written), position);
          if (!read.bytesRead) throw new Error("读取 EXE 时提前结束");
          whole.update(buffer.subarray(0, read.bytesRead)); hash.update(buffer.subarray(0, read.bytesRead));
          await writeAll(output, buffer, read.bytesRead);
          written += read.bytesRead; position += read.bytesRead;
        }
      } finally { await output.close(); }
      parts.push({ urls: partURLs(channel, version, name), size: length, sha256: hash.digest("hex") });
    }
  } finally { await source.close(); }
  const manifest = { format: 1, version, name: `Tangli-v${version}-Windows-x64.exe`, size: info.size,
    sha256: whole.digest("hex"), notes, parts };
  const payload = Buffer.from(JSON.stringify(manifest));
  const envelope = { format: 1, payload: payload.toString("base64"), signature: crypto.sign(null, payload, key).toString("base64") };
  await fs.promises.writeFile(path.join(out, "latest.json"), JSON.stringify(envelope) + "\n", { flag: "wx" });
  const sums = [`${manifest.sha256}  ${manifest.name}`, ...parts.map((part, index) =>
    `${part.sha256}  ${manifest.name}.part-${String(index + 1).padStart(3, "0")}`)];
  await fs.promises.writeFile(path.join(out, "SHA256SUMS.txt"), sums.join("\n") + "\n", { flag: "wx" });
  console.log(JSON.stringify({ version, size: info.size, sha256: manifest.sha256, parts: parts.length, out }, null, 2));
}

(async () => {
  const [action, ...args] = process.argv.slice(2);
  if (action === "keygen") await generateKey(...args);
  else if (action === "build") await build(...args);
  else usage();
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
