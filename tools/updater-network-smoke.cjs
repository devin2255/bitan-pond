// Run explicitly with Electron to verify Chromium networking against the real release.
const { app, net } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { checkForUpdate, downloadUpdate } = require("../updater");
const output = process.env.TANGLI_SMOKE_RESULT;

app.whenReady().then(async () => {
  let downloaded = null;
  try {
    const fetch = (url, options) => net.fetch(url, options);
    const release = await checkForUpdate(fetch, "0.0.0");
    if (!release) throw new Error("No release found");
    if (process.argv.includes("--download")) downloaded = await downloadUpdate(fetch, release);
    fs.writeFileSync(output, JSON.stringify({ ok: true, version: release.version, downloaded: !!downloaded, sha256: release.sha256 }));
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
