const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { setImmediate: yieldTurn, setTimeout: delay } = require("node:timers/promises");
const { parentPort, workerData } = require("node:worker_threads");
const { matchScore } = require("./search-model");

const volumes = new Map();
const ignoredDirectories = new Set(["system volume information", "$recycle.bin"]);
let newestQuery = 0;

function notify() {
  parentPort.postMessage({ type: "status", drives: [...volumes.values()].map((drive) => ({
    root: drive.root, state: drive.state, count: drive.files.size,
  })) });
}

function changed(drive, file) {
  if (drive.closed) return;
  if (!file || drive.pending.size >= 1024) drive.rebuild = true;
  else {
    const target = path.resolve(drive.root, file);
    if (target === workerData.directory || target.startsWith(workerData.directory + path.sep)) return;
    if (target.toLowerCase().startsWith(drive.root.toLowerCase())) drive.pending.add(target);
  }
  schedule(drive, 350);
}

function watch(drive) {
  if (drive.watcher || drive.closed) return;
  try {
    drive.watcher = fs.watch(drive.root, { recursive: true }, (event, file) => {
      if (event === "rename" || !file) changed(drive, file);
    });
    drive.watcher.on("error", () => {
      drive.watcher.close();
      drive.watcher = null;
      drive.rebuild = true;
      schedule(drive, 3000);
    });
  } catch { /* A disconnected drive is retried on the next scan. */ }
}

async function walk(root, files, drive) {
  const stack = [root];
  let seen = 0;
  while (stack.length && !drive.closed) {
    const folder = stack.pop();
    let dir;
    try { dir = await fsp.opendir(folder); }
    catch (error) {
      if (folder === drive.root) throw error;
      continue;
    }
    try {
      for await (const item of dir) {
        if (drive.closed) return;
        if (item.isSymbolicLink() || ignoredDirectories.has(item.name.toLowerCase())) continue;
        const full = path.join(folder, item.name);
        if (full === workerData.directory || full.startsWith(workerData.directory + path.sep)) continue;
        if (item.isDirectory()) stack.push(full);
        else if (!item.isFile()) continue;
        files.set(full.toLowerCase(), { target: full, kind: item.isDirectory() ? "folder" : "file" });
        if (++seen % 1536 === 0) await yieldTurn();
      }
    } catch (error) {
      if (folder === drive.root) throw error;
    }
  }
}

async function refreshPath(drive, full) {
  const key = full.toLowerCase();
  const old = drive.files.get(key);
  drive.files.delete(key);
  if (old?.kind === "folder") {
    const prefix = key + path.sep;
    for (const candidate of drive.files.keys()) {
      if (candidate.startsWith(prefix)) drive.files.delete(candidate);
    }
  }
  if (ignoredDirectories.has(path.basename(full).toLowerCase())) return;
  if (full === workerData.directory || full.startsWith(workerData.directory + path.sep)) return;
  let stat;
  try { stat = await fsp.lstat(full); } catch { return; }
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    drive.files.set(key, { target: full, kind: "folder" });
    await walk(full, drive.files, drive);
  } else if (stat.isFile()) {
    drive.files.set(key, { target: full, kind: "file" });
  }
}

function saveSoon(drive) {
  clearTimeout(drive.saveTimer);
  drive.saveTimer = setTimeout(async () => {
    if (drive.closed) return;
    if (drive.saving) { saveSoon(drive); return; }
    drive.saving = true;
    try {
      const snapshot = JSON.stringify([...drive.files.values()]);
      await fsp.writeFile(drive.cache + ".tmp", snapshot);
      if (!drive.closed) await fsp.rename(drive.cache + ".tmp", drive.cache);
      else await fsp.rm(drive.cache + ".tmp", { force: true });
    } catch { /* The live index remains available if the cache cannot be saved. */ }
    finally { drive.saving = false; }
  }, 5000);
}

function schedule(drive, ms) {
  if (drive.closed || drive.busy || drive.timer) return;
  drive.timer = setTimeout(() => {
    drive.timer = null;
    void synchronize(drive);
  }, ms);
}

async function synchronize(drive) {
  if (drive.closed || drive.busy) return;
  drive.busy = true;
  let retry = 0;
  try {
    watch(drive);
    if (drive.rebuild) {
      drive.rebuild = false;
      drive.pending.clear();
      drive.state = "scanning";
      notify();
      const next = new Map();
      await walk(drive.root, next, drive);
      if (drive.closed) return;
      drive.files = next;
    }
    const changes = [...drive.pending];
    drive.pending.clear();
    for (const target of changes) {
      if (drive.closed) return;
      await refreshPath(drive, target);
    }
    drive.state = "ready";
    saveSoon(drive);
    if (!drive.watcher) {
      drive.rebuild = true;
      retry = 30000;
    }
  } catch {
    drive.files.clear();
    drive.state = "offline";
    drive.rebuild = true;
    retry = 15000;
  } finally {
    drive.busy = false;
    if (!drive.closed) {
      notify();
      if (drive.pending.size || drive.rebuild) schedule(drive, retry || 400);
    }
  }
}

function configure(roots) {
  newestQuery++;
  for (const [root, drive] of volumes) {
    if (roots.includes(root)) continue;
    drive.closed = true;
    clearTimeout(drive.timer);
    clearTimeout(drive.saveTimer);
    drive.watcher?.close();
    volumes.delete(root);
    fsp.rm(drive.cache, { force: true }).catch(() => {});
  }
  for (const root of roots) {
    if (volumes.has(root)) continue;
    const cache = path.join(workerData.directory, createHash("sha256").update(root).digest("hex") + ".json");
    const drive = { root, cache, files: new Map(), pending: new Set(), rebuild: true, state: "scanning" };
    volumes.set(root, drive);
    void start(drive);
  }
  notify();
}

async function start(drive) {
  try {
    await fsp.access(drive.root);
    const cached = JSON.parse(await fsp.readFile(drive.cache, "utf8"));
    if (Array.isArray(cached) && !drive.closed) {
      for (const entry of cached) {
        if (typeof entry?.target === "string" && ["file", "folder"].includes(entry.kind)) {
          drive.files.set(entry.target.toLowerCase(), entry);
        }
      }
    }
  } catch { /* The first scan does not require a cache. */ }
  await synchronize(drive);
}

async function query(id, request, category) {
  newestQuery = id;
  const result = [];
  let checked = 0;
  for (const drive of volumes.values()) {
    for (const item of drive.files.values()) {
      if (++checked % 10000 === 0) {
        await delay(0);
        if (newestQuery !== id) return parentPort.postMessage({ type: "results", id, rows: [] });
      }
      if (category !== "all" && item.kind !== category) continue;
      const score = matchScore(item.target, item.kind, request);
      if (score < 0) continue;
      result.push({ ...item, score, source: "塘里本地索引" });
      if (result.length === 400) {
        result.sort((a, b) => b.score - a.score);
        result.length = 160;
      }
    }
  }
  result.sort((a, b) => b.score - a.score);
  parentPort.postMessage({ type: "results", id, rows: result.slice(0, 160) });
}

parentPort.on("message", (message) => {
  if (message.type === "roots") configure(message.roots);
  if (message.type === "query") void query(message.id, message.query, message.category);
});
