const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { execFile, spawn } = require("node:child_process");
const { createInterface } = require("node:readline");
const { setTimeout: delay } = require("node:timers/promises");
const { promisify } = require("node:util");
const { app, BrowserWindow, Menu, clipboard, dialog, globalShortcut, ipcMain, screen, shell } = require("electron");
const { normalizePin, normalizeSettings, pathKey, dockGeometry, groupWindows } = require("./model");
const { createNative } = require("./native");
const { createSearch } = require("./search");

const runFile = promisify(execFile);
const searchKey = "Control+Alt+K";
const restoreKey = "Control+Alt+Shift+T";
const clashAppId = "io.github.clash-verge-rev.clash-verge-rev";
const classicAcrylic = Number(require("node:os").release().split(".")[2]) < 22621;
const configurable = ["material", "layout", "edge", "displayId", "opacity", "iconSize", "magnify", "autohide", "followPond"];
const web = path.join(__dirname, "..", "web", "dock");
const preload = path.join(__dirname, "preload.js");

function createDock({ refreshTray, toggleDesktop, log }) {
  const directory = path.join(app.getPath("userData"), "dock");
  const pref = path.join(directory, "preferences.json");
  const journal = path.join(directory, "taskbar-restore.txt");
  const native = createNative(directory, log);
  const desktop = native.client("desktop", [String(process.pid)]);
  const launcher = native.client("desktop", [String(process.pid)], 12000);
  const iconService = native.client("icons", [String(process.pid)], 6500);
  const search = createSearch(directory, native, (status) => {
    send(searchWindow, "index", status);
    send(settingsWindow, "index", status);
  }, log);
  const icons = new Map();
  const resolvedPins = new Map();
  let appPaths = new Map();
  let settings = read();
  let dock, searchWindow, settingsWindow, preview, guard, takeoverDisplay, switching;
  let takeoverReady = false, stateRevision = 0, backdropKey = "", backdrop = "fallback", shapeKey = "";
  let iconQueue = Promise.resolve(), refreshIcons, nextIconCheck = 0;
  let clashWake, desktopToggle;
  let poll, edgeTimer, showUntil = 0, pollPending = false, groups = new Map(), snapshot = "", geometry;
  let running = [], shownPayload = "", fullscreen = false, maximized = false, closing = false, night = false, shortcut = false;

  function read() {
    try { return normalizeSettings(JSON.parse(fs.readFileSync(pref, "utf8"))); }
    catch { return normalizeSettings(); }
  }

  function save(next) {
    const safe = normalizeSettings(next);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(pref + ".tmp", JSON.stringify(safe, null, 2) + "\n", "utf8");
    fs.renameSync(pref + ".tmp", pref);
    settings = safe;
  }

  function alive(window) { return !!window && !window.isDestroyed(); }
  function send(window, channel, payload) {
    if (alive(window) && !window.webContents.isLoadingMainFrame()) window.webContents.send("tangli:dock:" + channel, payload);
  }

  function display() {
    return screen.getAllDisplays().find((item) => item.id === settings.displayId) || screen.getPrimaryDisplay();
  }

  function state() {
    return {
      revision: ++stateRevision, settings, takeover: takeoverReady, takingOver: !!switching && !takeoverReady, shortcut, night,
      displays: screen.getAllDisplays().map((item) => ({
        id: item.id, name: item.label || `${item.size.width}×${item.size.height}`,
      })),
    };
  }

  function notify() {
    send(settingsWindow, "settings", state());
    refreshTray();
    renderDock();
  }

  function windowOptions(extra) {
    return {
      show: false, autoHideMenuBar: true,
      webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true },
      ...extra,
    };
  }

  function load(window, page) {
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.loadFile(path.join(web, page + ".html")).catch(log);
  }

  function createWindow() {
    if (alive(dock)) return dock;
    dock = new BrowserWindow(windowOptions({
      title: "塘里 Dock", frame: false, transparent: true, resizable: false, skipTaskbar: true,
      focusable: false, alwaysOnTop: true, width: 220, height: 60,
      hasShadow: false, minimizable: false, maximizable: false, fullscreenable: false,
    }));
    dock.on("closed", () => {
      dock = null;
      backdropKey = shapeKey = "";
      backdrop = "fallback";
      shownPayload = "";
      if (!closing) stopGuard();
    });
    dock.webContents.on("did-finish-load", () => { shownPayload = ""; renderDock(); updateVisibility(); });
    load(dock, "bar");
    return dock;
  }

  function showSettings() {
    if (!alive(settingsWindow)) {
      settingsWindow = new BrowserWindow(windowOptions({
        title: "塘里 Dock 设置", width: 680, height: 760, minWidth: 520, minHeight: 560,
        backgroundColor: "#eff5ee",
      }));
      settingsWindow.on("closed", () => { settingsWindow = null; });
      settingsWindow.once("ready-to-show", () => { settingsWindow?.show(); });
      load(settingsWindow, "settings");
    } else {
      if (settingsWindow.isMinimized()) settingsWindow.restore();
      settingsWindow.show();
      settingsWindow.focus();
    }
  }

  function showSearch() {
    const target = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const width = Math.min(700, target.width - 24);
    const height = Math.min(560, target.height - 36);
    const bounds = { x: target.x + Math.round((target.width - width) / 2), y: target.y + Math.round((target.height - height) * .32), width, height };
    if (!alive(searchWindow)) {
      searchWindow = new BrowserWindow(windowOptions({
        ...bounds, title: "塘里搜索", frame: false, resizable: false, skipTaskbar: true,
        backgroundColor: "#eff5ee", alwaysOnTop: true,
      }));
      searchWindow.on("closed", () => { searchWindow = null; });
      searchWindow.once("ready-to-show", () => {
        if (alive(searchWindow)) { searchWindow.show(); searchWindow.focus(); send(searchWindow, "focus"); }
      });
      load(searchWindow, "search");
    } else {
      searchWindow.setBounds(bounds);
      searchWindow.show();
      searchWindow.focus();
      send(searchWindow, "focus");
    }
  }

  function pinAppKey(pin) {
    if (resolvedPins.has(pin.id)) return resolvedPins.get(pin.id);
    let key = "";
    if (pin.type === "app") key = "app:" + pin.target.toLowerCase();
    else if (/\.lnk$/i.test(pin.target)) {
      try {
        const detail = shell.readShortcutLink(pin.target);
        if (detail.appUserModelId) key = "app:" + detail.appUserModelId.toLowerCase();
        else if (/\.exe$/i.test(detail.target)) key = "exe:" + pathKey(detail.target);
      } catch { /* A broken shortcut remains visible so it can be removed. */ }
    } else if (/\.exe$/i.test(pin.target)) key = "exe:" + pathKey(pin.target);
    resolvedPins.set(pin.id, key);
    return key;
  }

  function getIcon(entry, group) {
    const appId = entry.type === "app" ? entry.target : group?.appId || "";
    const file = entry.type === "path" ? entry.target : group?.path || "";
    const handle = group?.windows[0]?.id || "0";
    const key = JSON.stringify([entry.id, appId, file, handle]);
    const cached = icons.get(key);
    if (cached && (!cached.retry || Date.now() < cached.retry)) return cached.url;
    if (icons.size >= 512) icons.delete(icons.keys().next().value);
    const record = { url: cached?.url || "", retry: 0 };
    icons.set(key, record);
    iconQueue = iconQueue.then(async () => {
      if (closing || !alive(dock)) { icons.delete(key); return; }
      let shortcutIcon = "", shortcutIndex = 0, shortcutTarget = "";
      if (/\.lnk$/i.test(file)) {
        try {
          const link = shell.readShortcutLink(file);
          shortcutIcon = link.icon;
          shortcutIndex = link.iconIndex;
          shortcutTarget = link.target;
        } catch { /* Shell can still resolve some virtual shortcuts. */ }
      }
      const png = await iconService.request("icon", { appId, file, handle, shortcutIcon, shortcutIndex, shortcutTarget }).catch(() => "");
      if (png) record.url = "data:image/png;base64," + png;
      else if (file) {
        const image = await app.getFileIcon(shortcutTarget || file, { size: "large" }).catch(() => null);
        if (image && !image.isEmpty()) record.url = image.toDataURL();
      }
      // A newly visible HWND can publish its final WM_SETICON after its first paint.
      if (handle !== "0") record.retry = Date.now() + (cached ? 120000 : 1800);
      else if (!png) record.retry = Date.now() + 60000;
      if (record.url && record.url !== cached?.url && !closing) {
        refreshIcons ||= setTimeout(() => { refreshIcons = null; renderDock(); }, 40);
      }
    }).catch((error) => { record.retry = Date.now() + 60000; log(error); });
    return record.url;
  }

  function updateBackdrop() {
    const enabled = settings.material === "frosted";
    const dark = settings.followPond && night;
    const key = [hwnd(), enabled, dark].join("/");
    if (backdropKey === key) return;
    backdropKey = key;
    backdrop = "fallback";
    desktop.request("backdrop", { handle: hwnd(), enabled, dark }).then((active) => {
      if (backdropKey !== key || !alive(dock)) return;
      backdrop = active ? "native" : "fallback";
      renderDock();
    }).catch(log);
  }

  function renderDock() {
    if (!alive(dock)) return;
    try {
      const pins = settings.pins.map((pin) => ({ ...pin, appKey: pinAppKey(pin) }));
      const keys = new Set(pins.map((pin) => pin.appKey).filter(Boolean));
      const aliases = new Map();
      for (const pin of pins) {
        const executable = appPaths.get(pin.appKey);
        if (executable && !aliases.has(executable)) aliases.set(executable, pin.appKey);
      }
      const windows = running.map((win) => {
        const appKey = win.appId ? "app:" + win.appId.toLowerCase() : "";
        const exeKey = win.path ? "exe:" + pathKey(win.path) : "";
        return { ...win, appKey: keys.has(appKey) ? appKey : keys.has(exeKey) ? exeKey
          : appKey || aliases.get(exeKey) || exeKey || "window:" + win.id };
      });
      const activeGroups = groupWindows(windows, pins);
      const byId = new Map(activeGroups.map((group) => [group.id, group]));
      // Z-order changes when an app gains focus. Keep existing tiles in place.
      const ordered = new Set([...groups.keys(), ...byId.keys()]);
      const pinned = new Set(pins.map((pin) => pin.id));
      const toItem = (entry, group) => ({
        id: entry.id,
        name: entry.name,
        icon: getIcon(entry, group),
        pin: pinned.has(entry.id),
        count: group?.windows.length || 0,
        active: group?.windows.some((win) => win.active) || false,
      });
      const items = pins.map((pin) => toItem(pin, byId.get(pin.id)));
      const unpinned = [...ordered].filter((id) => byId.has(id) && !pinned.has(id)).map((id) => {
        const group = byId.get(id);
        return toItem(group, group);
      });
      groups = byId;
      const target = takeoverDisplay || display();
      geometry = dockGeometry(target, settings, items.length + unpinned.length + 4);
      if (JSON.stringify(dock.getBounds()) !== JSON.stringify(geometry.bounds)) dock.setBounds(geometry.bounds);
      updateBackdrop();
      const result = {
        material: settings.material, opacity: settings.opacity, iconSize: settings.iconSize, magnify: settings.magnify,
        night: settings.followPond && night, pondColor: settings.followPond, backdrop, classicAcrylic, ...geometry, items, running: unpinned,
      };
      const serialized = JSON.stringify(result);
      if (shownPayload !== serialized && !dock.webContents.isLoadingMainFrame()) {
        shownPayload = serialized;
        send(dock, "bar", result);
      }
      updateVisibility();
    } catch (error) { log(error); }
  }

  function updateVisibility() {
    if (!alive(dock) || !geometry || dock.webContents.isLoadingMainFrame()) return;
    const hideAtRest = settings.autohide || takeoverReady && !geometry.full && maximized;
    if (fullscreen || !hideAtRest) showUntil = 0;
    const pointer = screen.getCursorScreenPoint();
    const { bounds, edge } = geometry;
    const target = takeoverDisplay || display();
    const area = takeoverReady ? target.bounds : target.workArea;
    const horizontal = edge === "bottom";
    const along = horizontal ? pointer.x - bounds.x : pointer.y - bounds.y;
    const span = horizontal ? bounds.width : bounds.height;
    const edgeDistance = horizontal ? area.y + area.height - 1 - pointer.y
      : edge === "right" ? area.x + area.width - 1 - pointer.x : pointer.x - area.x;
    const dockDepth = horizontal ? area.y + area.height - bounds.y
      : edge === "right" ? area.x + area.width - bounds.x : bounds.x + bounds.width - area.x;
    const edgeHit = along >= 0 && along < span && edgeDistance >= -2 && edgeDistance <= 6;
    // Bridge the space between the physical screen edge and the original Dock position.
    const overDockOrGap = along >= -5 && along < span + 5 && edgeDistance >= -2 && edgeDistance <= dockDepth + 4;
    const now = Date.now();
    if (hideAtRest && !fullscreen && (edgeHit || showUntil > now && overDockOrGap)) {
      showUntil = Math.max(showUntil, now + 520);
    }
    const show = settings.enabled && !fullscreen && (!hideAtRest || showUntil > now || !!preview);
    if (show && !dock.isVisible()) dock.showInactive();
    else if (!show && dock.isVisible()) dock.hide();
  }

  function hwnd() { return alive(dock) ? dock.getNativeWindowHandle().readBigUInt64LE().toString() : "0"; }

  async function pollWindows() {
    if (pollPending || !settings.enabled || !alive(dock)) return;
    pollPending = true;
    try {
      const handle = hwnd();
      const result = await desktop.request("windows", { monitorWindow: handle });
      if (handle !== hwnd()) return;
      const payload = JSON.stringify(result.windows);
      fullscreen = result.fullscreen;
      maximized = result.maximized;
      const now = Date.now();
      const retryIcons = nextIconCheck < now && [...icons.values()].some((icon) => icon.retry && icon.retry <= now);
      if (retryIcons) nextIconCheck = now + 3000;
      if (snapshot !== payload || retryIcons) {
        snapshot = payload;
        running = result.windows;
        renderDock();
      }
      updateVisibility();
    } catch (error) {
      if (running.length) { running = []; snapshot = ""; renderDock(); }
      log(error);
    } finally { pollPending = false; }
  }

  function setEnabled(value) {
    save({ ...settings, enabled: value === true });
    if (settings.enabled) {
      showUntil = Date.now() + 2000;
      createWindow();
      poll ||= setInterval(pollWindows, 550);
      edgeTimer ||= setInterval(updateVisibility, 100);
      void pollWindows();
    } else {
      stopGuard();
      closePreview();
      clearInterval(poll); poll = null;
      clearInterval(edgeTimer); edgeTimer = null;
      geometry = null;
      fullscreen = maximized = false;
      if (alive(dock)) dock.destroy();
    }
    notify();
    return state();
  }

  async function open(target) {
    if (!target) return;
    if (target.type === "app") {
      const pin = normalizePin(target);
      if (!pin) throw new Error("这个应用入口无效");
      await launcher.request("open-app", { appId: pin.target });
      return;
    }
    if (!await fsp.stat(target.target).catch(() => null)) throw new Error("文件或文件夹已移动，无法打开");
    const error = await shell.openPath(target.target);
    if (error) throw new Error(error);
  }

  async function addPins(paths) {
    const additions = [];
    for (const target of paths.slice(0, 150)) {
      const pin = normalizePin(target);
      if (!pin) continue;
      if (pin.type === "path" && !await fsp.stat(pin.target).catch(() => null)) continue;
      if (/\.lnk$/i.test(pin.name)) pin.name = pin.name.slice(0, -4);
      additions.push(pin);
    }
    if (!additions.length) throw new Error("没有找到可固定的本地入口");
    save({ ...settings, pins: [...settings.pins, ...additions] });
    if (additions.some((pin) => pinAppKey(pin).startsWith("app:"))) void loadPinApps().catch(log);
    notify();
  }

  async function pick(kind) {
    const options = { title: "固定到塘里 Dock", properties: [kind === "folder" ? "openDirectory" : "openFile", "multiSelections"] };
    const result = await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths.length) return;
    await addPins(result.filePaths.map((target) => ({ target })));
  }

  function reorder(id, before) {
    if (id === before) return;
    const source = settings.pins.find((pin) => pin.id === id);
    if (!source) return;
    const pins = settings.pins.filter((pin) => pin.id !== id);
    const index = pins.findIndex((pin) => pin.id === before);
    pins.splice(index === -1 ? pins.length : index, 0, source);
    save({ ...settings, pins });
    notify();
  }

  function entry(id) {
    return settings.pins.find((pin) => pin.id === id) || null;
  }

  function runningTarget(group) {
    if (!group) return null;
    if (normalizePin({ target: group.appId, type: "app" })) return { type: "app", target: group.appId, name: group.name };
    return group.path ? { type: "path", target: group.path, name: group.name } : null;
  }

  function clashTarget(pin, group) {
    const key = pin ? pinAppKey(pin) : "";
    if (key === "app:" + clashAppId || key.startsWith("exe:") && isClashExecutable(key.slice(4))) return pin;
    if (isClashExecutable(group?.path)) return { type: "path", target: group.path };
    if (group?.appId?.toLowerCase() === clashAppId) return { type: "app", target: clashAppId };
    return null;
  }

  function isClashExecutable(file) {
    return !!file && path.win32.basename(file).toLowerCase() === "clash-verge.exe";
  }

  async function retryClashForeground() {
    const window = dock;
    const binary = await native.executable();
    if (!alive(window) || !window.isVisible()) return "blocked";
    // A helper started by the foreground process can activate the target on behalf of the click.
    window.setFocusable(true);
    window.setSkipTaskbar(true);
    try {
      window.focus();
      const { stdout } = await runFile(binary, ["focus-clash"], { windowsHide: true, timeout: 3500 });
      return JSON.parse(stdout);
    } finally {
      if (alive(window)) window.setFocusable(false);
    }
  }

  function wakeClash(target, toggle = false) {
    clashWake ??= (async () => {
      let result = await desktop.request("switch-clash", { toggle });
      if (result === "missing") {
        // A cold or lightweight instance may have no window to restore.
        await open(target);
        const deadline = Date.now() + 5500;
        while (result === "missing" && !closing && settings.enabled && Date.now() < deadline) {
          await delay(180);
          result = await desktop.request("switch-clash", { toggle: false });
        }
      }
      if (closing || !settings.enabled) return;
      if (result === "blocked") result = await retryClashForeground();
      if (result !== "switched") throw new Error("Clash Verge 主窗口暂时无法显示");
    })().finally(() => { clashWake = null; void pollWindows(); });
    return clashWake;
  }

  async function switchWindow(group, win, toggle) {
    const pin = entry(group.id);
    const clash = clashTarget(pin, group);
    if (clash) return wakeClash(clash, toggle);
    try {
      const switched = await desktop.request("activate", { handle: win.id, toggle });
      if (switched) return;
    } finally {
      void pollWindows();
    }
    const target = toggle && (pin || runningTarget(group));
    if (target) return open(target);
    throw new Error("这个窗口已关闭");
  }

  function closePreview() {
    if (preview && preview.exitCode === null) preview.kill();
    preview = null;
  }

  async function activate(id, x, y) {
    const group = groups.get(id);
    if (!group) {
      const pin = entry(id);
      const clash = clashTarget(pin);
      return clash ? wakeClash(clash) : open(pin);
    }
    if (group.windows.length === 1) {
      return switchWindow(group, group.windows[0], true);
    }
    const binary = await native.executable();
    if (!alive(dock) || !geometry) return;
    closePreview();
    const rect = dock.getBounds();
    const point = screen.dipToScreenPoint({
      x: rect.x + Math.max(0, Math.min(rect.width, Number(x) || rect.width / 2)),
      y: rect.y + Math.max(0, Math.min(rect.height, Number(y) || rect.height / 2)),
    });
    const instance = spawn(binary, ["preview", String(process.pid), group.windows.slice(0, 64).map((win) => win.id).join(","),
      String(point.x), String(point.y), geometry.edge], { detached: true, windowsHide: true, stdio: "ignore" });
    preview = instance;
    instance.once("error", report);
    instance.once("close", (code) => {
      if (preview !== instance) return;
      preview = null;
      if (code) report(new Error("无法打开窗口选择面板，请重试"));
      updateVisibility();
    });
  }

  function report(error) {
    log(error);
    send(dock, "error", String(error.message || error));
    send(settingsWindow, "error", String(error.message || error));
    send(searchWindow, "error", String(error.message || error));
  }

  function menu(template) {
    if (!alive(dock)) return;
    showUntil = Date.now() + 6000;
    Menu.buildFromTemplate(template).popup({ window: dock, callback: () => { showUntil = Date.now() + 500; } });
  }

  function context(id) {
    const pin = entry(id);
    const group = groups.get(id);
    if (!pin && !group) return;
    const target = pin || runningTarget(group);
    const entries = [];
    if (target) entries.push({ label: group ? "打开新窗口" : "打开", click: () => open(target).catch(report) });
    if (group?.windows.length) {
      entries.push({ label: "切换到窗口", submenu: group.windows.map((win) => ({
        label: win.title, click: () => switchWindow(group, win, false).catch(report),
      })) });
      entries.push({ label: "关闭窗口", submenu: group.windows.map((win) => ({
        label: win.title, click: () => desktop.request("close", { handle: win.id }).catch(report),
      })) });
    }
    if (target) entries.push({ type: "separator" }, pin ? {
      label: "取消固定", click: () => { save({ ...settings, pins: settings.pins.filter((item) => item.id !== id) }); notify(); },
    } : { label: "固定到 Dock", click: () => addPins([target]).catch(report) });
    if (entries.length) menu(entries);
  }

  function systemMenu() {
    menu([
      { label: "显示桌面", click: () => showDesktop().catch(report) },
      { label: "快速设置", click: () => desktop.request("quick-settings").catch(report) },
      { label: "通知中心", click: () => desktop.request("notifications").catch(report) },
      { label: "Windows 设置", click: () => shell.openExternal("ms-settings:").catch(report) },
      { type: "separator" },
      { label: "Dock 设置", click: showSettings },
      ...(takeoverReady ? [{ label: "恢复 Windows 任务栏", click: stopGuard }] : []),
    ]);
  }

  function showDesktop() {
    desktopToggle ??= toggleDesktop((action) => desktop.request("desktop", { action }))
      .finally(() => { desktopToggle = null; void pollWindows(); });
    return desktopToggle;
  }

  async function repairTaskbar() {
    if (!fs.existsSync(journal)) return;
    const binary = await native.executable();
    await runFile(binary, ["repair", journal], { windowsHide: true, timeout: 6000 });
  }

  function stopGuard() {
    const active = guard;
    if (active && !active.stdin.destroyed) active.stdin.end("stop\n");
    if (!active) void repairTaskbar().catch(report);
  }

  async function startTakeover() {
    if (guard || switching) return state();
    if (!settings.enabled || !alive(dock) || dock.webContents.isLoadingMainFrame() || fullscreen)
      throw new Error("请先启用 Dock，并退出全屏应用");
    if (screen.getAllDisplays().length !== 1)
      throw new Error("当前接管支持单显示器。多屏时可以继续用并存模式");
    if (!globalShortcut.register(restoreKey, stopGuard))
      throw new Error("恢复快捷键被占用，未开始接管");
    switching = native.executable().then((binary) => new Promise((resolve, reject) => {
      if (closing || !settings.enabled) { reject(new Error("Dock 已关闭")); return; }
      takeoverDisplay = display();
      const child = spawn(binary, ["guard", String(process.pid), journal], {
        // libuv terminates non-detached Windows children when the parent process dies.
        detached: true, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
      });
      guard = child;
      let problem = "";
      const timer = setTimeout(() => {
        stopGuard();
        reject(new Error("Windows 未及时确认任务栏接管"));
      }, 5500);
      child.stderr.setEncoding("utf8").on("data", (text) => { problem += text; });
      child.stdin.on("error", log);
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      createInterface({ input: child.stdout }).on("line", (line) => {
        let value;
        try { value = JSON.parse(line); } catch { return; }
        if (!value.ready || child.stdin.writableEnded || !settings.enabled || closing) return;
        clearTimeout(timer);
        takeoverReady = true;
        resolve();
        notify();
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        if (guard === child) { guard = null; takeoverDisplay = null; takeoverReady = false; }
        globalShortcut.unregister(restoreKey);
        if (!closing) {
          notify();
          void repairTaskbar().catch(report);
        }
        reject(new Error(problem.trim() || (code ? "任务栏恢复助手已退出" : "已恢复 Windows 任务栏")));
      });
    })).catch((error) => {
      if (!guard) globalShortcut.unregister(restoreKey);
      throw error;
    }).finally(() => { switching = null; notify(); });
    notify();
    await switching;
    return state();
  }

  function displaysChanged(_event, _display, metrics) {
    if (guard && (screen.getAllDisplays().length !== 1 || metrics?.some((metric) => ["bounds", "scaleFactor", "rotation"].includes(metric)))) {
      stopGuard();
    }
    renderDock();
    send(settingsWindow, "settings", state());
  }

  function shape(rects) {
    if (!alive(dock) || !Array.isArray(rects)) return;
    const { width, height } = dock.getBounds();
    const clipped = settings.material === "transparent" ? rects.slice(0, 180).flatMap((r) => {
      if (![r.x, r.y, r.width, r.height].every(Number.isFinite)) return [];
      const x = Math.max(0, Math.floor(r.x));
      const y = Math.max(0, Math.floor(r.y));
      const w = Math.min(width, Math.ceil(r.x + r.width)) - x;
      const h = Math.min(height, Math.ceil(r.y + r.height)) - y;
      return w > 0 && h > 0 ? [{ x, y, width: w, height: h }] : [];
    }) : [];
    let region = clipped;
    if (settings.material === "frosted" && !geometry?.full) {
      const r = Math.min(classicAcrylic && backdrop === "native" ? 4 : 15, Math.floor(Math.min(width, height) / 2));
      region = [{ x: 0, y: r, width, height: height - 2 * r }];
      for (let y = 0; y < r; y++) {
        const x = Math.round(r - Math.sqrt(r * r - (r - y - .5) ** 2));
        for (const row of [y, height - y - 1]) region.push({ x, y: row, width: width - 2 * x, height: 1 });
      }
    }
    if (settings.material === "transparent" && !region.length) return;
    const key = JSON.stringify(region);
    if (key !== shapeKey) { dock.setShape(region); shapeKey = key; }
  }

  async function searchAction(action, id) {
    const row = search.get(id);
    if (!row) return;
    if (action === "open") {
      await open(row);
      if (alive(searchWindow)) searchWindow.hide();
    } else if (action === "pin") {
      await addPins([row]);
    } else if (action === "copy") {
      clipboard.writeText(row.target);
    } else if (action === "reveal" && row.type !== "app") {
      if (!await fsp.stat(row.target).catch(() => null)) throw new Error("文件或文件夹已移动");
      shell.showItemInFolder(row.target);
    }
  }

  function registerIpc() {
    const handle = (name, owners, fn) => ipcMain.handle("tangli:dock:" + name, async (event, ...args) => {
      if (!owners().some((window) => alive(window) && window.webContents.id === event.sender.id
        && event.senderFrame?.frameTreeNodeId === event.sender.mainFrame.frameTreeNodeId))
        throw new Error("此窗口不能访问塘里 Dock");
      return fn(...args);
    });
    handle("get", () => [dock, settingsWindow, searchWindow], () => state());
    handle("enabled", () => [settingsWindow], setEnabled);
    handle("save", () => [settingsWindow], (values) => {
      const next = { ...settings };
      for (const key of configurable) if (Object.hasOwn(values, key)) next[key] = values[key];
      save(next);
      notify();
      return state();
    });
    handle("takeover", () => [settingsWindow], (value) => value ? startTakeover() : stopGuard());
    handle("pick", () => [dock, settingsWindow], pick);
    handle("drop", () => [dock], (paths) => addPins(paths.map((target) => ({ target }))));
    handle("reorder", () => [dock], reorder);
    handle("shape", () => [dock], shape);
    handle("item", () => [dock], activate);
    handle("context", () => [dock], context);
    handle("command", () => [dock], (command) => {
      if (command === "search") return showSearch();
      if (command === "system") return systemMenu();
      if (command === "desktop") return showDesktop();
      if (command === "settings") return showSettings();
      if (command === "start") return desktop.request("start");
    });
    handle("query", () => [searchWindow], (text, type) => search.query(text, ["file", "folder", "app"].includes(type) ? type : "all"));
    handle("search-action", () => [searchWindow], searchAction);
    handle("search-hide", () => [searchWindow], () => searchWindow.hide());
    handle("search-settings", () => [searchWindow], () => { searchWindow.hide(); showSettings(); });
    handle("drives", () => [settingsWindow], () => search.drives());
    handle("index", () => [settingsWindow], async (values) => {
      const drives = await search.drives();
      const available = new Set(drives.map((drive) => drive.root));
      const roots = (Array.isArray(values) ? values : []).filter((root) => available.has(root) || settings.indexRoots.includes(root));
      save({ ...settings, indexRoots: roots });
      await search.configure(settings.indexRoots);
      notify();
      return state();
    });
    handle("index-status", () => [searchWindow, settingsWindow], search.status);
  }

  async function loadPinApps() {
    const apps = await search.installedApps();
    if (closing) return;
    appPaths = new Map(apps.filter((row) => row.type === "app" && /\.exe$/i.test(row.executable))
      .map((row) => ["app:" + row.target.toLowerCase(), "exe:" + pathKey(row.executable)]));
    // Earlier versions stored just the basename of AppsFolder known-folder IDs.
    const repaired = settings.pins.map((pin) => {
      if (pin.type !== "app" || !/^[^\\]+\.(lnk|exe)$/i.test(pin.target)) return pin;
      const matches = apps.filter((row) => row.type === "app" && row.target.startsWith("{") &&
        path.win32.basename(row.target).toLowerCase() === pin.target.toLowerCase());
      const match = matches.find((row) => row.name === pin.name) || (matches.length === 1 ? matches[0] : null);
      return match ? { ...pin, target: match.target } : pin;
    });
    if (repaired.some((pin, i) => pin !== settings.pins[i])) { save({ ...settings, pins: repaired }); notify(); }
    else renderDock();
  }

  function start() {
    registerIpc();
    if (settings.pins.some((pin) => pinAppKey(pin).startsWith("app:"))) void loadPinApps().catch(log);
    shortcut = globalShortcut.register(searchKey, showSearch);
    for (const event of ["display-added", "display-removed", "display-metrics-changed"]) screen.on(event, displaysChanged);
    void repairTaskbar().catch(report);
    void search.configure(settings.indexRoots);
    if (settings.enabled) setEnabled(true);
  }

  function shutdown() {
    closing = true;
    if (guard) stopGuard();
    closePreview();
    clearInterval(poll);
    clearInterval(edgeTimer);
    clearTimeout(refreshIcons);
    if (shortcut) globalShortcut.unregister(searchKey);
    search.shutdown();
    desktop.stop();
    launcher.stop();
    iconService.stop();
    for (const window of [dock, searchWindow, settingsWindow]) if (alive(window)) window.destroy();
  }

  function updateHour(hour) {
    if (!Number.isFinite(hour)) return;
    const next = hour < 6 || hour >= 19;
    if (night !== next) { night = next; renderDock(); }
  }

  return { start, shutdown, state, setEnabled, showSettings, showSearch, stopGuard, updateHour, report };
}

module.exports = { createDock };
