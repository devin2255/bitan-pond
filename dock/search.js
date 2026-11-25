const fs = require("node:fs/promises");
const path = require("node:path");
const { Worker } = require("node:worker_threads");
const { parseQuery, mergeResults } = require("./search-model");
const { normalizePin } = require("./model");

function createSearch(directory, native, onStatus, log) {
  const catalog = native.client("search", [], 4500);
  const everything = native.client("search", [], 2400);
  const windows = native.client("search", [], 3600);
  const cache = path.join(directory, "file-index");
  let worker, opening, roots = [], drives = [], stopped = false, id = 0;
  let apps, fetchedAt = 0, pendingApps;
  const pending = new Map();
  const resultRegistry = new Map();

  function status() { return drives; }

  function releaseWorker(instance, error) {
    if (worker !== instance) return;
    worker = null;
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.resolve([]);
    }
    pending.clear();
    drives = roots.map((root) => ({ root, state: "offline", count: 0 }));
    onStatus(drives);
    if (error && !stopped) log(error);
  }

  async function openWorker() {
    if (stopped || !roots.length) return null;
    if (worker) return worker;
    opening ??= fs.mkdir(cache, { recursive: true }).then(() => {
      if (stopped || !roots.length) return null;
      const file = path.join(__dirname.replace(/([\\/])app\.asar([\\/])/, "$1app.asar.unpacked$2"), "index-worker.js");
      const instance = new Worker(file, { workerData: { directory: cache } });
      worker = instance;
      instance.on("message", (message) => {
        if (message.type === "status") {
          drives = message.drives.filter((drive) => roots.includes(drive.root));
          onStatus(drives);
          return;
        }
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        clearTimeout(request.timer);
        request.resolve(message.rows || []);
      });
      instance.on("error", (error) => releaseWorker(instance, error));
      instance.on("exit", (code) => releaseWorker(instance, code && new Error("本地索引进程已退出")));
      instance.postMessage({ type: "roots", roots });
      instance.unref();
      return instance;
    }).finally(() => { opening = null; });
    return opening;
  }

  async function configure(next) {
    roots = next;
    if (worker) worker.postMessage({ type: "roots", roots });
    else await openWorker().catch(log);
  }

  async function localQuery(query, category) {
    if (!roots.length || category === "app") return [];
    const instance = await openWorker().catch(() => null);
    if (!instance) return [];
    return new Promise((resolve) => {
      const requestId = ++id;
      const timer = setTimeout(() => { pending.delete(requestId); resolve([]); }, 4500);
      pending.set(requestId, { resolve, timer });
      instance.postMessage({ type: "query", id: requestId, query, category });
    });
  }

  async function installedApps() {
    if (apps && Date.now() - fetchedAt < 5 * 60_000) return apps;
    pendingApps ??= catalog.request("apps").then((rows) => {
      apps = rows.filter((item) => normalizePin(item));
      fetchedAt = Date.now();
      return apps;
    }).catch((error) => { log(error); return apps || []; }).finally(() => { pendingApps = null; });
    return pendingApps;
  }

  async function query(text, category = "all") {
    const request = parseQuery(text);
    if (!request.terms.length && !request.root && !request.extension) return { rows: [], sources: [], drives };
    const searchApps = !request.root && !request.extension && ["all", "app"].includes(category);
    const unavailable = { available: false, rows: [] };
    const indexed = async () => {
      if (category === "app") return unavailable;
      const options = { ...request, category };
      const result = await everything.request("everything", options).catch(() => unavailable);
      if (result.available) return { ...result, scope: "Everything 已索引位置" };
      const fallback = await windows.request("windows-search", options).catch(() => unavailable);
      return { ...fallback, scope: "Windows 已索引位置" };
    };
    const [foundApps, local, builtin] = await Promise.all([
      searchApps ? installedApps() : [], localQuery(request, category), indexed(),
    ]);
    const rows = mergeResults([foundApps, local, builtin.rows], request, 90, category).map((row) => {
      const key = row.kind + ":" + row.target.toLowerCase();
      resultRegistry.set(key, row);
      return { id: key, name: row.name, target: row.target, kind: row.kind, source: row.source };
    });
    if (resultRegistry.size > 700) {
      for (const key of resultRegistry.keys()) {
        if (resultRegistry.size <= 450) break;
        resultRegistry.delete(key);
      }
    }
    return { rows, sources: builtin.available ? [builtin.scope] : [], drives };
  }

  function shutdown() {
    stopped = true;
    for (const client of [catalog, everything, windows]) client.stop();
    if (worker) {
      const active = worker;
      releaseWorker(active);
      void active.terminate();
    }
  }
  return { query, configure, status, installedApps, drives: () => catalog.request("drives"), get: (key) => resultRegistry.get(key), shutdown };
}

module.exports = { createSearch };
