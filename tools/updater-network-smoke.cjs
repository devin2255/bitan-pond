// Run explicitly with Electron to verify Chromium networking against the real release.
const { app, net } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { checkForUpdate, downloadUpdate } = require(process.env.TANGLI_SMOKE_UPDATER || "../updater");
const output = process.env.TANGLI_SMOKE_RESULT;
if (process.argv.includes("--no-proxy")) app.commandLine.appendSwitch("no-proxy-server");

app.whenReady().then(async () => {
  let downloaded = null;
  const requests = [];
  try {
    const fetch = (url, options) => {
      requests.push(url);
      if (process.argv.includes("--no-github") && /^https:\/\/(?:api\.)?github\.com\//.test(url)) {
        return Promise.reject(new Error("GitHub deliberately disabled for smoke test"));
      }
      return net.fetch(url, options);
    };
    const release = await checkForUpdate(fetch, process.env.TANGLI_SMOKE_CURRENT || "0.0.0");
    if (!release) throw new Error("No release found");
    if (process.argv.includes("--download")) {
      let lastProgress = -5;
      downloaded = await downloadUpdate(fetch, release, { onProgress: (progress) => {
        if (progress < lastProgress || progress >= lastProgress + 5) {
          lastProgress = progress;
          fs.writeFileSync(output, JSON.stringify({ running: true, version: release.version, progress }));
        }
      } });
    }
    fs.writeFileSync(output, JSON.stringify({ ok: true, version: release.version, downloaded: !!downloaded,
      source: release.parts ? "signed-mirror" : "github", sha256: release.sha256, requests }));
    if (downloaded) {
      await fs.promises.unlink(downloaded.file);
      await fs.promises.rmdir(downloaded.dir);
    }
    app.exit(0);
  } catch (error) {
    fs.writeFileSync(output, JSON.stringify({ ok: false, error: String(error.stack || error) }));
    app.exit(1);
  }
});
