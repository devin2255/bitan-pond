// Explicit Electron integration smoke test. Desktop attachment is stubbed so
// the user's wallpaper and F11 shortcut are not changed during verification.
const electron = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const root = path.resolve(__dirname, "..");
const profile = path.join(root, "dist", "tray-smoke-profile");
const result = path.join(root, "dist", "tray-smoke.json");
fs.mkdirSync(profile, { recursive: true });
electron.app.setPath("appData", profile);
const entry = path.join(root, "main.js");
const instrument = `
app.whenReady().then(() => {
  win.show = () => {}; win.showInactive = () => {}; win.focus = () => {};
  setTimeout(async () => {
    try {
      const state = () => ({ alive: !!tray && !tray.isDestroyed(), wallpaperOn, fullscreenFallback });
      const before = state();
      runPs = async (args) => {
        const action = args[args.indexOf("-Action") + 1];
        if (action === "monitors") {
          const rect = screen.dipToScreenRect(null, screen.getPrimaryDisplay().bounds);
          return "OK displays=" + [rect.x, rect.y, rect.width, rect.height].join(",");
        }
        if (action === "attach" || action === "move") {
          const value = (name) => args[args.indexOf(name) + 1];
          return "OK style=123 ex=0 x=" + value("-Left") + " y=" + value("-Top") +
            " w=" + value("-Width") + " h=" + value("-Height");
        }
        return "OK detached=1";
      };
      startDeskInput = () => {}; stopDeskInput = () => {};
      registerWallpaperHotkey = () => {}; unregisterWallpaperHotkey = () => {};
      balloon = () => {}; writePref = () => {};
      await enterWallpaper();
      const during = state();
      await leaveSpecial();
      const after = state();
      if (!before.alive || !during.alive || !during.wallpaperOn || !after.alive || after.wallpaperOn) throw new Error("Tray lifecycle mismatch");
      fs.writeFileSync(${JSON.stringify(result)}, JSON.stringify({ ok: true, before, during, after }));
      app.quit();
    } catch (error) {
      fs.writeFileSync(${JSON.stringify(result)}, JSON.stringify({ ok: false, error: String(error.stack || error) }));
      app.exit(1);
    }
  }, 2200);
});`;
const target = new Module(entry, module);
target.filename = entry;
target.paths = Module._nodeModulePaths(root);
target._compile(fs.readFileSync(entry, "utf8") + instrument, entry);
