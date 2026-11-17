"use strict";

// Exercise the actual leaf drawing function using Chromium's canvas rules.
// The pond source is instrumented only in an isolated temporary test page.
const { app, BrowserWindow, session } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const web = path.join(root, "web");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "tangli-season-render-"));
app.setPath("userData", path.join(temp, "profile"));
if (process.argv.includes("--software")) app.disableHardwareAcceleration();

const hook = `
  window.__seasonLeafProbe = function (weights, hasDry) {
    const previous = { ctx, dpr, realistic, snowLevel, seasonWeights, leafCacheBudget };
    const layer = makeCanvas(20, 20);
    const green = makeCanvas(20, 20), dry = makeCanvas(20, 20);
    green.getContext("2d").fillRect(0, 0, 20, 20);
    dry.getContext("2d").fillRect(0, 0, 20, 20);
    const leaf = { canvas: green, dryCanvas: hasDry ? dry : null, shadow: makeCanvas(10, 10), cx: 10, cy: 10, ox: 0, oy: 0,
      dx: 0, dy: 0, rot: 0, lift: 0, seasonRank: 0.05, dryRank: 0.2 };
    try {
      ctx = layer.getContext("2d"); dpr = 1; realistic = true; snowLevel = 0;
      seasonWeights = weights; leafCacheBudget = 0;
      drawOneLeaf(leaf);
      return { alpha: ctx.getImageData(10, 10, 1, 1).data[3], appearance: leafAppearance(leaf) };
    } finally {
      ctx = previous.ctx; dpr = previous.dpr; realistic = previous.realistic;
      snowLevel = previous.snowLevel; seasonWeights = previous.seasonWeights; leafCacheBudget = previous.leafCacheBudget;
    }
  };
`;
const source = fs.readFileSync(path.join(web, "pond.js"), "utf8");
const marker = "  window.Pond = {";
if (!source.includes(marker)) throw new Error("Cannot instrument the leaf renderer");
fs.writeFileSync(path.join(temp, "pond.js"), source.replace(marker, hook + marker));
const scripts = ["seasons.js", "fish-species.js", "fish-motion.js", "performance-governor.js", "boss-activity.js",
  "boss-dance.js", "boss-dance-rig.js", "pond-performance.js", "boss-character.js"];
const html = "<!doctype html><meta charset=utf-8><base href=" + JSON.stringify(pathToFileURL(web + path.sep).href) + ">" +
  scripts.map((name) => `<script src=${JSON.stringify(name)}></script>`).join("") +
  `<script src=${JSON.stringify(pathToFileURL(path.join(temp, "pond.js")).href)}></script>`;
fs.writeFileSync(path.join(temp, "test.html"), html);

app.whenReady().then(async () => {
  let win;
  try {
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/i.test(details.url) }));
    win = new BrowserWindow({ width: 320, height: 240, show: false, webPreferences: { backgroundThrottling: false } });
    await win.loadFile(path.join(temp, "test.html"));
    const result = await win.webContents.executeJavaScript(`(() => {
      if (typeof window.__seasonLeafProbe !== 'function') throw new Error('Leaf renderer did not load');
      let invisible = 0, changes = 0, overOne = 0;
      for (const target of ['autumn', 'winter']) {
        for (const fps of [30, 60]) {
          for (const hasDry of [true, false]) {
            let autumn = target === 'winter' ? 1 : 0, winter = 1 - autumn, previous = null;
            for (let i = 0; i < 600; i++) {
              const rate = 2.2 / fps;
              autumn += ((target === 'autumn' ? 1 : 0) - autumn) * rate;
              winter += ((target === 'winter' ? 1 : 0) - winter) * rate;
              if (autumn + winter > 1) overOne++;
              const sample = window.__seasonLeafProbe({ spring: 0, summer: 0, autumn, winter }, hasDry);
              const hidden = sample.alpha < 250;
              if (hidden) invisible++;
              if (previous !== null && previous !== hidden) changes++;
              previous = hidden;
            }
          }
        }
      }
      const aboveOne = window.__seasonLeafProbe({ spring: 0, summer: 0, autumn: 0.0046113562755536585, winter: 0.9953886437244465 }, true);
      return { invisible, changes, overOne, aboveOne };
    })()`);
    const ok = result.overOne > 0 && result.invisible === 0 && result.aboveOne.alpha === 255 &&
      result.aboveOne.appearance.alpha <= 1 && result.aboveOne.appearance.dry >= 0 && result.aboveOne.appearance.dry <= 1;
    console.log(JSON.stringify({ ok, software: process.argv.includes("--software"), temp, ...result }));
    if (win && !win.isDestroyed()) win.destroy();
    app.exit(ok ? 0 : 1);
  } catch (error) {
    console.error(String(error.stack || error));
    if (win && !win.isDestroyed()) win.destroy();
    app.exit(1);
  }
});
