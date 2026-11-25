const { app, BrowserWindow, Menu, session, ipcMain, Tray, globalShortcut, nativeImage, screen, dialog, net, shell } = require("electron");
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { createStabilizer } = require("./media-monitor");
const { createBeatTracker } = require("./music-beat");
const { checkForUpdate, downloadUpdate } = require("./updater");
const { waitForUpdaterHandoff } = require("./update-handoff");
const { createUpdaterLaunch } = require("./update-launch");
const { matchDisplays, targetAt, normalizedPoint } = require("./desktop-layout");
const { createDock } = require("./dock/controller");

app.setName("塘里");
const testUserData = process.env.TANGLI_TEST_MODE === "1" && process.env.TANGLI_TEST_USER_DATA;
app.setPath("userData", testUserData && path.isAbsolute(testUserData) ? path.resolve(testUserData) : path.join(app.getPath("appData"), "bitan-pond"));
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");

let win = null;
let tray = null;
let wallpaperOn = false;
let fullscreenFallback = false;
let savedBounds = null;
let savedMaximized = false;
let savedMinimumSize = null;
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
let applicationQuitting = false;
let dockTools = null;
let pondHour = null;
const wallpaperWindows = new Map();
let wallpaperStarting = false;
let dockDesktopShown = false;
let displayRefreshTimer = null;
let displayRefreshBusy = false;
let deskHover = null;
const previewState = { weather: "auto", season: "auto", time: "auto", moon: "auto", music: "auto" };

function broadcast(channel, value) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(channel, value);
  }
}

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
      if (event && rhythmEnabled && musicState.playing) broadcast("system-music-beat", event);
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
  broadcast("system-music-state", musicState);
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
  const source = fs.readFileSync(path.join(__dirname, "wallpaper.ps1"));
  const stamp = crypto.createHash("sha256").update(source).digest("hex").slice(0, 16);
  const dest = path.join(os.tmpdir(), "bitan-wallpaper-" + stamp + ".ps1");
  if (!fs.existsSync(dest)) {
    try { fs.writeFileSync(dest, source, { flag: "wx" }); }
    catch (error) { if (error.code !== "EEXIST") throw error; }
  }
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

let cachedAppIcon = null;
function appIcon() {
  if (!cachedAppIcon) {
    // Read through Electron's asar-aware filesystem, including in portable builds.
    cachedAppIcon = nativeImage.createFromBuffer(fs.readFileSync(path.join(__dirname, "assets", "tangli-icon.png")));
    if (cachedAppIcon.isEmpty()) throw new Error("塘里应用图标加载失败");
  }
  return cachedAppIcon;
}

function makeIcon() {
  return appIcon().resize({ width: 32, height: 32, quality: "best" });
}

function refreshTrayMenu() {
  if (!tray) return;
  const on = wallpaperOn || fullscreenFallback;
  const dockState = dockTools?.state();
  const updateLabel = updatePhase === "checking" ? "正在检查更新…" :
    updatePhase === "downloading" ? `正在下载更新 ${updatePercent}%` :
    updatePhase === "installing" ? "正在启动更新…" :
    updatePhase === "ready" || updatePhase === "confirming" ? `安装更新 v${updateDownload.version}…` : "检查更新…";
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: on ? "恢复窗口" : "铺到桌面", click: () => toggleWallpaper() },
    ...(dockState ? [
      { type: "checkbox", label: "启用塘里 Dock", checked: dockState.settings.enabled, click: (item) => {
        try { dockTools.setEnabled(item.checked); }
        catch (error) { dockTools.report(error); balloon(error.message); refreshTrayMenu(); }
      } },
      { label: "Dock 设置", click: () => dockTools.showSettings() },
      { label: "全盘搜索", click: () => dockTools.showSearch() },
      ...(dockState.takeover ? [{ label: "恢复 Windows 任务栏", click: dockTools.stopGuard }] : []),
      { type: "separator" },
    ] : []),
    { label: updateLabel, enabled: !["checking", "downloading", "prompting", "confirming", "installing"].includes(updatePhase), click: () => checkUpdates(true) },
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

