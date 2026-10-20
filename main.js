const { app, BrowserWindow, Menu, session, ipcMain, Tray, globalShortcut, nativeImage, screen } = require("electron");
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

app.setPath("userData", path.join(app.getPath("appData"), "bitan-pond"));
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");

let win = null;
let tray = null;
let wallpaperOn = false;
let fullscreenFallback = false;
let savedStyle = null;
let savedEx = null;
let savedBounds = null;
let savedMaximized = false;
let toggleBusy = false;
let detachDone = false;

function psExe() {
  return path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

function scriptFile() {
  const dest = path.join(os.tmpdir(), "bitan-wallpaper.ps1");
  fs.copyFileSync(path.join(__dirname, "wallpaper.ps1"), dest);
  return dest;
}

function hwndOf(target) {
  const buf = target.getNativeWindowHandle();
  if (buf.length >= 8) return buf.readBigInt64LE(0).toString();
  return String(buf.readInt32LE(0));
}

function runPs(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(psExe(), [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy", "Bypass",
      "-File", scriptFile(),
      ...args,
    ], { windowsHide: true });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => { out += d.toString("utf8"); });
    child.stderr.on("data", (d) => { err += d.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (code) => {
      const line = out.trim().split(/\r?\n/).filter(Boolean).pop() || "";
      if (code !== 0 || line.startsWith("ERR")) reject(new Error((line || err || ("exit " + code)).trim()));
      else resolve(line);
    });
  });
}

function prefPath() {
  return path.join(app.getPath("userData"), "wallpaper.json");
}

function wallpaperBackup() {
  return path.join(app.getPath("userData"), "desktop-wallpaper.txt");
}

function readPref() {
  try {
    return JSON.parse(fs.readFileSync(prefPath(), "utf8")).on === true;
  } catch (err) {
    return false;
  }
}

function writePref(on) {
  try {
    fs.mkdirSync(path.dirname(prefPath()), { recursive: true });
    fs.writeFileSync(prefPath(), JSON.stringify({ on: !!on }));
  } catch (err) { /* ignore */ }
}

function makeIcon() {
  const size = 32;
  const buf = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  const r = size * 0.38;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dx = x - c;
      const dy = y - c;
      if (dx * dx + dy * dy <= r * r) {
        buf[i] = 0xb4;
        buf[i + 1] = 0xc2;
        buf[i + 2] = 0x4f;
        buf[i + 3] = 255;
      }
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

function refreshTrayMenu() {
  if (!tray) return;
  const on = wallpaperOn || fullscreenFallback;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: on ? "恢复窗口" : "铺到桌面", click: () => toggleWallpaper() },
    { type: "separator" },
    { label: "退出", click: () => app.quit() },
  ]));
}

function ensureTray() {
  if (tray) return;
  tray = new Tray(makeIcon());
  tray.setToolTip("鱼戏莲叶间 · 单击恢复窗口，或按 F11");
  const back = () => {
    if (wallpaperOn || fullscreenFallback) toggleWallpaper();
  };
  tray.on("click", back);
  tray.on("double-click", back);
  refreshTrayMenu();
}

function destroyTray() {
  if (!tray) return;
  tray.destroy();
  tray = null;
}

function primaryPixels() {
  const display = screen.getPrimaryDisplay();
  return {
    w: Math.max(1, Math.round(display.bounds.width * display.scaleFactor)),
    h: Math.max(1, Math.round(display.bounds.height * display.scaleFactor)),
  };
}

function parseOk(line) {
  const out = {};
  String(line).replace(/\b([a-zA-Z]+)=(-?\d+)/g, (_, key, value) => {
    out[key] = value;
    return _;
  });
  return out;
}

function sendState() {
  if (!win || win.isDestroyed()) return;
  const on = wallpaperOn || fullscreenFallback;
  win.webContents.send("wallpaper-state", on);
}

function registerWallpaperHotkey() {
  if (globalShortcut.isRegistered("F11")) return;
  globalShortcut.register("F11", () => toggleWallpaper());
}

function unregisterWallpaperHotkey() {
  if (globalShortcut.isRegistered("F11")) globalShortcut.unregister("F11");
}

