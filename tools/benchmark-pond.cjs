"use strict";
// Opt-in local benchmark. The actual pond runs with disposable user data and
// no desktop attachment or network.
const { app, BrowserWindow, session } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const args = process.argv.slice(2);
const value = (key, fallback) => (args.find((arg) => arg.startsWith("--" + key + "=")) || "").slice(key.length + 3) || fallback;
const root = path.resolve(__dirname, "..");
const webRoot = path.resolve(root, value("web", "web"));
const output = path.resolve(value("output", path.join(root, "dist", "pond-benchmark.json")));
const scenario = value("scenario", "clear");
const count = Math.max(1, Math.min(2, Number(value("screens", "1")) || 1));
const duration = Math.max(3000, Math.min(30000, Number(value("duration", "8000")) || 8000));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "tangli-benchmark-"));
app.setPath("userData", profile);
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
if (args.includes("--software")) {
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-gpu-compositing");
}

app.whenReady().then(async () => {
  try {
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: /^https?:/i.test(details.url) });
    });
    const windows = [];
    for (let i = 0; i < count; i++) {
      const win = new BrowserWindow({ width: 1920, height: 1080, frame: false, show: args.includes("--show"),
        webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false } });
      await win.loadFile(path.join(webRoot, "index.html"));
      windows.push(win);
    }
    await new Promise((resolve) => setTimeout(resolve, 7000));
    const code = "(async () => {" +
      "Pond.setAtmosphere({effect:" + JSON.stringify(scenario === "rain" ? "rain" : "clear") + ",wind:0,temperature:20});" +
      "Pond.setMusicPlaying(" + (scenario === "music" ? "true" : "false") + ");" +
      "await new Promise(r=>setTimeout(r,2000));return await new Promise(resolve=>{" +
      "const context=document.getElementById('pond').getContext('2d'),original=context.clearRect;" +
      (args.includes("--profile") ? "const methods=['drawImage','fill','fillRect','stroke','clearRect'];const totals={};for(const method of methods){const fn=context[method];context[method]=function(...a){const start=performance.now(),result=fn.apply(this,a),ms=performance.now()-start;const src=a[0];const kind=method==='drawImage'?':'+(src.tagName||'other')+':'+(src.width||src.naturalWidth)+'x'+(src.height||src.naturalHeight)+':'+this.globalCompositeOperation+':'+this.filter:'';const key=method+kind;const record=totals[key]||(totals[key]={count:0,ms:0,max:0});record.count++;record.ms+=ms;record.max=Math.max(record.max,ms);return result;};}const measuredClear=context.clearRect;" : "") +
      "const intervals=[];let previous=0,frames=0,first=performance.now();" +
      "context.clearRect=function(...args){const now=performance.now();if(previous)intervals.push(now-previous);previous=now;frames++;return " + (args.includes("--profile") ? "measuredClear" : "original") + ".apply(this,args);};" +
      "setTimeout(()=>{context.clearRect=original;const elapsed=performance.now()-first;intervals.sort((a,b)=>a-b);" +
      "resolve({fps:frames*1000/elapsed,frames,elapsed,p95:intervals[Math.floor(intervals.length*.95)]||0," +
      "width:innerWidth,height:innerHeight,dpr:devicePixelRatio,canvasWidth:context.canvas.width,canvasHeight:context.canvas.height," +
      "fish:Object.values(Pond.getFishCounts()).reduce((a,b)=>a+b,0),quality:Pond.getPerformanceStatus?Pond.getPerformanceStatus():null" + (args.includes("--profile") ? ",profile:totals" : "") + "});}," + duration + ");});})()";
    const stats = await Promise.all(windows.map((win) => win.webContents.executeJavaScript(code)));
    if (args.includes("--capture")) fs.writeFileSync(output.replace(/\.json$/i, ".png"), (await windows[0].webContents.capturePage()).toPNG());
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify({ ok: true, scenario, software: args.includes("--software"), stats }));
    windows.forEach((win) => win.destroy());
    app.exit(0);
  } catch (error) {
    fs.writeFileSync(output, JSON.stringify({ ok: false, error: String(error.stack || error) }));
    app.exit(1);
  }
});