function updateReadyToken() {
  const argument = process.argv.find((value) => /^--tangli-update-ready=[a-f0-9]{32}$/.test(value));
  return argument ? argument.slice(argument.indexOf("=") + 1) : null;
}

function programsDirectory() {
  if (process.env.TANGLI_TEST_MODE === "1" && process.env.TANGLI_TEST_PROGRAMS && path.isAbsolute(process.env.TANGLI_TEST_PROGRAMS)) {
    return path.resolve(process.env.TANGLI_TEST_PROGRAMS);
  }
  const result = spawnSync(psExe(), ["-NoProfile", "-NonInteractive", "-Command",
    '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; [Environment]::GetFolderPath("Programs")'],
  { windowsHide: true, encoding: "utf8", timeout: 8000 });
  const directory = String(result.stdout || "").trim();
  if (result.status !== 0 || !path.isAbsolute(directory)) throw new Error("无法定位开始菜单目录");
  return directory;
}

function ensureUpdatedPortableShortcut() {
  const executable = portableExecutable();
  if (!executable || !updateReadyToken()) return;
  if (fs.existsSync(path.join(path.dirname(executable), "tangli-install.marker"))) return;
  try {
    const directory = programsDirectory();
    const shortcut = path.join(directory, "塘里 - 便携版.lnk");
    // Never replace an existing shortcut. The previous portable filename is
    // updated in place, so a shortcut already pointing to it remains valid.
    if (fs.existsSync(shortcut)) return;
    fs.mkdirSync(directory, { recursive: true });
    if (!shell.writeShortcutLink(shortcut, "create", { target: executable, cwd: path.dirname(executable),
      description: "塘里桌面池塘（便携版）", icon: executable, iconIndex: 0 })) throw new Error("无法创建开始菜单快捷方式");
  } catch (error) { logWallpaperError(error); }
}

async function installDownloadedUpdate() {
  if (!updateDownload || updatePhase !== "ready") return;
  setUpdatePhase("installing");
  const target = portableExecutable();
  if (!target) {
    setUpdatePhase("ready");
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
    const handoff = path.join(updateDownload.dir, `handoff-${token}.txt`);
    const cancel = path.join(updateDownload.dir, `cancel-${token}.txt`);
    const commit = path.join(updateDownload.dir, `commit-${token}.txt`);
    const launch = createUpdaterLaunch(psExe(), helper, {
      ParentId: process.pid, Source: updateDownload.file, Target: target,
      Sha256: updateDownload.sha256, ReadyToken: token, HandoffFile: handoff, CancelFile: cancel, CommitFile: commit,
      StatusFile: path.join(app.getPath("userData"), "update-status.json"),
    });
    // Retain the helper's diagnostics if Windows rejects its startup.
    const log = fs.openSync(path.join(app.getPath("userData"), "update-helper.log"), "w");
    let child;
    try {
      child = spawn(launch.executable, launch.args, { detached: true, windowsHide: true,
        windowsVerbatimArguments: true, cwd: app.getPath("userData"), env: launch.env, stdio: ["ignore", log, log] });
    } finally { fs.closeSync(log); }
    await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
    try {
      await waitForUpdaterHandoff(child, handoff, token);
      await fs.promises.writeFile(commit, token, { encoding: "ascii", flag: "wx" });
    }
    catch (error) {
      await fs.promises.writeFile(cancel, token, "ascii").catch(() => {});
      try { child.kill(); } catch (_) {}
      throw error;
    }
    child.unref();
    app.quit();
  } catch (error) {
    setUpdatePhase("ready");
    const answer = await message({ type: "error", message: "更新助手未能启动",
      detail: `当前版本仍在运行。可以稍后重试，或手动下载安装包。\n${error.message}\n日志：${path.join(app.getPath("userData"), "update-helper.log")}`,
      buttons: updateRelease ? ["打开下载页面", "稍后"] : ["知道了"], cancelId: updateRelease ? 1 : 0 });
    if (answer.response === 0 && updateRelease) await shell.openExternal(updateRelease.releaseURL);
  }
}

