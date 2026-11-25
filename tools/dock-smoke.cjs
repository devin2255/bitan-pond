// Exercise the real Electron windows with isolated settings and a temporary drive.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { execFile, spawn } = require("node:child_process");
const { promisify } = require("node:util");
const { setTimeout: delay } = require("node:timers/promises");
const { createNative } = require("../dock/native");

const run = promisify(execFile);
const root = path.join(__dirname, "..");
const packaged = process.argv.slice(2).find((value) => !value.startsWith("--"));
const exe = packaged ? path.resolve(packaged) : path.join(root, "node_modules", "electron", "dist", "electron.exe");
const testGuard = process.argv.includes("--taskbar");
const testClose = process.argv.includes("--close-window");
const testWallpaper = process.argv.includes("--wallpaper-journal");
const testClash = process.argv.includes("--clash-verge");
const testShowDesktop = process.argv.includes("--show-desktop");
const clashAppId = "io.github.clash-verge-rev.clash-verge-rev";

async function wait(label, check, milliseconds = 12000) {
  let last;
  const until = Date.now() + milliseconds;
  while (Date.now() < until) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) { last = error; }
    await delay(100);
  }
  throw new Error(label + (last ? ": " + last.message : " timed out"));
}

async function portNumber() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function debuggerPage(url, isPage = true) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  const calls = new Map();
  let id = 0;
  function command(method, params = {}) {
    const request = ++id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { calls.delete(request); reject(new Error(method + " timed out")); }, 8500);
      calls.set(request, { resolve, reject, timer });
      socket.send(JSON.stringify({ id: request, method, params }));
    });
  }
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === "Page.javascriptDialogOpening") {
      void command("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
    }
    if (!calls.has(message.id)) return;
    const call = calls.get(message.id);
    calls.delete(message.id);
    clearTimeout(call.timer);
    if (message.error) call.reject(new Error(message.error.message));
    else call.resolve(message.result);
  });
  if (isPage) await command("Page.enable");
  return {
    command, close: () => socket.close(),
    async eval(expression) {
      const response = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
      return response.result.value;
    },
  };
}

