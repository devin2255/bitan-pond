const { app, BrowserWindow, Menu, session, ipcMain, Tray, globalShortcut, nativeImage, screen, dialog, net, shell } = require("electron");
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { createStabilizer } = require("./media-monitor");
const { createBeatTracker } = require("./music-beat");
const { checkForUpdate, downloadUpdate } = require("./updater");

app.setName("塘里");
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
let musicWatcher = null;
let musicRetry = null;
let musicStopping = false;
let musicState = { available: false, playing: false };
const musicStable = createStabilizer();
let rhythmEnabled = false;
let rhythmProc = null;
let rhythmRetry = null;
let updatePhase = "idle";
let updatePercent = 0;
let updateRelease = null;
let updateDownload = null;
let lastNotifiedUpdate = null;
let updateStartupTimer = null;
let updateInterval = null;
let trayMonitor = null;

function rhythmExe() {
  const dir = app.getPath("userData");
  const source = fs.readFileSync(path.join(__dirname, "music-beat.cs"));
  const stamp = crypto.createHash("sha256").update(source).digest("hex").slice(0, 12);
  const exe = path.join(dir, "music-beat-" + stamp + ".exe");
  if (fs.existsSync(exe)) return exe;
  fs.mkdirSync(dir, { recursive: true });
  const sourceCopy = path.join(dir, "music-beat-" + stamp + ".cs");
  fs.writeFileSync(sourceCopy, source);
  const csc = path.join(process.env.SystemRoot || "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
  const result = spawnSync(csc, ["/nologo", "/optimize+", "/target:exe", "/out:" + exe, sourceCopy], { windowsHide: true, timeout: 30000 });
  if (result.error || result.status !== 0) throw result.error || new Error("Audio level helper could not be compiled");
  return exe;
}

function stopRhythmCapture() {
  if (rhythmRetry) { clearTimeout(rhythmRetry); rhythmRetry = null; }
  const proc = rhythmProc; rhythmProc = null;
  if (proc) { try { proc.kill(); } catch (_) { /* Already stopped. */ } }
}

function startRhythmCapture() {
  if (musicStopping || rhythmProc || rhythmRetry || !rhythmEnabled || !musicState.playing || process.platform !== "win32") return;
  let exe;
  try { exe = rhythmExe(); }
  catch (_) { rhythmRetry = setTimeout(() => { rhythmRetry = null; startRhythmCapture(); }, 15000); return; }
  const tracker = createBeatTracker();
  const proc = spawn(exe, [String(process.pid)], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
  rhythmProc = proc;
  let buffer = "";
  proc.stdout.setEncoding("utf8");
  proc.stdout.on("data", (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1);
      const parts = line.split(/\s+/);
      if (parts.length !== 3) continue;
      const event = tracker.update(Number(parts[1]), Number(parts[2]), Number(parts[0]));
      if (event && rhythmEnabled && musicState.playing && win && !win.isDestroyed()) win.webContents.send("system-music-beat", event);
    }
  });
  proc.on("error", () => {});
  proc.on("close", () => {
    if (rhythmProc !== proc) return;
    rhythmProc = null;
    if (!musicStopping && rhythmEnabled && musicState.playing) {
      rhythmRetry = setTimeout(() => { rhythmRetry = null; startRhythmCapture(); }, 5000);
    }
  });
}

function publishMusicState(available, playing) {
  if (musicState.available === available && musicState.playing === playing) return;
  musicState = { available, playing };
  if (win && !win.isDestroyed()) win.webContents.send("system-music-state", musicState);
  if (playing) startRhythmCapture(); else stopRhythmCapture();
}

function startMusicWatcher() {
  if (musicStopping || process.platform !== "win32") return;
  let script;
  try { script = fs.readFileSync(path.join(__dirname, "media-watch.ps1"), "utf8"); }
  catch (_) { publishMusicState(false, false); return; }
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const proc = spawn(psExe(), ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
    { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
  musicWatcher = proc;
  let buffer = "";
  proc.stdout.setEncoding("utf8");
  proc.stdout.on("data", (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).trim(); buffer = buffer.slice(index + 1);
      if (line === "0" || line === "1") publishMusicState(true, musicStable.update(line === "1", Date.now()));
      else if (line === "unavailable") publishMusicState(false, false);
    }
  });
  proc.on("error", () => {});
  proc.on("close", () => {
    if (musicWatcher !== proc) return;
    musicWatcher = null;
    musicStable.reset();
    publishMusicState(false, false);
    if (!musicStopping) musicRetry = setTimeout(startMusicWatcher, 15000);
  });
}

