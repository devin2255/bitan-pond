"use strict";

// The installer places the signed-feed-compatible portable launcher in a
// stable per-user location, so installed and existing portable users can use
// exactly the same verified update package.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { NsisTargetOptions, NSIS_PATH } = require("app-builder-lib/out/targets/nsis/nsisUtil");

async function buildSetup(portable, output, version) {
  if (process.platform !== "win32") throw new Error("Windows 安装包必须在 Windows 上构建");
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(String(version || ""))) throw new Error("安装包版本无效");
  portable = path.resolve(portable);
  output = path.resolve(output);
  if (!fs.statSync(portable).isFile() || path.extname(portable).toLowerCase() !== ".exe") throw new Error("便携程序无效");
  if (path.extname(output).toLowerCase() !== ".exe" || fs.existsSync(output)) throw new Error("安装包目标已存在或无效");
  const root = path.resolve(__dirname, "..");
  const script = path.join(root, "installer", "tangli.nsi");
  const icon = path.join(root, "assets", "tangli-icon.ico");
  NsisTargetOptions.resolve({});
  const nsis = await NSIS_PATH();
  const compiler = path.join(nsis, "Bin", "makensis.exe");
  const args = ["/V2", "/WX", "/INPUTCHARSET", "UTF8", "/OUTPUTCHARSET", "UTF8",
    "/DTANGLI_PORTABLE=" + portable, "/DTANGLI_SETUP=" + output,
    "/DTANGLI_ICON=" + icon, "/DTANGLI_VERSION=" + version, script];
  const result = spawnSync(compiler, args, { cwd: root, env: { ...process.env, NSISDIR: nsis },
    encoding: "utf8", windowsHide: true, maxBuffer: 4 * 1024 * 1024, timeout: 600000 });
  if (result.error || result.status !== 0) throw new Error([result.stdout, result.stderr, result.error?.message].filter(Boolean).join("\n").trim() || "安装包构建失败");
  if (!fs.existsSync(output)) throw new Error("安装包没有生成");
  return { output, size: fs.statSync(output).size };
}

if (require.main === module) {
  const [portable, output, version] = process.argv.slice(2);
  if (!portable || !output || !version) { console.error("用法：node tools/build-setup.cjs <便携EXE> <安装包EXE> <版本>"); process.exitCode = 1; }
  else buildSetup(portable, output, version).then((result) => console.log(JSON.stringify(result)))
    .catch((error) => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { buildSetup };