async function offerInstall() {
  if (!updateDownload) return;
  setUpdatePhase("confirming");
  const answer = await message({ type: "info", message: `塘里 v${updateDownload.version} 已下载`,
    detail: "更新包已完成校验。重启后会更新当前程序，并保留池塘设置。", buttons: ["立即重启并更新", "稍后"], defaultId: 0, cancelId: 1 });
  setUpdatePhase("ready");
  if (answer.response === 0) await installDownloadedUpdate();
}

async function checkUpdates(interactive = false) {
  if (updatePhase === "ready") { if (interactive) await offerInstall(); return; }
  if (["prompting", "confirming"].includes(updatePhase)) return;
  if (["checking", "downloading", "installing"].includes(updatePhase)) {
    if (interactive) await message({ type: "info", message: updatePhase === "checking" ? "正在检查更新" :
      updatePhase === "installing" ? "正在启动更新，请稍候" : `正在下载更新（${updatePercent}%）`, buttons: ["知道了"] });
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

function parseOk(line) {
  const out = {};
  String(line).replace(/\b([a-zA-Z]+)=(-?\d+)/g, (_, key, value) => {
    out[key] = value;
    return _;
  });
  return out;
}

function sendState() {
  broadcast("wallpaper-state", wallpaperOn || fullscreenFallback || wallpaperStarting);
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
let deskRetry = null;
let deskFailures = 0;

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

function installDeskClient(target = win) {
  if (!target || target.isDestroyed()) return Promise.resolve();
  return target.webContents.executeJavaScript(DESK_BOOT).catch(() => {});
}

function hookExe() {
  const dir = app.getPath("userData");
  fs.mkdirSync(dir, { recursive: true });
  const source = fs.readFileSync(path.join(__dirname, "desk-input.cs"));
  const stamp = crypto.createHash("sha256").update(source).digest("hex").slice(0, 16);
  const exe = path.join(dir, "desk-input-" + stamp + ".exe");
  if (fs.existsSync(exe)) return exe;
  // Compile a new filename so a previous version's running hook never locks
  // the executable needed by an update.
  const tempBase = path.join(dir, "desk-input-build-" + stamp + "-" + process.pid);
  const srcCopy = tempBase + ".cs", tempExe = tempBase + ".exe";
  fs.writeFileSync(srcCopy, source);
  const csc = path.join(process.env.SystemRoot || "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
  try {
    const result = spawnSync(csc, ["/nologo", "/optimize+", "/out:" + tempExe, srcCopy], { windowsHide: true, timeout: 30000 });
    if (result.status !== 0) throw new Error(((result.stdout && result.stdout.toString()) || "") + ((result.stderr && result.stderr.toString()) || "") || "编译桌面点击助手失败");
    try { fs.renameSync(tempExe, exe); }
    catch (error) { if (!fs.existsSync(exe)) throw error; }
  } finally {
    try { fs.unlinkSync(srcCopy); } catch (_) { /* Only our temporary build files are removed. */ }
    try { fs.unlinkSync(tempExe); } catch (_) { /* The file was renamed or never created. */ }
  }
  return exe;
}

function stopDeskInput() {
  if (deskRetry) { clearTimeout(deskRetry); deskRetry = null; }
  const proc = deskProc;
  deskProc = null;
  deskBuf = "";
  deskHover = null;
  if (!proc) return;
  try { proc.kill(); } catch (err) { /* ignore */ }
}

function retryDeskInput(error) {
  if (error) logWallpaperError(error);
  if (!wallpaperOn || deskRetry) return;
  const wait = Math.min(30000, 2000 * (1 + deskFailures++));
  deskRetry = setTimeout(() => { deskRetry = null; if (wallpaperOn) startDeskInput(); }, wait);
}

function deskSend(entry, type, x, y, extra) {
  if (!entry || !entry.window || entry.window.isDestroyed()) return;
  const target = entry.window;
  const js = "window.__desk&&window.__desk(" + JSON.stringify(type) + "," + Number(x) + "*innerWidth," + Number(y) + "*innerHeight," + (extra | 0) + ")";
  if (type !== "move") {
    target.webContents.executeJavaScript(js).catch(() => {});
    return;
  }
  entry.movePending = js;
  if (entry.moveBusy) return;
  const run = () => {
    if (!entry.movePending || target.isDestroyed()) {
      entry.moveBusy = false;
      return;
    }
    const code = entry.movePending;
    entry.movePending = null;
    entry.moveBusy = true;
    target.webContents.executeJavaScript(code).catch(() => {}).then(run);
  };
  run();
}

function onDeskLine(line) {
  const parts = String(line).trim().split(/\s+/);
  if (!parts[0]) return;
  if (parts[0] === "ready") { deskFailures = 0; return; }
  if (parts[0] === "origin") return;
  if (parts[0] === "leave") {
    if (deskHover) { deskHover.movePending = null; deskSend(deskHover, "leave", 0, 0, 0); deskHover = null; }
    return;
  }
  const sx = Number(parts[1]), sy = Number(parts[2]);
  if (!Number.isFinite(sx) || !Number.isFinite(sy)) return;
  const entry = targetAt([...wallpaperWindows.values()], sx, sy);
  if (entry !== deskHover) {
    if (deskHover) { deskHover.movePending = null; deskSend(deskHover, "leave", 0, 0, 0); }
    deskHover = entry;
  }
  if (!entry) return;
  const [x, y] = normalizedPoint(entry.rect, sx, sy);
  if (parts[0] === "wheel") {
    const delta = Number(parts[3]) || 0;
    deskSend(entry, "wheel", x, y, delta > 0 ? -80 : 80);
    return;
  }
  deskSend(entry, parts[0], x, y, Number(parts[3]) || 0);
}

function startDeskInput() {
  stopDeskInput();
  try {
    const exe = hookExe();
    const entries = [...wallpaperWindows.values()].filter((entry) => !entry.window.isDestroyed());
    if (!entries.length) return;
    const screens = entries.map(({ window, rect }) => [hwndOf(window), rect.x, rect.y, rect.width, rect.height].join(",")).join(";");
    const proc = spawn(exe, [hwndOf(entries[0].window), String(process.pid), screens], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    deskProc = proc;
    let errorOutput = "";
    proc.stderr.on("data", (chunk) => { errorOutput = (errorOutput + chunk.toString("utf8")).slice(-4000); });
    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (chunk) => {
      if (deskProc !== proc) return;
      deskBuf += chunk;
      let idx;
      while ((idx = deskBuf.indexOf("\n")) >= 0) {
        const line = deskBuf.slice(0, idx);
        deskBuf = deskBuf.slice(idx + 1);
        onDeskLine(line);
      }
    });
    proc.on("error", (error) => { if (deskProc === proc) { deskProc = null; retryDeskInput(error); } });
    proc.on("exit", (code) => { if (deskProc === proc) {
      deskProc = null;
      retryDeskInput(new Error("桌面交互助手已退出 (" + code + ") " + errorOutput));
    } });
  } catch (err) {
    retryDeskInput(err);
  }
}

async function getWallpaperDisplays() {
  const line = await runPs(["-Action", "monitors"]);
  if (!line.startsWith("OK displays=")) throw new Error("Cannot enumerate Windows monitors: " + line);
  const monitors = line.slice("OK displays=".length).split(";").map((part) => {
    const [x, y, width, height] = part.split(",").map(Number);
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) throw new Error("Invalid monitor bounds");
    return { x, y, width, height };
  });
  const displays = matchDisplays(screen.getAllDisplays(), monitors, (point) => screen.dipToScreenPoint(point));
  const primary = screen.getPrimaryDisplay().id;
  displays.sort((a, b) => (a.id === primary ? -1 : 0) - (b.id === primary ? -1 : 0));
  return displays;
}

function positionArgs(rect) {
  return ["-Left", String(rect.x), "-Top", String(rect.y), "-Width", String(rect.width), "-Height", String(rect.height)];
}

function actualRect(info) {
  return { x: Number(info.x), y: Number(info.y), width: Number(info.w), height: Number(info.h) };
}

function checkPosition(actual, expected) {
  if (["x", "y", "width", "height"].some((key) => !Number.isFinite(actual[key]) || Math.abs(actual[key] - expected[key]) > 2)) {
    throw new Error("Desktop window does not cover its monitor: " + JSON.stringify({ actual, expected }));
  }
}

async function attachWallpaperWindow(target, display) {
  const line = await runPs(["-Action", "attach", "-Hwnd", hwndOf(target), ...positionArgs(display.rect)]);
  const info = parseOk(line);
  if (info.style == null || info.ex == null) throw new Error("Missing desktop window style: " + line);
  const entry = { id: display.id, window: target, style: info.style, ex: info.ex, rect: actualRect(info), bounds: display.bounds };
  try { checkPosition(entry.rect, display.rect); }
  catch (error) { await detachWallpaperWindow(entry); throw error; }
  wallpaperWindows.set(display.id, entry);
  await installDeskClient(target);
  target.webContents.executeJavaScript("window.dispatchEvent(new Event('resize'))").catch(() => {});
  return entry;
}

async function detachWallpaperWindow(entry) {
  if (!entry || !entry.window || entry.window.isDestroyed()) return;
  await runPs(["-Action", "detach", "-Hwnd", hwndOf(entry.window), "-Style", String(entry.style), "-Ex", String(entry.ex), "-NoRestore"]);
}

async function createWallpaperWindow(display) {
  const target = new BrowserWindow({
    ...display.bounds, frame: false, show: false, skipTaskbar: true, focusable: false,
    backgroundColor: "#4fc2b4", autoHideMenuBar: true, icon: appIcon(),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true,
      nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  target.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  try {
    await target.loadFile(path.join(__dirname, "web", "index.html"));
    await attachWallpaperWindow(target, display);
    // Native ShowWindow alone does not update Chromium's own window lifecycle.
    // Explicitly show each additional renderer, then restore desktop z-order.
    target.showInactive();
    await moveWallpaperWindow(wallpaperWindows.get(display.id), display);
    return target;
  } catch (error) {
    if (!target.isDestroyed()) target.destroy();
    throw error;
  }
}

async function moveWallpaperWindow(entry, display) {
  const info = parseOk(await runPs(["-Action", "move", "-Hwnd", hwndOf(entry.window), ...positionArgs(display.rect)]));
  const rect = actualRect(info);
  checkPosition(rect, display.rect);
  entry.rect = rect;
  entry.bounds = display.bounds;
  entry.window.webContents.executeJavaScript("window.dispatchEvent(new Event('resize'))").catch(() => {});
}

async function clearWallpaperWindows() {
  const entries = [...wallpaperWindows.values()];
  wallpaperWindows.clear();
  for (const entry of entries) {
    try { await detachWallpaperWindow(entry); } catch (error) { logWallpaperError(error); }
    if (entry.window !== win && !entry.window.isDestroyed()) entry.window.destroy();
  }
}

async function enterWallpaper() {
  savedBounds = win.getBounds();
  savedMaximized = win.isMaximized() || win.isFullScreen();
  savedMinimumSize = win.getMinimumSize();
  await waitUnmaximize();
  // A smaller external or laptop display must not inherit the normal window's
  // minimum size. Restore it when leaving desktop mode.
  win.setMinimumSize(1, 1);
  win.setSkipTaskbar(true);
  win.setAlwaysOnTop(false);
  win.setMenuBarVisibility(false);
  wallpaperStarting = true;
  try {
    const displays = await getWallpaperDisplays();
    if (!displays.length) throw new Error("No displays available");
    win.setBounds(displays[0].bounds);
    await attachWallpaperWindow(win, displays[0]);
    for (const display of displays.slice(1)) await createWallpaperWindow(display);
    wallpaperOn = true;
    fullscreenFallback = false;
    detachDone = false;
    writePref(true);
    ensureTray();
    refreshTrayMenu();
    registerWallpaperHotkey();
    sendState();
    win.showInactive();
    await moveWallpaperWindow(wallpaperWindows.get(displays[0].id), displays[0]);
    startDeskInput();
    balloon("已铺到所有屏幕。托盘图标或 F11 可以恢复窗口。");
  } catch (error) {
    await clearWallpaperWindows();
    if (savedMinimumSize && !win.isDestroyed()) win.setMinimumSize(...savedMinimumSize);
    throw error;
  } finally { wallpaperStarting = false; }
}

async function refreshWallpaperDisplays() {
  // A display can be connected while the initial windows are still attaching.
  // Keep the notification until that transaction has finished.
  if (wallpaperStarting) { scheduleDisplayRefresh(); return; }
  if (!wallpaperOn || toggleBusy || displayRefreshBusy) { if (wallpaperOn) scheduleDisplayRefresh(); return; }
  displayRefreshBusy = true;
  stopDeskInput();
  try {
    const displays = await getWallpaperDisplays();
    if (!displays.length) throw new Error("No displays available");
    const primary = displays[0];
    let mainEntry = [...wallpaperWindows.values()].find((entry) => entry.window === win);
    if (!mainEntry) throw new Error("Main desktop window is missing");
    if (mainEntry.id !== primary.id) {
      const displaced = wallpaperWindows.get(primary.id);
      if (displaced) {
        wallpaperWindows.delete(primary.id);
        await detachWallpaperWindow(displaced);
        if (!displaced.window.isDestroyed()) displaced.window.destroy();
      }
      wallpaperWindows.delete(mainEntry.id);
      mainEntry.id = primary.id;
      wallpaperWindows.set(primary.id, mainEntry);
    }
    const wanted = new Set(displays.map((display) => display.id));
    for (const [id, entry] of wallpaperWindows) {
      if (wanted.has(id)) continue;
      wallpaperWindows.delete(id);
      try { await detachWallpaperWindow(entry); } finally { if (!entry.window.isDestroyed()) entry.window.destroy(); }
    }
    for (const display of displays) {
      const entry = wallpaperWindows.get(display.id);
      if (!entry) await createWallpaperWindow(display);
      else if (["x", "y", "width", "height"].some((key) => entry.rect[key] !== display.rect[key] || entry.bounds[key] !== display.bounds[key])) {
        await moveWallpaperWindow(entry, display);
      }
    }
  } catch (error) {
    logWallpaperError(error);
    await leaveSpecial();
    balloon("显示器布局更新失败，已恢复窗口；可以按 F11 重试。");
  } finally {
    displayRefreshBusy = false;
    if (wallpaperOn) startDeskInput();
  }
}

function scheduleDisplayRefresh() {
  if (displayRefreshTimer) clearTimeout(displayRefreshTimer);
  displayRefreshTimer = setTimeout(() => { displayRefreshTimer = null; refreshWallpaperDisplays(); }, 350);
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
  if (displayRefreshTimer) { clearTimeout(displayRefreshTimer); displayRefreshTimer = null; }
  if (detachDone || !wallpaperWindows.size) return;
  detachDone = true;
  wallpaperOn = false;
  for (const entry of wallpaperWindows.values()) {
    if (entry.window.isDestroyed()) continue;
    spawnSync(psExe(), ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptFile(),
      "-Action", "detach", "-Hwnd", hwndOf(entry.window), "-Style", String(entry.style), "-Ex", String(entry.ex), "-NoRestore"],
    { windowsHide: true, timeout: 8000 });
    if (entry.window !== win && !entry.window.isDestroyed()) entry.window.destroy();
  }
  wallpaperWindows.clear();
}

async function leaveSpecial() {
  dockDesktopShown = false;
  stopDeskInput();
  unregisterWallpaperHotkey();
  if (displayRefreshTimer) { clearTimeout(displayRefreshTimer); displayRefreshTimer = null; }
  try {
    if (wallpaperOn || wallpaperWindows.size) {
      wallpaperOn = false;
      detachDone = true;
      await clearWallpaperWindows();
    }
    if (fullscreenFallback && !win.isDestroyed()) {
      if (win.isFullScreen()) win.setFullScreen(false);
      if (!savedMaximized && win.isMaximized()) await waitUnmaximize();
    }
  } finally {
    fullscreenFallback = false;
    wallpaperOn = false;
    detachDone = false;
    if (win && !win.isDestroyed()) {
      win.setSkipTaskbar(false);
      win.setMenuBarVisibility(false);
      if (savedMinimumSize) win.setMinimumSize(...savedMinimumSize);
      if (savedMaximized) win.maximize();
      else if (savedBounds) win.setBounds(savedBounds);
      win.show();
      win.focus();
      sendState();
    }
    refreshTrayMenu();
    savedMinimumSize = null;
    writePref(false);
  }
}

async function toggleWallpaper() {
  if (toggleBusy || !win || win.isDestroyed()) return { on: wallpaperOn || fullscreenFallback };
  toggleBusy = true;
  try {
    while (displayRefreshBusy) await delay(50);
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

async function showDockDesktop(request) {
  while (toggleBusy && !applicationQuitting) await delay(50);
  if (applicationQuitting) return;
  if (!wallpaperOn) return request("toggle");
  const show = !dockDesktopShown;
  await request(show ? "minimize" : "restore");
  dockDesktopShown = show && wallpaperOn;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 680,
    title: "塘里",
    icon: appIcon(),
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
    if (updateReadyToken()) {
      // Older updaters started the portable launcher hidden. Explicitly show
      // the new interactive window and add a searchable, non-destructive link.
      if (!wallpaperOn) { win.show(); win.focus(); }
      ensureUpdatedPortableShortcut();
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
  win.on("closed", () => {
    win = null;
    if (!applicationQuitting) app.quit();
  });
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
ipcMain.handle("wallpaper:state", () => ({ on: wallpaperOn || fullscreenFallback || wallpaperStarting }));
ipcMain.handle("update:check", () => checkUpdates(true));
ipcMain.handle("music:state", () => musicState);
ipcMain.handle("music:rhythm-enabled", (_event, enabled) => {
  rhythmEnabled = !!enabled;
  if (rhythmEnabled) startRhythmCapture(); else stopRhythmCapture();
  return rhythmEnabled;
});
ipcMain.handle("scene:preview-state", () => ({ ...previewState }));
function updateDockTime() {
  const previewHours = { dawn: 7, noon: 12, dusk: 18, night: 23 };
  dockTools?.updateHour(previewHours[previewState.time] ?? pondHour);
}

function fromPond(event) {
  return event.senderFrame?.frameTreeNodeId === event.sender.mainFrame.frameTreeNodeId &&
    (win?.webContents.id === event.sender.id || [...wallpaperWindows.values()].some((entry) =>
      !entry.window.isDestroyed() && entry.window.webContents.id === event.sender.id));
}

ipcMain.on("scene:hour", (event, hour) => {
  if (event.sender.id !== win?.webContents.id || !fromPond(event) || !Number.isInteger(hour) || hour < 0 || hour > 24) return;
  pondHour = hour % 24;
  updateDockTime();
});
let journalEditor, finishJournalEntry;
ipcMain.on("desktop-tools:open", (event, action) => {
  if (!fromPond(event)) return;
  if (action === "dock") dockTools?.showSettings();
  if (action === "search") dockTools?.showSearch();
});
ipcMain.handle("journal:edit", (event) => {
  if (!fromPond(event)) return null;
  if (journalEditor && !journalEditor.isDestroyed()) { journalEditor.show(); journalEditor.focus(); return null; }
  return new Promise((resolve) => {
    const owner = event.sender;
    journalEditor = new BrowserWindow({ width: 400, height: 152, useContentSize: true, show: false,
      resizable: false, autoHideMenuBar: true, backgroundColor: "#f6f4ef",
      webPreferences: { preload: path.join(__dirname, "journal-editor-preload.js"), sandbox: true, contextIsolation: true, nodeIntegration: false } });
    finishJournalEntry = resolve;
    const close = () => journalEditor?.close();
    owner.once("destroyed", close);
    journalEditor.once("ready-to-show", () => { journalEditor?.show(); });
    journalEditor.once("closed", () => { owner.removeListener("destroyed", close); journalEditor = finishJournalEntry = null; resolve(null); });
    journalEditor.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    journalEditor.webContents.on("will-navigate", (e) => e.preventDefault());
    journalEditor.loadFile(path.join(__dirname, "web", "journal-entry.html")).catch((error) => { logWallpaperError(error); close(); });
  });
});
ipcMain.handle("journal:submit", (event, text) => {
  if (event.sender !== journalEditor?.webContents || event.senderFrame?.frameTreeNodeId !== event.sender.mainFrame.frameTreeNodeId) return;
  if (typeof text === "string" && text.trim()) {
    finishJournalEntry(text.trim().slice(0, 120));
    journalEditor.close();
  }
});
ipcMain.on("scene:preview", (_event, key, value) => {
  const choices = {
    weather: ["auto", "clear", "wind", "rain", "snow", "drizzle"],
    season: ["auto", "spring", "summer", "autumn", "winter"],
    time: ["auto", "dawn", "noon", "dusk", "night", "fast"],
    moon: ["auto", "crescent", "first", "full", "last", "waning"],
    music: ["auto", "show", "ring", "lotus", "heart", "double", "spiral"],
  };
  if (!Object.prototype.hasOwnProperty.call(choices, key) || !choices[key].includes(value)) return;
  previewState[key] = value;
  broadcast("scene:preview", { key, value });
  if (key === "time") updateDockTime();
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
  if (process.platform === "win32") {
    dockTools = createDock({
      refreshTray: refreshTrayMenu,
      toggleDesktop: showDockDesktop,
      log: (error) => {
        try { fs.appendFileSync(path.join(app.getPath("userData"), "dock-error.log"), new Date().toISOString() + " " + String(error.stack || error) + "\n"); }
        catch { /* Keep the pond available if the error log cannot be written. */ }
      },
    });
    dockTools.start();
  }
  ensureTray();
  screen.on("display-added", scheduleDisplayRefresh);
  screen.on("display-removed", scheduleDisplayRefresh);
  screen.on("display-metrics-changed", scheduleDisplayRefresh);
  trayMonitor = setInterval(ensureTray, 30000);
  createWindow();
  startMusicWatcher();
  if (app.isPackaged) {
    updateStartupTimer = setTimeout(() => checkUpdates(false), 20000);
    updateInterval = setInterval(() => checkUpdates(false), 6 * 60 * 60 * 1000);
  }
  setTimeout(() => { sweepPortableLeftovers().catch(() => {}); }, 8000);
});


app.on("before-quit", () => {
  applicationQuitting = true;
  dockTools?.shutdown();
  if (updateStartupTimer) clearTimeout(updateStartupTimer);
  if (updateInterval) clearInterval(updateInterval);
  if (trayMonitor) clearInterval(trayMonitor);
  stopMusicWatcher();
  unregisterWallpaperHotkey();
  detachSync();
});

app.on("will-quit", () => {
  destroyTray();
});

app.on("window-all-closed", () => app.quit());