async function main() {
  assert.equal(process.platform, "win32");
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tangli-dock-ui-"));
  const data = path.join(directory, "profile");
  const fixture = path.join(directory, "fixtures");
  await fs.mkdir(data);
  await fs.mkdir(fixture);
  const port = await portNumber();
  const file = path.join(fixture, "塘里独立索引烟测.txt");
  await fs.writeFile(file, "Tangli test fixture");
  await fs.mkdir(path.join(fixture, "塘里验收文件夹"));
  const native = createNative(path.join(directory, "helper"));
  const binary = await native.executable();
  const sys = path.join(process.env.SystemRoot, "System32");
  const subst = path.join(sys, "subst.exe");
  const ps = path.join(sys, "WindowsPowerShell", "v1.0", "powershell.exe");
  const compiler = path.join(process.env.SystemRoot, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
  const probe = path.join(directory, "visual-probe.exe");
  const uiLibraries = ["WindowsBase", "UIAutomationClient", "UIAutomationTypes"].map(name => "/r:" + path.join(path.dirname(compiler), "WPF", name + ".dll"));
  await run(compiler, ["/nologo", "/codepage:65001", "/target:exe", "/out:" + probe, "/r:System.Windows.Forms.dll", "/r:System.Drawing.dll",
    "/r:System.Web.Extensions.dll", ...uiLibraries, path.join(root, "tools", "dock-visual-fixture.cs")], { windowsHide: true });
  const inspect = async (pid, png) => JSON.parse((await run(probe, ["inspect", String(pid), ...(png ? [png] : [])], { windowsHide: true })).stdout);
  const proofs = process.env.TANGLI_DOCK_PROOFS || directory;
  await fs.mkdir(proofs, { recursive: true });
  const nativeDir = path.join(data, "dock", "taskbar-restore.txt");
  const taskbar = async () => Number((await run(binary, ["taskbar-state"], { windowsHide: true })).stdout.trim());
  const workHeight = async () => Number((await run(ps, ["-NoProfile", "-Command",
    "Add-Type -AssemblyName System.Windows.Forms; [Windows.Forms.Screen]::PrimaryScreen.WorkingArea.Height"], { windowsHide: true })).stdout.trim());
  const before = await taskbar();
  const previousArea = testGuard ? await workHeight() : null;
  const binName = testGuard ? (await run(ps, ["-NoProfile", "-Command", "[Console]::OutputEncoding=[Text.UTF8Encoding]::new(); (New-Object -ComObject Shell.Application).Namespace(10).Self.Name"], { windowsHide: true })).stdout.trim() : "";
  const binView = async () => (await run(probe, ["bin", binName], { windowsHide: true })).stdout.trim();
  const binBefore = testGuard ? await binView() : null;
  const cursor = (...values) => run(probe, ["cursor", ...values.map(String)], { windowsHide: true });
  const previousCursor = testGuard ? JSON.parse((await cursor()).stdout) : null;
  let drive, child, appFixture, secondFixture, maximizedFixture, plate, browser, browserPid;
  const pages = [];
  let consoleErrors = "";
  let targets;
  async function page(ending) {
    const target = await wait("window " + ending, async () => {
      targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      return targets.find((candidate) => candidate.url.endsWith(ending));
    });
    const opened = await debuggerPage(target.webSocketDebuggerUrl);
    pages.push(opened);
    return opened;
  }
  function launch() {
    const args = [`--remote-debugging-port=${port}`, "--remote-debugging-address=127.0.0.1"];
    if (!packaged) args.push(root);
    child = spawn(exe, args, {
      cwd: root, windowsHide: true, stdio: ["ignore", "ignore", "pipe"],
      env: { ...process.env, TANGLI_TEST_MODE: "1", TANGLI_TEST_USER_DATA: data },
    });
    child.stderr.setEncoding("utf8").on("data", (part) => { consoleErrors = (consoleErrors + part).slice(-4000); });
  }
  async function stop() {
    if (browser) {
      await Promise.race([browser.command("Browser.close").catch(() => {}), delay(700)]);
      await delay(400);
      if (browserPid) {
        const reachable = await fetch(`http://127.0.0.1:${port}/json/version`).then(() => true, () => false);
        if (reachable) {
          try { process.kill(browserPid); } catch { /* Already closed. */ }
        }
      }
    }
    if (child?.exitCode === null) child.kill();
  }
  async function openedSettings() {
    const pond = await page("/web/index.html");
    await wait("Pond ready", () => pond.eval("document.readyState === 'complete' && !!window.Pond && !!window.desktopTools"));
    const clicked = await pond.eval(`(() => { document.getElementById("pond").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, button: 2, clientX: 200, clientY: 200 }));
      const button = [...document.querySelectorAll("#menu button")].find(b => b.textContent === "Dock 设置");
      if (button) button.click(); return !!button; })()`);
    assert.equal(clicked, true, "settings reachable from the normal pond menu");
    const settings = await page("/web/dock/settings.html");
    await wait("Dock settings ready", () => settings.eval("document.readyState === 'complete' && !!document.querySelector('[data-material][aria-pressed=true]')"));
    return { pond, settings };
  }
  async function checkShowDesktop(pond, settings) {
    await settings.eval("window.tangliDock.enabled(true)");
    const dock = await page("/web/dock/bar.html");
    await pond.eval('document.title = "塘里显示桌面验收"');
    const client = native.client("desktop", ["0"]);
    const marker = [250, 19, 222];
    const [x, y] = await dock.eval("[Math.round((screen.availLeft + screen.availWidth / 2) * devicePixelRatio), Math.round((screen.availTop + screen.availHeight / 2) * devicePixelRatio)]");
    const pixel = async () => JSON.parse((await run(probe, ["pixel", String(x), String(y)], { windowsHide: true })).stdout);
    const matches = (value) => value.every((channel, i) => Math.abs(channel - marker[i]) <= 2);
    const windows = async () => (await client.request("windows", { monitorWindow: "0" })).windows;
    const fixtureWindow = async () => (await windows()).find((win) => win.title === "Tangli foreground fixture");
    let toggled = false;
    const command = async () => {
      await dock.eval("window.tangliDock.command('desktop')");
      toggled = !toggled;
    };
    try {
      const normalPond = async () => (await windows()).find((win) => win.title === "塘里显示桌面验收");
      await wait("Pond begins as a normal maximized window", async () => (await normalPond())?.minimized === false);
      await command();
      await wait("Show Desktop minimizes the normal pond window", async () => (await normalPond())?.minimized);
      assert.equal(await pond.eval("window.wallpaper.state().then(s => s.on)"), false);
      await command();
      await wait("the normal pond window restores on a second press", async () => (await normalPond())?.minimized === false);
      assert.equal(await pond.eval("window.wallpaper.toggle().then(s => s.on)"), true);
      await wait("pond is attached to the desktop", async () =>
        JSON.parse(await fs.readFile(path.join(data, "wallpaper.json"), "utf8")).on);
      await pond.eval(`(() => {
        const marker = document.createElement("div");
        Object.assign(marker.style, {position:"fixed",left:"45%",top:"45%",width:"10%",height:"10%",zIndex:"999999",background:"#fa13de"});
        document.body.append(marker);
      })()`);
      if (testGuard) {
        await settings.eval("window.tangliDock.takeover(true)");
        await wait("taskbar takeover is ready", () => settings.eval("window.tangliDock.state().then(s => s.takeover)"));
      }
      appFixture = spawn(probe, ["foreground"], { windowsHide: true, stdio: "ignore" });
      const fixture = await wait("normal foreground window", fixtureWindow);
      if (!fixture.active) await client.request("activate", { handle: fixture.id, toggle: false });
      await wait("normal window covers the pond", async () => !matches(await pixel()));
      await command();
      await wait("Show Desktop minimizes the normal window", async () => (await fixtureWindow())?.minimized);
      await wait("pond is still painted behind desktop icons", async () => matches(await pixel()));
      assert.equal(await pond.eval("window.wallpaper.state().then(s => s.on)"), true);
      await command();
      await wait("second press restores just-minimized window", async () => (await fixtureWindow())?.minimized === false);
    } finally {
      if (toggled) await command().catch(() => {});
      client.stop();
      if (testGuard) await settings.eval("window.tangliDock.takeover(false)").catch(() => {});
    }
    console.log("PASS Show Desktop minimizes normal Pond windows and preserves the desktop wallpaper");
  }
  async function checkClash(settings) {
    await settings.eval("document.querySelector('#enabled').click()");
    const dock = await page("/web/dock/bar.html");
    await wait("Dock visible", async () => (await inspect(browserPid)).visible);
    await settings.eval("document.querySelector('#takeover').click()");
    await wait("takeover ready", () => settings.eval("window.tangliDock.state().then(s => s.takeover)"));
    const client = native.client("desktop", ["0"]);
    const pin = `[...document.querySelectorAll('.item')].find(i => i.dataset.id === "app:${clashAppId}")`;
    const runningTile = "[...document.querySelectorAll('.item')].find(i => i.title === 'Clash Verge' && i.dataset.running === 'true')";
    const windows = async () => (await client.request("windows", { monitorWindow: "0" })).windows;
    const windowState = async () => (await windows()).find((win) => /\\clash-verge\.exe$/i.test(win.path));
    const activeWindow = async () => {
      const win = await windowState();
      return win?.active && !win.minimized && win;
    };
    const activateTile = (button) => dock.eval(`window.tangliDock.item((${button}).dataset.id, 0, 0)`);
    try {
      appFixture = spawn(probe, ["foreground"], { windowsHide: true, stdio: "ignore" });
      const fixture = await wait("independent foreground fixture", async () =>
        (await windows()).find((win) => win.title === "Tangli foreground fixture"));
      if (!fixture.active) await client.request("activate", { handle: fixture.id, toggle: false });
      await wait("Clash Verge running tile is inactive", () => dock.eval(`(${runningTile})?.dataset.active === "false"`));
      await activateTile(runningTile);
      const existing = await wait("Clash Verge comes to the foreground", activeWindow);
      await activateTile(runningTile);
      await wait("Clash Verge is minimized", async () => (await windowState())?.minimized);
      await activateTile(runningTile);
      assert.equal((await wait("Clash Verge restored from minimization", activeWindow)).id, existing.id);

      await dock.eval("document.querySelector('#search').click()");
      const search = await page("/web/dock/search.html");
      await search.eval(`(async () => {
        const { rows } = await window.tangliDock.query("Clash Verge", "app");
        const item = rows.find(row => row.target.toLowerCase() === "${clashAppId}");
        await window.tangliDock.searchAction("pin", item.id);
        await window.tangliDock.hideSearch();
      })()`);
      await wait("Clash Verge is pinned", () => dock.eval(`(${pin})?.dataset.running === "true"`));
      await run(probe, ["hide", existing.id], { windowsHide: true });
      await wait("the main window is hidden in the tray", async () => !await windowState());
      await wait("the pinned entry is still present", () => dock.eval(`(${pin})?.dataset.running === "false"`));
      await activateTile(pin);
      assert.equal((await wait("Clash Verge shown from the tray", activeWindow)).id, existing.id);
      assert.equal(await dock.eval("document.querySelector('#bar-status').textContent"), "");
    } catch (error) {
      console.error("Clash Verge state", {
        windows: (await windows()).filter((win) => win.active || /\\clash-verge\.exe$/i.test(win.path))
          .map(({ name, id, active, minimized }) => ({ name, id, active, minimized })),
        notice: await dock.eval("document.querySelector('#bar-status').textContent"),
      });
      throw error;
    } finally {
      client.stop();
      if (appFixture?.exitCode === null) appFixture.kill();
      await settings.eval("window.tangliDock.takeover(false)");
      await wait("taskbar restored after Clash Verge check", async () =>
        await taskbar() === before && !await fs.access(nativeDir).then(() => true, () => false));
    }
    console.log("PASS Clash Verge window switching, minimization and tray reactivation");
  }
  try {
    for (const letter of "QRSTUVXYZ") {
      const candidate = letter + ":";
      if (await fs.access(candidate + "\\").then(() => true, () => false)) continue;
      if (await run(subst, [candidate, fixture], { windowsHide: true }).then(() => true, () => false)) {
        drive = candidate;
        break;
      }
    }
    assert.ok(drive, "available temporary drive");
    const legacy = { type: "app", target: "notepad.exe", name: "记事本" };
    const calculator = "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App";
    const ids = (await run(ps, ["-NoProfile", "-Command", "(Get-StartApps).AppID"], { windowsHide: true })).stdout.toLowerCase();
    const checkCalc = ids.includes(calculator.toLowerCase());
    const checkLegacy = ids.includes("}\\notepad.exe");
    const link = path.join(directory, "custom.lnk");
    const makeShortcut = "$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:TANGLI_ICON_LINK);" +
      "$s.TargetPath=$env:SystemRoot+'\\System32\\notepad.exe';$s.IconLocation=$env:SystemRoot+'\\System32\\shell32.dll,167';$s.Save()";
    await run(ps, ["-NoProfile", "-Command", makeShortcut], { windowsHide: true, env: { ...process.env, TANGLI_ICON_LINK: link } });
    await fs.mkdir(path.join(data, "dock"));
    const seed = [{ type: "path", target: link, name: "Shortcut fixture" }];
    if (testClash) assert.ok(testGuard && ids.includes(clashAppId), "Clash Verge must be installed and tested with --taskbar");
    if (checkCalc) seed.push({ type: "app", target: calculator, name: "计算器" });
    if (checkLegacy) seed.push(legacy);
    await fs.writeFile(path.join(data, "dock", "preferences.json"), JSON.stringify({ pins: seed }));
    launch();
    const { pond, settings } = await openedSettings();
    const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    browser = await debuggerPage(version.webSocketDebuggerUrl, false);
    pages.push(browser);
    const list = await browser.command("SystemInfo.getProcessInfo");
    browserPid = list.processInfo.find((process) => process.type === "browser")?.id;
    assert.ok(browserPid > 0);
    if (!packaged) assert.equal(browserPid, child.pid);
    if (testShowDesktop) return await checkShowDesktop(pond, settings);
    if (testClash) return await checkClash(settings);
    await pond.command("Page.addScriptToEvaluateOnNewDocument", { source: `
      localStorage.setItem('bitan.place',JSON.stringify({name:'杭州',lat:30.27,lon:120.15,tz:'Asia/Shanghai'}));
      const originalFetch=window.fetch;
      window.fetch=(url,...args)=>String(url).startsWith('https://api.open-meteo.com/v1/forecast?')
        ? Promise.resolve(Response.json({current:{temperature_2m:18,weather_code:1,wind_speed_10m:5},
            daily:{weather_code:[1,3,61],temperature_2m_min:[12,13,11],temperature_2m_max:[18,19,16]},timezone:'Asia/Shanghai'}))
        : originalFetch(url,...args);` });
    await pond.command("Page.reload");
    await wait("current weather in compact card", () => pond.eval("document.querySelector('#now-label')?.textContent.includes('18°C')"));
    async function checkCard(view) {
      await wait("journal " + view, () => pond.eval(`document.querySelector('#journal').dataset.view === '${view}' && !document.querySelector('#journal').hidden && document.querySelector('#journal-detail').hidden === ${view === "compact"}`));
    }
    const press = (id) => pond.eval("document.getElementById(" + JSON.stringify(id) + ").click()");
    async function journalShot(view) {
      if (!process.env.TANGLI_DOCK_PROOFS) return;
      const clip = await pond.eval("(() => {const r=document.querySelector('#journal').getBoundingClientRect();return {x:r.x-6,y:r.y-6,width:r.width+12,height:r.height+12,scale:1}})()");
      const shot = await pond.command("Page.captureScreenshot", { format:"png", clip });
      await fs.writeFile(path.join(proofs, "journal-" + view + ".png"), Buffer.from(shot.data,"base64"));
    }
    await checkCard("compact");
    await press("journal-toggle");
    await checkCard("expanded");
    assert.deepEqual(await pond.eval("[...document.querySelectorAll('#days .day em')].map(x=>x.textContent)"), ["多云","阴","小雨"]);
    await press("task-add");
    await pond.eval("document.querySelector('#task-input').value='整理今天的笔记'; document.querySelector('#task-form').requestSubmit()");
    await pond.eval("document.querySelector('#task-list input').click()");
    await press("timer-toggle");
    await press("journal-toggle");
    assert.ok((await pond.eval("document.querySelector('#timer-status').textContent")).includes("专注中"));
    await journalShot("compact");
    await press("journal-toggle");
    await press("timer-toggle");
    assert.ok((await pond.eval("document.querySelector('#timer-status').textContent")).includes("已暂停"));
    await press("journal-hide");
    await pond.command("Page.reload");
    await wait("hidden journal survives reload", () => pond.eval("!!window.pondJournal && document.querySelector('#journal').hidden"));
    await pond.eval("document.querySelector('#pond').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:200,clientY:200})); [...document.querySelectorAll('#menu button')].find(b=>b.textContent==='显示池畔小记').click()");
    await checkCard("expanded");
    assert.equal(await pond.eval("document.querySelector('#task-list input').checked"), true);
    await press("btn-fish");
    assert.ok(await pond.eval("!document.querySelector('#overlay-fish').classList.contains('hidden')"));
    await pond.eval("document.querySelector('[data-close=overlay-fish]').click()");
    if (testWallpaper) {
      assert.equal(await pond.eval("window.wallpaper.toggle().then(s => s.on)"), true);
      await wait("wallpaper input forwarding ready", () => pond.eval("document.body.classList.contains('wallpaper-mode') && typeof window.__desk === 'function'"));
      await pond.eval("(() => { const r=document.querySelector('#task-add').getBoundingClientRect(); for(const type of ['down','up']) window.__desk(type,r.x+r.width/2,r.y+r.height/2,0) })()");
    } else {
      await pond.eval("document.body.classList.add('wallpaper-mode'); document.querySelector('#task-add').click()");
    }
    const editor = await page("/web/journal-entry.html");
    await wait("editor form and isolated preload ready", () => editor.eval("document.readyState === 'complete' && !!document.querySelector('#task-form')?.onsubmit && !!window.journalEditor?.submit"));
    await editor.eval("document.querySelector('#task-input').value='给锦鲤投喂'; document.querySelector('#task-form').requestSubmit()");
    await wait("wallpaper editor saves back into the card", async () => {
      const names = await pond.eval("[...document.querySelectorAll('#task-list label')].map(x=>x.textContent)");
      assert.ok(names.includes("给锦鲤投喂"), JSON.stringify(names));
      return true;
    });
    if (testWallpaper) await wait("restored pond window", () => pond.eval("window.wallpaper.toggle().then(s => !s.on)"));
    else await pond.eval("document.body.classList.remove('wallpaper-mode')");
    await journalShot("expanded");
    await settings.eval("document.querySelector('#enabled').click()");
    const dock = await page("/web/dock/bar.html");
    await wait("Dock material initial", () => dock.eval("document.querySelector('#bar').dataset.edge === 'bottom'"));
    const iconClient = native.client("icons", ["0"]);
    try {
      async function checkIcon(name, identity) {
        const expected = await iconClient.request("icon", { appId: "", file: "", handle: "0", shortcutIcon: "", shortcutIndex: 0, shortcutTarget: "", ...identity });
        assert.ok(expected.length > 150, name + " resolves to a shell image");
        const target = "([...document.querySelectorAll('.item')].find(i=>i.title.startsWith(" + JSON.stringify(name) + ")))";
        try {
          await wait(name + " matches the actual native icon", () => dock.eval(
            "(" + target + "?.querySelector('img')?.src || '') === " + JSON.stringify("data:image/png;base64," + expected)));
        } catch (error) {
          console.error("Icon mismatch", name, await dock.eval(target + "?.dataset.id"));
          const actual = await dock.eval(target + "?.querySelector('img')?.src || ''");
          await fs.writeFile(path.join(proofs, "actual-pin.png"), Buffer.from(actual.split(",")[1] || "", "base64"));
          await fs.writeFile(path.join(proofs, "expected-pin.png"), Buffer.from(expected, "base64"));
          throw error;
        }
        return expected;
      }
      const custom = await checkIcon("Shortcut fixture", { file: link, shortcutIcon: path.join(sys, "shell32.dll"), shortcutIndex: 167 });
      if (checkCalc) assert.notEqual(await checkIcon("计算器", { appId: calculator }), custom);
      if (checkLegacy) assert.notEqual(await checkIcon("记事本", { appId: "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\notepad.exe" }), custom);
    } finally { iconClient.stop(); }
    const modeFile = path.join(directory, "plate-mode.txt");
    plate = spawn(probe, ["plate", path.join(root, "web", "pond-bed.jpg"), modeFile], { windowsHide: true, stdio: "ignore" });
    await delay(600);
    const measured = {};
    for (const material of ["transparent", "solid", "frosted"]) {
      await settings.eval(`document.querySelector('[data-material="${material}"]').click()`);
      await wait("material " + material, () => dock.eval(`document.querySelector('#bar').dataset.material === ${JSON.stringify(material)}`));
      await fs.writeFile(modeFile, "pattern");
      await delay(700);
      measured[material] = await inspect(browserPid, path.join(proofs, material + "-pattern.png"));
      await fs.writeFile(modeFile, "scene");
      await delay(450);
      await inspect(browserPid, path.join(proofs, material + ".png"));
    }
    const glass = measured.frosted, clear = measured.transparent;
    const engine = await dock.eval("document.querySelector('#bar').dataset.backdrop");
    console.log("Desktop pixel probe", JSON.stringify({ engine, measured }));
    assert.ok(clear.fine > 55 && clear.broad > 55, "pattern visible through the clear Dock");
    if (engine === "native") {
      assert.ok(glass.fine < clear.fine * .24, "native glass diffuses fine background detail");
      assert.ok(glass.broad > 8 && glass.broad > glass.fine * 2, "broad tones remain visible through glass");
    }
    assert.ok(measured.solid.broad < 4, "graphite blocks the background");
    plate.kill();
    await settings.eval("document.querySelector('#layout').value='full'; document.querySelector('#layout').dispatchEvent(new Event('change'))");
    await wait("full style", () => dock.eval("document.querySelector('#bar').dataset.full === 'true'"));
    await settings.eval("document.querySelector('#followPond').click()");
    await pond.eval("window.scenePreview.set('time', 'night')");
    await wait("Pond night styling", () => dock.eval("document.querySelector('#bar').dataset.scene === 'night'"));
    await wait("native running app items", () => dock.eval("document.querySelectorAll('[data-running=true]').length > 0"));

    const source = path.join(directory, "dock-fixture.cs");
    const appFixtureExecutable = path.join(directory, "TangliDockFixture.exe");
    await fs.writeFile(source, 'using System; using System.Drawing; using System.Windows.Forms; class Fixture { [STAThread] static void Main(string[] args) { Application.Run(new Form { Text = "Tangli Dock smoke fixture", Icon = new Icon(args[0]), Width = 400, Height = 160 }); } }');
    const csc = path.join(process.env.SystemRoot, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
    await run(csc, ["/nologo", "/target:winexe", "/out:" + appFixtureExecutable, "/r:System.Windows.Forms.dll", "/r:System.Drawing.dll", source], { windowsHide: true });
    const appIcon = path.join(root, "assets", "tangli-icon.ico");
    appFixture = spawn(appFixtureExecutable, [appIcon], { stdio: "ignore" });
    const fixtureButton = `[...document.querySelectorAll(".item")].find(i => i.dataset.id.endsWith("tanglidockfixture.exe"))`;
    await wait("fixture appears on Dock", () => dock.eval(`!!(${fixtureButton})`));
    const windowClient = native.client("desktop", ["0"]);
    try {
      const windows = (await windowClient.request("windows", { monitorWindow: "0" })).windows;
      const handle = windows.find(w => w.title === "Tangli Dock smoke fixture").id;
      const spec = { appId: "", handle, file: "", shortcutIcon: "", shortcutTarget: "", shortcutIndex: 0 };
      const live = await windowClient.request("icon", spec);
      assert.ok(live.length > 250);
      try {
        await wait("live custom window icon is actually displayed", () => dock.eval(
          `(${fixtureButton})?.querySelector('img')?.src === ${JSON.stringify("data:image/png;base64," + live)}`));
      } catch (error) {
        const actual = await dock.eval(`(${fixtureButton})?.querySelector('img')?.src || ''`);
        await fs.writeFile(path.join(proofs, "actual-window-icon.png"), Buffer.from(actual.split(",")[1] || "", "base64"));
        await fs.writeFile(path.join(proofs, "expected-window-icon.png"), Buffer.from(live, "base64"));
        throw error;
      }
    } finally { windowClient.stop(); }
    const wasActive = await dock.eval(`(${fixtureButton}).dataset.active === "true"`);
    await dock.eval(`(${fixtureButton}).click()`);
    await wait("native app window switches", () => dock.eval(`(${fixtureButton})?.dataset.active === "${!wasActive}"`));
    await dock.eval(`(${fixtureButton}).click()`);
    await wait("native app window toggles back", () => dock.eval(`(${fixtureButton})?.dataset.active === "${wasActive}"`));
    secondFixture = spawn(appFixtureExecutable, [appIcon], { stdio: "ignore" });
    await wait("second window is grouped", () => dock.eval(`(${fixtureButton})?.querySelector(".window-count")?.textContent === "2"`));
    await dock.eval(`(${fixtureButton}).click()`);
    const previewProbe = [
      "Add-Type 'using System; using System.Runtime.InteropServices; public static class PreviewWindowProbe {",
      '[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string name, string title);',
      '[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd); }\'',
      "[PreviewWindowProbe]::IsWindowVisible([PreviewWindowProbe]::FindWindow([NullString]::Value, '选择窗口'))",
    ].join("\n");
    const encoded = Buffer.from(previewProbe, "utf16le").toString("base64");
    await wait("native window preview is visible", async () =>
      (await run(ps, ["-NoProfile", "-EncodedCommand", encoded], { windowsHide: true })).stdout.trim() === "True");
    secondFixture.kill();
    appFixture.kill();
    await wait("closed window is removed", () => dock.eval(`!(${fixtureButton})`));

    await dock.eval("document.querySelector('#search').click()");
    const search = await page("/web/dock/search.html");
    await wait("temporary drive recognized", () => settings.eval(`[...document.querySelectorAll('#drives input')].some(x => x.value.startsWith(${JSON.stringify(drive)}))`));
    await settings.eval(`[...document.querySelectorAll('#drives input')].find(x => x.value.startsWith(${JSON.stringify(drive)})).click(); document.querySelector('#save-index').click()`);
    await wait("local index ready", () => search.eval(`window.tangliDock.indexStatus().then(list => list.some(d => d.root.startsWith(${JSON.stringify(drive)}) && d.state === 'ready'))`));
    const typeQuery = (text) => search.eval(`document.querySelector('#query').value = ${JSON.stringify(text)}; document.querySelector('#query').dispatchEvent(new Event('input'))`);
    await typeQuery(drive + " ext:txt 独立索引");
    await wait("local result", () => search.eval("document.querySelector('.result strong')?.textContent === '塘里独立索引烟测.txt'"));
    await search.eval("document.querySelector('.result').dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, clientX:100, clientY:120})); [...document.querySelectorAll('#result-menu button')].find(b => b.textContent === '固定到 Dock').click();");
    await wait("result pinned to Dock", () => dock.eval("[...document.querySelectorAll('.item')].some(x => x.title === '塘里独立索引烟测.txt')"));
    await typeQuery(drive + " 验收文件夹");
    await wait("folder from selected disk", () => search.eval("document.querySelector('.result strong')?.textContent === '塘里验收文件夹'"));
    await search.eval("document.querySelector('.result').dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, clientX:100, clientY:120})); [...document.querySelectorAll('#result-menu button')].find(b => b.textContent === '固定到 Dock').click();");
    await wait("folder pinned to Dock", () => dock.eval("[...document.querySelectorAll('.item')].some(x => x.title === '塘里验收文件夹')"));
    await fs.rename(file, path.join(fixture, "塘里变更跟踪.txt"));
    await wait("rename reflected in search", async () => {
      await typeQuery(drive + " 变更跟踪");
      await delay(440);
      return search.eval("document.querySelector('.result strong')?.textContent === '塘里变更跟踪.txt'");
    });

    if (testGuard) {
      const boundsOf = (p) => [p.x, p.y, p.width, p.height];
      await settings.eval("window.tangliDock.save({layout:'floating',edge:'bottom',autohide:false})");
      await wait("floating before takeover", () => dock.eval("document.querySelector('#bar').dataset.full === 'false'"));
      const floating = await inspect(browserPid);
      await settings.eval("document.querySelector('#takeover').click()");
      await wait("takeover ready", async () => {
        const message = await settings.eval("document.querySelector('#settings-status')?.textContent");
        if (message && !message.startsWith("已应用")) assert.fail(message);
        const observed = await settings.eval("window.tangliDock.state().then(s => [s.takeover,s.takingOver,document.querySelector('#takeover').disabled,document.querySelector('#takeover').textContent])");
        assert.deepEqual(observed.slice(0, 3), [true,false,false], JSON.stringify(observed));
        assert.equal((await taskbar()) & 1, 1);
        return true;
      });
      const active = await inspect(browserPid);
      assert.equal(active.taskbarVisible, false, "Explorer taskbar HWND hidden");
      assert.deepEqual([active.y, active.height], [floating.y, floating.height], "floating Dock keeps its vertical position");
      assert.ok(Math.abs((active.x + active.width / 2) - (floating.x + floating.width / 2)) <= 1,
        "floating Dock stays centered while the app list changes");
      maximizedFixture = spawn(probe, ["max", "hold"], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
      let output = "", fixtureError;
      maximizedFixture.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
      maximizedFixture.on("error", (error) => { fixtureError = error; });
      const maximized = await wait("maximized fixture measures its frame", () => {
        if (fixtureError) throw fixtureError;
        return output.includes("\n") && JSON.parse(output);
      });
      console.log("Maximized DWM frame and desktop bin", maximized, binBefore, await binView());
      assert.deepEqual(maximized.work, maximized.screen, "Dock leaves the full monitor available");
      for (let i = 0; i < 4; i++) assert.ok(Math.abs(maximized.frame[i] - maximized.screen[i]) <= 2, "maximized frame meets screen edge");
      const [left, top, rightEdge, bottom] = maximized.screen;
      const edgeX = active.x + Math.floor(active.width / 2);
      await cursor(left + 10, top + 10);
      await wait("maximized foreground hides floating Dock", async () => !(await inspect(browserPid)).visible);
      await cursor(edgeX, bottom - 1);
      await wait("physical screen edge reveals Dock over maximized window", async () => (await inspect(browserPid)).visible);
      await cursor(edgeX, active.y + Math.floor(active.height / 2));
      await delay(650);
      assert.equal((await inspect(browserPid)).visible, true, "Dock stays visible with pointer over icons");
      const maxButton = "[...document.querySelectorAll('.item')].find(i => i.title === 'visual-probe')";
      await wait("maximized fixture has an active Dock tile", () => dock.eval(`(${maxButton})?.dataset.active === "true"`));
      const clickTile = async (button) => {
        const rect = await dock.eval(`(() => { const r=(${button}).getBoundingClientRect(); return [r.x+r.width/2,r.y+r.height/2,innerWidth,innerHeight]; })()`);
        const p = await inspect(browserPid);
        await cursor(Math.round(p.x + rect[0] * p.width / rect[2]), Math.round(p.y + rect[1] * p.height / rect[3]), "click");
      };
      await clickTile(maxButton);
      await wait("native Dock click minimizes the foreground window", () => dock.eval(`(${maxButton})?.dataset.active === "false"`));
      await clickTile(maxButton);
      await wait("native Dock click restores the minimized window to foreground", () => dock.eval(`(${maxButton})?.dataset.active === "true"`));
      await cursor(left + 10, top + 10);
      await wait("floating Dock hides again when pointer leaves", async () => !(await inspect(browserPid)).visible);
      maximizedFixture.kill();
      await wait("floating Dock returns without a maximized window", async () => (await inspect(browserPid)).visible);
      if (checkLegacy) {
        const apps = native.client("desktop", ["0"]);
        let launched = [];
        try {
          const notepad = async () => (await apps.request("windows", { monitorWindow: "0" })).windows
            .filter((win) => /\\notepad\.exe$/i.test(win.path));
          if (!(await notepad()).length) {
            const pin = "[...document.querySelectorAll('.item')].find(i => i.dataset.id.startsWith('app:{') && i.dataset.id.endsWith('notepad.exe'))";
            await dock.eval(`(${pin}).click()`);
            launched = await wait("a fixed Start menu app launches from its Shell ID during takeover", async () => {
              const found = await notepad();
              return found.length && found;
            });
          }
        } finally {
          for (const win of launched) await apps.request("close", { handle: win.id }).catch(() => {});
          apps.stop();
        }
      }
      assert.equal(await settings.eval("document.querySelector('#autohide').disabled"), false);
      await settings.eval("document.querySelector('#autohide').click()");
      await wait("auto-hide preference is applied during takeover", () => settings.eval("window.tangliDock.state().then(s => s.settings.autohide)"));
      await wait("takeover auto-hide hides with a normal foreground window", async () => !(await inspect(browserPid)).visible);
      await cursor(edgeX, bottom - 1);
      await wait("takeover auto-hide reveals from the physical screen edge", async () => (await inspect(browserPid)).visible);
      await cursor(left + Math.floor((rightEdge - left) / 2), top + 10);
      await wait("takeover auto-hide hides after leaving the Dock", async () => !(await inspect(browserPid)).visible);
      await settings.eval("document.querySelector('#autohide').click()");
      await wait("turning off takeover auto-hide shows the Dock", async () => (await inspect(browserPid)).visible);
      await wait("desktop Recycle Bin is hidden", async () => await binView() === "hidden");
      await settings.eval("document.querySelector('#takeover').click()");
      try {
        await wait("normal restoration", async () => !(await settings.eval("window.tangliDock.state().then(s => s.takeover)")) && await taskbar() === before);
      } catch (error) {
        console.error("restoration", { before, now: await taskbar(), guard: await settings.eval("window.tangliDock.state().then(s=>[s.takeover,s.takingOver])"),
          button: await settings.eval("[document.querySelector('#takeover').disabled,document.querySelector('#settings-status').textContent]"),
          journal: await fs.readFile(nativeDir, "utf8").catch(() => ""), shell: await inspect(browserPid) });
        throw error;
      }
      assert.equal(await workHeight(), previousArea, "work area after normal restoration");
      await wait("desktop Recycle Bin restored", async () => await binView() === binBefore);
      assert.equal((await inspect(browserPid)).taskbarVisible, floating.taskbarVisible);
      await settings.eval("window.tangliDock.save({layout:'full',edge:'right'})");
      await wait("right before takeover", () => dock.eval("document.querySelector('#bar').dataset.edge === 'right' && document.querySelector('#bar').dataset.full === 'true'"));
      const right = await inspect(browserPid);
      await settings.eval("document.querySelector('#takeover').click()");
      await wait("second takeover", () => settings.eval("window.tangliDock.state().then(s => s.takeover)"));
      const side = await inspect(browserPid);
      assert.equal(side.taskbarVisible, false);
      assert.deepEqual(boundsOf(side), boundsOf(right), "right Dock stays on its configured edge");
      assert.equal((await fs.readFile(nativeDir, "utf8")).split(/\r?\n/)[2], right.taskbarVisible ? "visible" : "hidden");
      await run(path.join(sys, "taskkill.exe"), ["/F", "/PID", String(browserPid)], { windowsHide: true });
      try {
        await wait("crash restoration", async () => await taskbar() === before && !await fs.access(nativeDir).then(() => true, () => false));
      } catch (error) {
        const record = await fs.readFile(nativeDir, "utf8").catch(() => "");
        console.error({ before, current: await taskbar(), record, electronExited: child.exitCode !== null });
        throw error;
      }
      assert.equal(await workHeight(), previousArea, "work area after forced exit");
      await wait("desktop Recycle Bin restored after crash", async () => await binView() === binBefore);
      assert.equal((await inspect(0)).taskbarVisible, right.taskbarVisible, "Explorer visibility after forced exit");
      console.log("Native Dock bounds before / during takeover", JSON.stringify({ bottom: [floating, active], right: [right, side] }));
    }
    const preferences = JSON.parse(await fs.readFile(path.join(data, "dock", "preferences.json"), "utf8"));
    assert.ok(preferences.pins.some((pin) => pin.name === "塘里独立索引烟测.txt"));
    assert.ok(preferences.pins.some((pin) => pin.name === "塘里验收文件夹"));
    assert.equal(preferences.layout, "full");
    if (testClose && !testGuard) {
      await pond.eval("setTimeout(() => window.close(), 100)");
      await wait("closing the pond also exits Dock", async () =>
        !await fetch(`http://127.0.0.1:${port}/json/version`).then(() => true, () => false));
    }
    console.log("PASS Dock materials, layout, Pond palette, live window switching and multi-window preview, file/folder search and pinning, live rename" +
      (testGuard ? ", normal and forced-exit taskbar restoration" : testClose ? ", clean app exit with Dock open" : ""));
  } catch (error) {
    if (consoleErrors) console.error(consoleErrors);
    const events = await fs.readFile(path.join(data, "dock-error.log"), "utf8").catch(() => "");
    if (events) console.error(events.slice(-4000));
    throw error;
  } finally {
    if (appFixture?.exitCode === null) appFixture.kill();
    if (secondFixture?.exitCode === null) secondFixture.kill();
    if (maximizedFixture?.exitCode === null) maximizedFixture.kill();
    if (plate?.exitCode === null) plate.kill();
    await stop().catch(() => {});
    pages.forEach((page) => page.close());
    if (testGuard) {
      await run(binary, ["repair", nativeDir], { windowsHide: true }).catch(() => {});
      await cursor(...previousCursor).catch(() => {});
      assert.equal(await taskbar(), before, "final native taskbar state");
    }
    if (drive) await run(subst, [drive, "/D"], { windowsHide: true });
    assert.match(path.relative(os.tmpdir(), directory), /^tangli-dock-ui-[^\\/]+$/);
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 }).catch(() => {});
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