function stopMusicWatcher() {
  musicStopping = true;
  stopRhythmCapture();
  if (musicRetry) clearTimeout(musicRetry);
  if (musicWatcher) { try { musicWatcher.kill(); } catch (_) { /* Already stopped. */ } }
}

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
      // A small koi keeps the icon recognizable against the Windows taskbar.
      const fish = ((x - 16) / 7.2) ** 2 + ((y - 16) / 3.6) ** 2 <= 1;
      const tail = x >= 6 && x <= 10 && Math.abs(y - 16) <= (10 - x);
      if (fish || tail) {
        buf[i] = 0xef; buf[i + 1] = 0xf8; buf[i + 2] = 0xfa; buf[i + 3] = 255;
        if (fish && x >= 19) { buf[i] = 0x48; buf[i + 1] = 0x68; buf[i + 2] = 0xea; }
      }
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

function refreshTrayMenu() {
  if (!tray) return;
  const on = wallpaperOn || fullscreenFallback;
  const updateLabel = updatePhase === "checking" ? "正在检查更新…" :
    updatePhase === "downloading" ? `正在下载更新 ${updatePercent}%` :
    updatePhase === "ready" || updatePhase === "confirming" ? `安装更新 v${updateDownload.version}…` : "检查更新…";
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: on ? "恢复窗口" : "铺到桌面", click: () => toggleWallpaper() },
    { label: updateLabel, enabled: !["checking", "downloading", "prompting", "confirming"].includes(updatePhase), click: () => checkUpdates(true) },
    { label: `当前版本 ${app.getVersion()}`, enabled: false },
    { type: "separator" },
    { label: "退出", click: () => app.quit() },
  ]));
}

function ensureTray() {
  if (tray && !tray.isDestroyed()) return;
  try {
    tray = new Tray(makeIcon());
    tray.setToolTip("塘里 · 单击打开窗口，右键查看菜单");
    const back = () => {
      if (wallpaperOn || fullscreenFallback) toggleWallpaper();
      else if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
    };
    tray.on("click", back);
    refreshTrayMenu();
  } catch (error) { tray = null; logWallpaperError(error); }
}

function destroyTray() {
  if (!tray) return;
  tray.destroy();
  tray = null;
}

function setUpdatePhase(phase, percent = 0) {
  updatePhase = phase;
  updatePercent = percent;
  refreshTrayMenu();
}

function portableExecutable() {
  const file = process.env.PORTABLE_EXECUTABLE_FILE;
  if (!app.isPackaged || process.platform !== "win32" || !file || !path.isAbsolute(file) || path.extname(file).toLowerCase() !== ".exe") return null;
  try { return fs.statSync(file).isFile() ? path.resolve(file) : null; } catch (_) { return null; }
}

async function message(options) {
  return dialog.showMessageBox({ title: "塘里", ...options });
}

function markUpdateReady() {
  const argument = process.argv.find((value) => /^--tangli-update-ready=[a-f0-9]{32}$/.test(value));
  if (!argument) return;
  const token = argument.slice(argument.indexOf("=") + 1);
  try { fs.writeFileSync(path.join(os.tmpdir(), `tangli-update-ready-${token}.ok`), "ready", { flag: "wx" }); } catch (_) { /* The updater retains the backup if confirmation fails. */ }
}

async function installDownloadedUpdate() {
  if (!updateDownload || updatePhase !== "ready") return;
  const target = portableExecutable();
  if (!target) {
    await message({ type: "info", message: "当前运行方式不支持替换程序", detail: "请打开发行页面下载 Windows 便携版。", buttons: ["打开下载页面", "取消"], cancelId: 1 }).then((answer) => {
      if (answer.response === 0 && updateRelease) return shell.openExternal(updateRelease.releaseURL);
    });
    return;
  }
  try {
    // Test the actual destination directory before closing the application.
    const probe = path.join(path.dirname(target), `.tangli-write-${crypto.randomBytes(12).toString("hex")}`);
    const handle = await fs.promises.open(probe, "wx");
    await handle.close();
    await fs.promises.unlink(probe);
    const helper = path.join(updateDownload.dir, "portable-update.ps1");
    await fs.promises.copyFile(path.join(__dirname, "portable-update.ps1"), helper);
    const token = crypto.randomBytes(16).toString("hex");
    const child = spawn(psExe(), ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", helper,
      "-ParentId", String(process.pid), "-Source", updateDownload.file, "-Target", target,
      "-Sha256", updateDownload.sha256, "-ReadyToken", token],
    { detached: true, windowsHide: true, stdio: "ignore" });
    await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
    child.unref();
    app.quit();
  } catch (error) {
    await message({ type: "error", message: "无法安装更新", detail: `原程序没有改变。请检查程序所在目录是否有写入权限。\n${error.message}`, buttons: ["知道了"] });
  }
}

