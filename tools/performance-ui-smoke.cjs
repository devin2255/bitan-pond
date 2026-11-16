"use strict";
// Verify that performance preferences are shared between pond windows while
// each window remains free to adapt its own rendering budget.
const { app, BrowserWindow, session } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "tangli-performance-smoke-")));
app.whenReady().then(async () => {
  const windows = [];
  try {
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, done) => done(false));
    session.defaultSession.webRequest.onBeforeRequest((details, done) => done({ cancel: /^https?:/i.test(details.url) }));
    for (let i = 0; i < 2; i++) {
      const win = new BrowserWindow({ width: i ? 1000 : 1280, height: 720, show: false,
        webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false } });
      await win.loadFile(path.join(root, "web", "index.html"));
      windows.push(win);
    }
    const run = (index, code) => windows[index].webContents.executeJavaScript(code);
    const before = await run(0, "({ status: Pond.getPerformanceStatus(), fish: Pond.getFishCounts() })");
    if (before.status.mode !== "auto") throw new Error("Default performance mode is not automatic");
    await run(0, "document.getElementById('btn-fish').click(); const s=document.getElementById('performance-mode'); s.value='smooth'; s.dispatchEvent(new Event('change',{bubbles:true}));");
    const deadline = Date.now() + 10000;
    let other;
    do {
      await new Promise((resolve) => setTimeout(resolve, 100));
      other = await run(1, "Pond.getPerformanceStatus()");
    } while (other.mode !== "smooth" && Date.now() < deadline);
    if (other.mode !== "smooth" || other.profile !== "economy") throw new Error("Performance preference did not reach the other screen");
    const after = await run(0, "({ status: Pond.getPerformanceStatus(), fish: Pond.getFishCounts(), saved: localStorage.getItem('bitan.performance.mode') })");
    if (JSON.stringify(before.fish) !== JSON.stringify(after.fish) || after.saved !== "smooth") throw new Error("Fish counts or saved preference changed unexpectedly");
    await run(0, "Pond.setPerformanceMode('quality')");
    if ((await run(0, "Pond.getPerformanceStatus()")).profile !== "quality") throw new Error("Quality preference was not applied");
    await run(0, "Pond.setPerformanceMode('auto')");
    if ((await run(0, "Pond.getPerformanceStatus()")).mode !== "auto") throw new Error("Automatic mode was not restored");
    console.log(JSON.stringify({ ok: true, screens: 2, fish: Object.values(after.fish).reduce((a, b) => a + b, 0) }));
    windows.forEach((win) => win.destroy());
    app.exit(0);
  } catch (error) {
    console.error(error.stack || error);
    windows.forEach((win) => win.destroy());
    app.exit(1);
  }
});