function logWallpaperError(err) {
  try {
    fs.writeFileSync(path.join(app.getPath("userData"), "wallpaper-error.log"), String(err && err.stack || err));
  } catch (e) { /* ignore */ }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUnmaximize() {
  if (win.isFullScreen()) {
    await Promise.race([
      new Promise((resolve) => {
        win.once("leave-full-screen", resolve);
        win.setFullScreen(false);
      }),
      delay(800),
    ]);
  }
  if (win.isMaximized()) {
    await Promise.race([
      new Promise((resolve) => {
        win.once("unmaximize", resolve);
        win.unmaximize();
      }),
      delay(800),
    ]);
  }
}

function balloon(content) {
  if (!tray) return;
  tray.displayBalloon({ title: "鱼戏莲叶间", content });
}

let deskProc = null;
let deskBuf = "";
let deskOrigin = { x: 0, y: 0 };
let deskMovePending = null;
let deskMoveBusy = false;

const DESK_BOOT = `window.__desk=function(type,x,y,b){
  if(type==="leave"){
    var pond=document.getElementById("pond");
    if(pond) pond.dispatchEvent(new PointerEvent("pointerleave",{bubbles:true}));
    return;
  }
  var el=document.elementFromPoint(x,y);
  if(!el) return;
  var base={bubbles:true,cancelable:true,composed:true,clientX:x,clientY:y,button:b,view:window};
  if(type==="move"){
    el.dispatchEvent(new PointerEvent("pointermove",Object.assign({},base,{buttons:0})));
    el.dispatchEvent(new MouseEvent("mousemove",Object.assign({},base,{buttons:0})));
    return;
  }
  if(type==="down"){
    var down=Object.assign({},base,{buttons:b===2?2:1});
    el.dispatchEvent(new PointerEvent("pointerdown",down));
    el.dispatchEvent(new MouseEvent("mousedown",down));
    return;
  }
  if(type==="up"){
    el.dispatchEvent(new PointerEvent("pointerup",base));
    el.dispatchEvent(new MouseEvent("mouseup",base));
    if(b===2) el.dispatchEvent(new MouseEvent("contextmenu",base));
    else el.dispatchEvent(new MouseEvent("click",base));
    return;
  }
  if(type==="wheel"){
    el.dispatchEvent(new WheelEvent("wheel",Object.assign({},base,{deltaY:b})));
  }
};
undefined;`;

function installDeskClient() {
  if (!win || win.isDestroyed()) return Promise.resolve();
  return win.webContents.executeJavaScript(DESK_BOOT).catch(() => {});
}

function deskPoint(sx, sy) {
  const pt = screen.screenToDipPoint({ x: Number(sx) || 0, y: Number(sy) || 0 });
  const origin = screen.screenToDipPoint(deskOrigin);
  return [Math.round(pt.x - origin.x), Math.round(pt.y - origin.y)];
}

function hookExe() {
  const dir = app.getPath("userData");
  fs.mkdirSync(dir, { recursive: true });
  const exe = path.join(dir, "desk-input.exe");
  const src = path.join(__dirname, "desk-input.cs");
  const srcCopy = path.join(dir, "desk-input.cs");
  const stampPath = path.join(dir, "desk-input.stamp");
  const stamp = String(fs.statSync(src).mtimeMs) + ":" + fs.statSync(src).size;
  let stale = true;
  try {
    stale = !fs.existsSync(exe) || fs.readFileSync(stampPath, "utf8") !== stamp;
  } catch (err) { stale = true; }
  if (!stale) return exe;
  fs.copyFileSync(src, srcCopy);
  const csc = path.join(process.env.SystemRoot || "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
  const result = spawnSync(csc, ["/nologo", "/optimize+", "/out:" + exe, srcCopy], { windowsHide: true, timeout: 30000 });
  if (result.status !== 0) {
    throw new Error(((result.stdout && result.stdout.toString()) || "") + ((result.stderr && result.stderr.toString()) || "") || "编译桌面点击助手失败");
  }
  fs.writeFileSync(stampPath, stamp);
  return exe;
}

function stopDeskInput() {
  const proc = deskProc;
  deskProc = null;
  deskBuf = "";
  if (!proc) return;
  try { proc.kill(); } catch (err) { /* ignore */ }
}

function deskSend(type, x, y, extra) {
  if (!win || win.isDestroyed()) return;
  const js = "window.__desk&&window.__desk(" + JSON.stringify(type) + "," + (x | 0) + "," + (y | 0) + "," + (extra | 0) + ")";
  if (type !== "move") {
    win.webContents.executeJavaScript(js).catch(() => {});
    return;
  }
  deskMovePending = js;
  if (deskMoveBusy) return;
  const run = () => {
    if (!deskMovePending || !win || win.isDestroyed()) {
      deskMoveBusy = false;
      return;
    }
    const code = deskMovePending;
    deskMovePending = null;
    deskMoveBusy = true;
    win.webContents.executeJavaScript(code).catch(() => {}).then(run);
  };
  run();
}

function onDeskLine(line) {
  const parts = String(line).trim().split(/\s+/);
  if (!parts[0]) return;
  if (parts[0] === "ready" || parts[0] === "origin") {
    deskOrigin = { x: Number(parts[1]) || 0, y: Number(parts[2]) || 0 };
    return;
  }
  if (parts[0] === "leave") {
    deskSend("leave", 0, 0, 0);
    return;
  }
  const [x, y] = deskPoint(parts[1], parts[2]);
  if (parts[0] === "wheel") {
    const delta = Number(parts[3]) || 0;
    deskSend("wheel", x, y, delta > 0 ? -80 : 80);
    return;
  }
  deskSend(parts[0], x, y, Number(parts[3]) || 0);
}

function startDeskInput() {
  stopDeskInput();
  try {
    const exe = hookExe();
    deskProc = spawn(exe, [hwndOf(win), String(process.pid)], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    deskProc.stdout.setEncoding("utf8");
    deskProc.stdout.on("data", (chunk) => {
      deskBuf += chunk;
      let idx;
      while ((idx = deskBuf.indexOf("\n")) >= 0) {
        const line = deskBuf.slice(0, idx);
        deskBuf = deskBuf.slice(idx + 1);
        onDeskLine(line);
      }
    });
    deskProc.on("exit", () => {});
  } catch (err) {
    logWallpaperError(err);
  }
}

async function enterWallpaper() {
  savedBounds = win.getBounds();
  savedMaximized = win.isMaximized() || win.isFullScreen();
  await waitUnmaximize();
  win.setSkipTaskbar(true);
  win.setAlwaysOnTop(false);
  win.setMenuBarVisibility(false);
  const px = primaryPixels();
  const line = await runPs([
    "-Action", "attach",
    "-Hwnd", hwndOf(win),
    "-Width", String(px.w),
    "-Height", String(px.h),
    "-Backup", wallpaperBackup(),
  ]);
  const info = parseOk(line);
  savedStyle = info.style != null ? info.style : null;
  savedEx = info.ex != null ? info.ex : null;
  wallpaperOn = true;
  fullscreenFallback = false;
  detachDone = false;
  writePref(true);
  ensureTray();
  refreshTrayMenu();
  registerWallpaperHotkey();
  balloon("已铺在桌面。点空白处可以喂鱼、用右上角小记；快捷方式仍可点击。托盘图标或 F11 恢复窗口。");
  sendState();
  win.showInactive();
  win.webContents.executeJavaScript("window.dispatchEvent(new Event('resize'))").catch(() => {});
  await delay(220);
  await installDeskClient();
  startDeskInput();
}

async function enterFullscreenFallback() {
  fullscreenFallback = true;
  wallpaperOn = false;
  win.setFullScreen(true);
  win.setMenuBarVisibility(false);
  ensureTray();
  refreshTrayMenu();
  registerWallpaperHotkey();
  balloon("没能铺到桌面图标下面，已改为普通全屏。按 F11 恢复窗口。");
  sendState();
}

function detachSync() {
  stopDeskInput();
  if (detachDone || !wallpaperOn || savedStyle == null || !win || win.isDestroyed()) return;
  detachDone = true;
  wallpaperOn = false;
  spawnSync(psExe(), [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy", "Bypass",
    "-File", scriptFile(),
    "-Action", "detach",
    "-Hwnd", hwndOf(win),
    "-Style", String(savedStyle),
    "-Ex", String(savedEx == null ? "0" : savedEx),
    "-Backup", wallpaperBackup(),
  ], { windowsHide: true, timeout: 8000 });
}

async function leaveSpecial() {
  stopDeskInput();
  unregisterWallpaperHotkey();
  try {
    if (wallpaperOn && savedStyle != null) {
      const hwnd = hwndOf(win);
      const style = savedStyle;
      const ex = savedEx == null ? "0" : savedEx;
      wallpaperOn = false;
      detachDone = true;
      await runPs(["-Action", "detach", "-Hwnd", hwnd, "-Style", String(style), "-Ex", String(ex), "-Backup", wallpaperBackup()]);
      try { fs.unlinkSync(wallpaperBackup()); } catch (err) { /* ignore */ }
    }
    if (fullscreenFallback && !win.isDestroyed() && win.isFullScreen()) win.setFullScreen(false);
  } finally {
    fullscreenFallback = false;
    wallpaperOn = false;
    detachDone = false;
    savedStyle = null;
    savedEx = null;
    if (win && !win.isDestroyed()) {
      win.setSkipTaskbar(false);
      win.setMenuBarVisibility(false);
      if (savedMaximized) win.maximize();
      else if (savedBounds) win.setBounds(savedBounds);
      win.show();
      win.focus();
      sendState();
    }
    destroyTray();
    writePref(false);
  }
}

async function toggleWallpaper() {
  if (toggleBusy || !win || win.isDestroyed()) return { on: wallpaperOn || fullscreenFallback };
  toggleBusy = true;
  try {
    if (wallpaperOn || fullscreenFallback) {
      await leaveSpecial();
    } else {
      try {
        await enterWallpaper();
      } catch (err) {
        logWallpaperError(err);
        win.setSkipTaskbar(false);
        await enterFullscreenFallback();
      }
    }
    return { on: wallpaperOn || fullscreenFallback };
  } finally {
    setTimeout(() => { toggleBusy = false; }, 350);
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 680,
    title: "鱼戏莲叶间",
    backgroundColor: "#4fc2b4",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  win.webContents.setBackgroundThrottling(false);
  win.webContents.on("did-finish-load", () => { installDeskClient(); });

  win.once("ready-to-show", () => {
    if (readPref()) {
      win.show();
      toggleWallpaper();
    } else {
      win.maximize();
      win.show();
    }
  });

  win.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.key === "F11") {
      event.preventDefault();
      if (!wallpaperOn && !fullscreenFallback) toggleWallpaper();
    }
  });

  win.on("close", () => detachSync());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.loadFile(path.join(__dirname, "web", "index.html"));
}

// The portable launcher unpacks ~600 MB into %TEMP% on every start and only removes it on a clean exit,
// so shutdowns and killed processes leave copies behind until the system drive fills up.
async function sweepPortableLeftovers() {
  if (!process.env.PORTABLE_EXECUTABLE_FILE) return;
  // Electron's fs opens any app.asar it touches and keeps the handle, which would block deleting it.
  const ofs = require("original-fs");
  const tmp = os.tmpdir();
  const exeName = path.basename(process.execPath);
  const mine = path.dirname(process.execPath).toLowerCase();
  const has = (...parts) => ofs.existsSync(path.join(...parts));
  // This launch's own staging folder is created just before we start; anything that recent is left alone.
  const cutoff = Date.now() - process.uptime() * 1000 - 5 * 60 * 1000;
  let entries = [];
  try { entries = await ofs.promises.readdir(tmp, { withFileTypes: true }); } catch (err) { return; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(tmp, entry.name);
    if (mine.startsWith(dir.toLowerCase())) continue;
    const unpacked = has(dir, exeName) && has(dir, "resources", "app.asar");
    const staging = has(dir, "app-64.7z") && has(dir, "7z-out", exeName);
    if (!unpacked && !staging) continue;
    try {
      const st = await ofs.promises.stat(dir);
      if (Math.max(st.birthtimeMs, st.mtimeMs) > cutoff) continue;
    } catch (err) { continue; }
    if (unpacked) {
      // A running exe cannot be opened for writing, so this skips folders another live instance is using.
      try { ofs.closeSync(ofs.openSync(path.join(dir, exeName), "r+")); } catch (err) { continue; }
    }
    try { await ofs.promises.rm(dir, { recursive: true, force: true, maxRetries: 1 }); } catch (err) { /* ignore */ }
  }
}

ipcMain.handle("wallpaper:toggle", () => toggleWallpaper());
ipcMain.handle("wallpaper:state", () => ({ on: wallpaperOn || fullscreenFallback }));

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === "geolocation");
  });
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    const url = details.url || "";
    if (url.startsWith("https://api.open-meteo.com/") || url.startsWith("https://geocoding-api.open-meteo.com/") || url.startsWith("https://ipwho.is/")) {
      headers["access-control-allow-origin"] = ["*"];
    }
    callback({ responseHeaders: headers });
  });
  createWindow();
  setTimeout(() => { sweepPortableLeftovers().catch(() => {}); }, 8000);
});


function restoreDesktopWallpaperSync() {
  try {
    if (!fs.existsSync(wallpaperBackup())) return false;
    const result = spawnSync(psExe(), [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy", "Bypass",
      "-File", scriptFile(),
      "-Action", "restore",
      "-Backup", wallpaperBackup(),
    ], { windowsHide: true, timeout: 15000, encoding: "utf8" });
    return result.status === 0 && String(result.stdout || "").indexOf("OK") >= 0;
  } catch (err) {
    logWallpaperError(err);
    return false;
  }
}

app.on("before-quit", () => {
  unregisterWallpaperHotkey();
  detachSync();
});

app.on("will-quit", () => {
  if (restoreDesktopWallpaperSync()) {
    try { fs.unlinkSync(wallpaperBackup()); } catch (err) { /* ignore */ }
  }
});

app.on("window-all-closed", () => app.quit());
