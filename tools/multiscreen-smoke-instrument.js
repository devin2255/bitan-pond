// Appended to main.js by multiscreen-smoke.cjs so it can exercise its lifecycle.
app.whenReady().then(() => setTimeout(async () => {
  const output = process.env.TANGLI_SMOKE_OUTPUT || path.join(__dirname, "dist");
  const result = path.join(output, "multiscreen-smoke.json");
  const assert = require("node:assert/strict");
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const wallpaperHash = () => {
    const check = spawnSync(psExe(), ["-NoProfile", "-NonInteractive", "-File", path.join(output, "..", "tools", "wallpaper-snapshot.ps1")],
      { windowsHide: true, encoding: "utf8", timeout: 10000 });
    if (check.status !== 0) throw new Error("Could not inspect Windows wallpaper: " + check.stderr);
    return check.stdout.trim();
  };
  try {
    const wallpaperBefore = wallpaperHash();
    const startRealInput = startDeskInput, stopRealInput = stopDeskInput;
    registerWallpaperHotkey = () => {}; unregisterWallpaperHotkey = () => {};
    startDeskInput = () => {}; stopDeskInput = () => {}; balloon = () => {};
    stopMusicWatcher();
    startRhythmCapture = () => {}; stopRhythmCapture = () => {};
    musicState = { available: false, playing: false };
    const physical = (await getWallpaperDisplays())[0].rect;
    assert(physical.width >= 800 && physical.height >= 600, "Integration test requires a screen at least 800 x 600");
    const split = Math.round(physical.width * 0.625);
    const make = (id, rect) => ({ id, rect, bounds: screen.screenToDipRect(null, rect) });
    let displays = [
      make(101, { ...physical, width: split }),
      make(202, { x: physical.x + split, y: physical.y + 180, width: physical.width - split, height: physical.height - 180 }),
    ];
    getWallpaperDisplays = async () => displays;
    await enterWallpaper();
    assert.equal(wallpaperWindows.size, 2);
    const first = wallpaperWindows.get(101), second = wallpaperWindows.get(202);
    await pause(800);
    const inputLines = [];
    const originalOnDeskLine = onDeskLine;
    onDeskLine = (line) => { inputLines.push(line); originalOnDeskLine(line); };
    startRealInput();
    await pause(1400);
    assert(deskProc && !deskProc.killed && inputLines.some((line) => line.startsWith("ready ")), "Desktop input hook did not start");
    // Unexpected termination should recover without forcing the user to
    // switch out of wallpaper mode.
    const oldInputPid = deskProc.pid;
    startDeskInput = startRealInput; stopDeskInput = stopRealInput;
    deskProc.kill();
    for (let i = 0; i < 40 && (!deskProc || deskProc.pid === oldInputPid); i++) await pause(250);
    assert(deskProc && deskProc.pid !== oldInputPid, "Desktop input hook did not restart");
    stopRealInput();
    startDeskInput = () => {}; stopDeskInput = () => {};
    onDeskLine = originalOnDeskLine;
    const inspect = (entry, js) => entry.window.webContents.executeJavaScript(js);
    const state = await Promise.all([first, second].map((entry) => inspect(entry,
      '({width:innerWidth,height:innerHeight,wallpaper:document.body.classList.contains("wallpaper-mode"),fish:Pond.getFishCounts()})')));
    assert(state.every((item) => item.width > 0 && item.height > 0 && item.wallpaper));
    assert.deepEqual(state[0].fish, state[1].fish);
    const captureProcess = (script, args) => new Promise((resolve, reject) => {
      const capture = spawn(psExe(), ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
        path.join(output, "..", "tools", script), ...args], { windowsHide: true });
      let error = "";
      capture.stderr.on("data", (chunk) => { error += chunk.toString(); });
      const timer = setTimeout(() => { capture.kill(); reject(new Error("Native capture timed out")); }, 30000);
      capture.on("error", (cause) => { clearTimeout(timer); reject(cause); });
      capture.on("close", (code) => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error("Native capture failed: " + error)); });
    });
    const surfaceRanges = [];
    for (let i = 0; i < 2; i++) {
      const entry = [first, second][i];
      fs.writeFileSync(path.join(output, `multiscreen-renderer-${i}.png`), (await entry.window.webContents.capturePage()).toPNG());
      // PrintWindow asks the owning UI process to paint; keep Electron's event
      // loop running while the separate capture process waits for that paint.
      await captureProcess("capture-wallpaper-window.ps1", ["-Hwnd", hwndOf(entry.window),
        "-Output", path.join(output, `multiscreen-native-${i}.png`)]);
      assert.equal(entry.window.isVisible(), true, "A desktop window is still hidden");
      const picture = nativeImage.createFromPath(path.join(output, `multiscreen-native-${i}.png`));
      const size = picture.getSize(), bytes = picture.toBitmap();
      assert.equal(size.width, entry.rect.width); assert.equal(size.height, entry.rect.height);
      let lo = 255, hi = 0;
      for (let y = 0; y < size.height; y += Math.max(1, Math.floor(size.height / 45))) {
        for (let x = 0; x < size.width; x += Math.max(1, Math.floor(size.width / 55))) {
          const n = (y * size.width + x) * 4;
          const brightness = (bytes[n] + bytes[n + 1] + bytes[n + 2]) / 3;
          lo = Math.min(lo, brightness); hi = Math.max(hi, brightness);
        }
      }
      surfaceRanges.push({ index: i, range: hi - lo });
    }
    // This deliberately captures the test machine's whole screen only when
    // opted in; regular developer runs do not capture unrelated applications.
    if (process.env.TANGLI_TEST_SCREEN_CAPTURE === "1") {
      await captureProcess("capture-test-screen.ps1", ["-Output", path.join(output, "multiscreen-screen.png")]);
    }
    for (const surface of surfaceRanges) assert(surface.range > 24, `Native desktop surface ${surface.index} appears blank (${surface.range})`);
    // Exercise the same physical-to-renderer input route used on the desktop,
    // including both right-side controls on each independently sized screen.
    const desktopClick = async (entry, selector) => {
      const point = await inspect(entry, `(() => { const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:(r.left+r.width/2)/innerWidth,y:(r.top+r.height/2)/innerHeight}; })()`);
      const x = Math.round(entry.rect.x + point.x * entry.rect.width), y = Math.round(entry.rect.y + point.y * entry.rect.height);
      onDeskLine("down " + x + " " + y + " 0"); onDeskLine("up " + x + " " + y + " 0");
      await pause(300);
    };
    for (const entry of [first, second]) {
      await desktopClick(entry, "#btn-demo");
      assert.equal(await inspect(entry, '!document.getElementById("demo-menu").classList.contains("hidden")'), true, "desktop weather/season menu did not open");
      await desktopClick(entry, "#btn-demo");
      await desktopClick(entry, "#btn-fish");
      assert.equal(await inspect(entry, '!document.getElementById("overlay-fish").classList.contains("hidden")'), true, "desktop pond settings did not open");
      await desktopClick(entry, '[data-close="overlay-fish"]');
      assert.equal(await inspect(entry, 'document.getElementById("overlay-fish").classList.contains("hidden")'), true);
    }
    // An isolated CI desktop can also deliver genuine Windows mouse events;
    // this checks the low-level hook rather than just its JavaScript route.
    if (process.env.TANGLI_TEST_NATIVE_INPUT === "1") {
      startDeskInput = startRealInput; stopDeskInput = stopRealInput;
      onDeskLine = (line) => { inputLines.push(line); originalOnDeskLine(line); };
      const count = inputLines.length;
      startRealInput();
      for (let i = 0; i < 30 && !inputLines.slice(count).some((line) => line.startsWith("ready ")); i++) await pause(200);
      assert(inputLines.slice(count).some((line) => line.startsWith("ready ")), "Native hook is not ready");
      const physicalClick = async (entry, selector) => {
        const point = await inspect(entry, `(() => { const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:(r.left+r.width/2)/innerWidth,y:(r.top+r.height/2)/innerHeight}; })()`);
        const x = Math.round(entry.rect.x + point.x * entry.rect.width), y = Math.round(entry.rect.y + point.y * entry.rect.height);
        await captureProcess("native-test-click.ps1", ["-X", String(x), "-Y", String(y)]);
        await pause(300);
      };
      for (const entry of [first, second]) {
        await physicalClick(entry, "#btn-demo");
        assert.equal(await inspect(entry, '!document.getElementById("demo-menu").classList.contains("hidden")'), true, "A real desktop click did not open the season menu");
        await desktopClick(entry, "#btn-demo");
        await physicalClick(entry, "#btn-fish");
        assert.equal(await inspect(entry, '!document.getElementById("overlay-fish").classList.contains("hidden")'), true, "A real desktop click did not open pond settings");
        await desktopClick(entry, '[data-close="overlay-fish"]');
      }
      stopRealInput(); startDeskInput = () => {}; stopDeskInput = () => {}; onDeskLine = originalOnDeskLine;
    }
    await Promise.all([first, second].map((entry) => inspect(entry,
      'window.__points=[]; document.addEventListener("pointerdown",e=>window.__points.push([e.clientX,e.clientY]),true); true')));
    for (const item of [first, second]) {
      const x = Math.round(item.rect.x + item.rect.width / 2), y = Math.round(item.rect.y + item.rect.height / 2);
      onDeskLine("down " + x + " " + y + " 0");
      onDeskLine("up " + x + " " + y + " 0");
    }
    await pause(250);
    for (let i = 0; i < 2; i++) {
      const points = await inspect([first, second][i], "window.__points");
      assert.equal(points.length, 1);
      assert(Math.abs(points[0][0] - state[i].width / 2) < 2);
      assert(Math.abs(points[0][1] - state[i].height / 2) < 2);
    }
    await inspect(first, 'Pond.setBossVisible(false); Pond.setFishCounts({...Pond.getFishCounts(),koi:3}); scenePreview.set("weather","rain"); true');
    await pause(600);
    const synced = await inspect(second, '({boss:Pond.bossVisible(),koi:Pond.getFishCounts().koi,rain:document.querySelector(\'[data-preview-key="weather"].on\').dataset.previewValue})');
    assert.deepEqual(synced, { boss: false, koi: 3, rain: "rain" });
    const locationCity = await inspect(first, `
      (async () => {
        const geo = navigator.geolocation, oldGeo = geo.getCurrentPosition, oldFetch = window.fetch;
        let completeLocation;
        geo.getCurrentPosition = (done) => { completeLocation = done; };
        window.fetch = () => new Promise(() => {});
        const control = document.getElementById("use-geo");
        control.checked = true; control.dispatchEvent(new Event("change"));
        document.querySelector('[data-name="广州"]').click();
        completeLocation({coords:{latitude:39.9,longitude:116.4}});
        await new Promise((resolve) => setTimeout(resolve, 100));
        geo.getCurrentPosition = oldGeo; window.fetch = oldFetch;
        return document.getElementById("place-label").textContent;
      })()
    `);
    assert.equal(locationCity, "广州");
    const weather = await inspect(first, `
      (async () => {
        const oldFetch = window.fetch, pending = [];
        window.fetch = () => new Promise((resolve) => pending.push(resolve));
        document.querySelector('[data-name="上海"]').click();
        document.querySelector('[data-name="广州"]').click();
        const response = (temperature) => ({ok:true, json:async () => ({
          current:{temperature_2m:temperature,weather_code:0,wind_speed_10m:0}
        })});
        pending[1](response(21));
        await new Promise((resolve) => setTimeout(resolve, 80));
        pending[0](response(9));
        await new Promise((resolve) => setTimeout(resolve, 150));
        window.fetch = oldFetch;
        return { city:document.getElementById("place-label").textContent,
          weather:document.getElementById("now-label").textContent };
      })()
    `);
    assert.deepEqual(weather, { city: "广州", weather: "晴 · 21°C" });
    await inspect(second, `
      localStorage.setItem("bitan.weather", JSON.stringify({
        place:{name:"上海",lat:31.2304,lon:121.4737},
        report:{current:{temperature_2m:9,weather_code:0,wind_speed_10m:0}}
      })); true
    `);
    await pause(200);
    assert.equal(await inspect(first, 'document.getElementById("place-label").textContent'), "广州");
    const fishNum = await inspect(first, '(function(){ const c=document.createElement("canvas"); c.width=4; c.height=4; c.getContext("2d").fillRect(0,0,4,4); return Pond.addCustom({name:"多屏测试",src:c.toDataURL(),v:2,scale:1}).num; })()');
    await pause(300);
    assert.equal(await inspect(second, 'Pond.getCustoms().some(f=>f.num===' + fishNum + ')'), true);
    await inspect(second, 'Pond.removeCustom(' + fishNum + '); true');
    await pause(300);
    assert.equal(await inspect(first, 'Pond.getCustoms().some(f=>f.num===' + fishNum + ')'), false);
    await inspect(second, "Pond.setFriendVisible(false); true");
    await pause(300);
    assert.equal(await inspect(first, "Pond.friendVisible()"), false);
    await Promise.all([first, second].map((entry) => inspect(entry,
      "window.__music=[]; systemMusic.onChange(s=>window.__music.push(s.playing)); true")));
    publishMusicState(true, true);
    await pause(200);
    assert.deepEqual(await inspect(first, "window.__music"), [true]);
    assert.deepEqual(await inspect(second, "window.__music"), [true]);
    fs.writeFileSync(path.join(output, "multiscreen-first.png"), (await first.window.webContents.capturePage()).toPNG());
    fs.writeFileSync(path.join(output, "multiscreen-second.png"), (await second.window.webContents.capturePage()).toPNG());
    displays = [displays[0], make(202, { x: physical.x + split, y: physical.y, width: physical.width - split, height: physical.height })];
    await refreshWallpaperDisplays();
    assert.deepEqual(wallpaperWindows.get(202).rect, displays[1].rect);
    displays = [displays[0]];
    await refreshWallpaperDisplays();
    assert.equal(wallpaperWindows.size, 1);
    displays = [displays[0], make(303, { x: physical.x + split, y: physical.y, width: physical.width - split, height: physical.height })];
    await refreshWallpaperDisplays();
    assert.equal(wallpaperWindows.size, 2);
    await pause(400);
    assert.equal(await inspect(wallpaperWindows.get(303), "Pond.bossVisible()"), false);
    displays = [displays[1], displays[0]];
    await refreshWallpaperDisplays();
    assert.equal(wallpaperWindows.get(303).window, win);
    assert.equal(wallpaperWindows.size, 2);
    await leaveSpecial();
    assert.equal(wallpaperWindows.size, 0);
    assert.equal(wallpaperOn, false);
    assert.deepEqual(win.getMinimumSize(), [1024, 680]);
    // Connect another display while the initial desktop attachment is in flight.
    const one = make(401, { ...physical, width: split });
    const two = make(402, { x: physical.x + split, y: physical.y, width: physical.width - split, height: physical.height });
    displays = [one];
    let firstQuery = true;
    getWallpaperDisplays = async () => {
      const snapshot = displays.slice();
      if (firstQuery) {
        firstQuery = false;
        setTimeout(() => { displays = [one, two]; scheduleDisplayRefresh(); }, 50);
        await pause(800);
      }
      return snapshot;
    };
    await enterWallpaper();
    for (let i = 0; i < 30 && (wallpaperWindows.size !== 2 || displayRefreshBusy); i++) await pause(250);
    assert.equal(wallpaperWindows.size, 2, "A display connected during startup must be added");
    await leaveSpecial();
    assert.equal(wallpaperHash(), wallpaperBefore, "The original Windows wallpaper must be preserved");
    fs.writeFileSync(result, JSON.stringify({ ok: true, physical, state, synced }));
    app.quit();
  } catch (error) {
    fs.writeFileSync(result, JSON.stringify({ ok: false, error: String(error.stack || error) }));
    try { await leaveSpecial(); } catch (_) {}
    app.quit();
  }
}, 3000));
