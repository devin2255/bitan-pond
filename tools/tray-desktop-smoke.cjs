// Opt-in Windows smoke test: actually attaches the app to the desktop and
// restores it. Uses an isolated appData directory and does not hook input/F11.
const electron = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const root = path.resolve(__dirname, "..");
const profile = path.join(root, "dist", "tray-desktop-smoke-profile");
const result = path.join(root, "dist", "tray-desktop-smoke.json");
fs.mkdirSync(profile, { recursive: true });
electron.app.setPath("appData", profile);
const entry = path.join(root, "main.js");
const instrument = `
app.whenReady().then(() => setTimeout(async () => {
  try {
    registerWallpaperHotkey = () => {}; unregisterWallpaperHotkey = () => {};
    startDeskInput = () => {}; stopDeskInput = () => {}; balloon = () => {};
    const before = { alive: !!tray && !tray.isDestroyed(), bounds: tray && tray.getBounds() };
    await enterWallpaper();
    const during = { alive: !!tray && !tray.isDestroyed(), wallpaperOn, bounds: tray && tray.getBounds() };
    await leaveSpecial();
    const after = { alive: !!tray && !tray.isDestroyed(), wallpaperOn };
    if (!before.alive || !during.alive || !during.wallpaperOn || !after.alive || after.wallpaperOn) throw new Error("Desktop tray lifecycle mismatch");
    fs.writeFileSync(${JSON.stringify(result)}, JSON.stringify({ ok: true, before, during, after }));
    app.quit();
  } catch (error) {
    fs.writeFileSync(${JSON.stringify(result)}, JSON.stringify({ ok: false, error: String(error.stack || error) }));
    try { await leaveSpecial(); } catch (_) {}
    app.quit();
  }
}, 3500));`;
const target = new Module(entry, module);
target.filename = entry;
target.paths = Module._nodeModulePaths(root);
target._compile(fs.readFileSync(entry, "utf8") + instrument, entry);