async function offerInstall() {
  if (!updateDownload) return;
  setUpdatePhase("confirming");
  const answer = await message({ type: "info", message: `塘里 v${updateDownload.version} 已下载`,
    detail: "更新包已完成校验。重启后会替换当前便携版，并保留池塘设置。", buttons: ["立即重启并更新", "稍后"], defaultId: 0, cancelId: 1 });
  setUpdatePhase("ready");
  if (answer.response === 0) await installDownloadedUpdate();
}

async function checkUpdates(interactive = false) {
  if (updatePhase === "ready") { if (interactive) await offerInstall(); return; }
  if (["prompting", "confirming"].includes(updatePhase)) return;
  if (updatePhase === "checking" || updatePhase === "downloading") {
    if (interactive) await message({ type: "info", message: updatePhase === "checking" ? "正在检查更新" : `正在下载更新（${updatePercent}%）`, buttons: ["知道了"] });
    return;
  }
  setUpdatePhase("checking");
  let downloading = false;
  try {
    const release = await checkForUpdate((url, options) => net.fetch(url, options), app.getVersion());
    if (!release) {
      setUpdatePhase("idle");
      if (interactive) await message({ type: "info", message: "当前已是最新版本", detail: `当前版本：${app.getVersion()}`, buttons: ["知道了"] });
      return;
    }
    updateRelease = release;
    setUpdatePhase("available");
    if (!interactive && lastNotifiedUpdate === release.version) return;
    lastNotifiedUpdate = release.version;
    const portable = portableExecutable();
    setUpdatePhase("prompting");
    const answer = await message({ type: "info", message: `发现新版本 v${release.version}`,
      detail: portable ? "可在线下载并在重启后更新。下载前不会修改当前程序。" : "当前运行方式不支持自动替换，可打开发行页面下载便携版。",
      buttons: [portable ? "下载更新" : "打开下载页面", "稍后"], defaultId: 0, cancelId: 1 });
    if (answer.response !== 0) { setUpdatePhase("available"); return; }
    if (!portable) { setUpdatePhase("available"); await shell.openExternal(release.releaseURL); return; }
    downloading = true;
    setUpdatePhase("downloading");
    balloon("正在下载更新，右键托盘图标可以查看进度。");
    updateDownload = await downloadUpdate((url, options) => net.fetch(url, options), release, {
      onProgress: (percent) => setUpdatePhase("downloading", percent),
    });
    setUpdatePhase("ready");
    await offerInstall();
  } catch (error) {
    setUpdatePhase("idle");
    if (interactive || downloading) await message({ type: "error", message: "更新未完成", detail: `原程序没有改变。请检查网络后重试。\n${error.message}`, buttons: ["知道了"] });
  }
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
  tray.displayBalloon({ title: "塘里", content });
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
  // Maximizing preserves access to the Windows taskbar when desktop attachment fails.
  win.setSkipTaskbar(false);
  win.maximize();
  win.setMenuBarVisibility(false);
  ensureTray();
  refreshTrayMenu();
  registerWallpaperHotkey();
  balloon("没能铺到桌面图标下面，已最大化窗口并保留任务栏。按 F11 恢复窗口。");
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
    if (fullscreenFallback && !win.isDestroyed()) {
      if (win.isFullScreen()) win.setFullScreen(false);
      if (!savedMaximized && win.isMaximized()) await waitUnmaximize();
    }
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
    refreshTrayMenu();
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
    title: "塘里",
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
    markUpdateReady();
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
ipcMain.handle("update:check", () => checkUpdates(true));
ipcMain.handle("music:state", () => musicState);
ipcMain.handle("music:rhythm-enabled", (_event, enabled) => {
  rhythmEnabled = !!enabled;
  if (rhythmEnabled) startRhythmCapture(); else stopRhythmCapture();
  return rhythmEnabled;
});

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
  ensureTray();
  trayMonitor = setInterval(ensureTray, 30000);
  createWindow();
  startMusicWatcher();
  if (app.isPackaged) {
    updateStartupTimer = setTimeout(() => checkUpdates(false), 20000);
    updateInterval = setInterval(() => checkUpdates(false), 6 * 60 * 60 * 1000);
  }
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
  if (updateStartupTimer) clearTimeout(updateStartupTimer);
  if (updateInterval) clearInterval(updateInterval);
  if (trayMonitor) clearInterval(trayMonitor);
  stopMusicWatcher();
  unregisterWallpaperHotkey();
  detachSync();
});

app.on("will-quit", () => {
  destroyTray();
  if (restoreDesktopWallpaperSync()) {
    try { fs.unlinkSync(wallpaperBackup()); } catch (err) { /* ignore */ }
  }
});

app.on("window-all-closed", () => app.quit());
