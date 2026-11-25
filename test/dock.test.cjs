const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { Worker } = require("node:worker_threads");
const { setTimeout: delay } = require("node:timers/promises");
const { normalizeSettings, dockGeometry, groupWindows } = require("../dock/model");
const { parseQuery, mergeResults } = require("../dock/search-model");

test("keeps Dock settings independent and normalizes duplicate paths", () => {
  const settings = normalizeSettings({
    material: "solid", layout: "full", opacity: 900, iconSize: 33.2,
    pins: [{ target: "D:\\Work" }, { target: "d:/work" }, { target: "../../x" }],
    indexRoots: ["d:\\", "D:\\", "C:", "\\\\shared"],
  });
  assert.equal(settings.enabled, false);
  assert.equal(settings.material, "solid");
  assert.equal(settings.layout, "full");
  assert.equal(settings.opacity, 100);
  assert.equal(settings.iconSize, 33);
  assert.deepEqual(settings.pins.map((pin) => pin.id), ["path:d:\\work"]);
  assert.deepEqual(settings.indexRoots, ["D:\\"]);
});

test("the visible Dock anchors to the original work area for each edge and layout", () => {
  const display = {
    bounds: { x: -1400, y: -100, width: 1400, height: 900 },
    workArea: { x: -1400, y: -100, width: 1400, height: 860 },
  };
  assert.deepEqual(dockGeometry(display, normalizeSettings({ edge: "right" }), 4).bounds,
    { x: -67, y: 231, width: 60, height: 198 });
  for (const edge of ["bottom", "left", "right"]) {
    for (const layout of ["floating", "full"]) {
      const g = dockGeometry(display, normalizeSettings({ edge, layout }), 7);
      assert.equal(g.full, layout === "full");
      assert.equal(g.edge, edge);
      assert.ok(g.bounds.x >= display.workArea.x && g.bounds.y >= display.workArea.y);
    }
  }
});

test("combines windows with a fixed application into one Dock item", () => {
  const windows = [
    { id: "1", appKey: "exe:notepad", title: "测试一" },
    { id: "2", appKey: "exe:notepad", title: "测试二" },
  ];
  const [group] = groupWindows(windows, [{ id: "pin", appKey: "exe:notepad" }]);
  assert.equal(group.id, "pin");
  assert.deepEqual(group.windows.map((window) => window.title), ["测试一", "测试二"]);
});

test("combines search sources with drive, extension, path and Chinese word filtering", () => {
  const query = parseQuery('D: ext:PDF "合同"' );
  const results = mergeResults([
    [{ kind: "file", target: "D:\\合同\\报价.pdf" }, { kind: "file", target: "C:\\合同.pdf" }],
    [{ kind: "file", target: "D:\\合同.pdf" }, { kind: "file", target: "d:\\合同\\报价.PDF" },
      { kind: "folder", target: "D:\\合同.pdf" }],
  ], query);
  assert.deepEqual(results.map((row) => row.name), ["合同.pdf", "报价.pdf"]);
});

test("local indexing observes create, rename and delete in a real directory", { timeout: 14000, skip: process.platform !== "win32" }, async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "tangli-index-test-"));
  const cache = path.join(base, "cache");
  const root = path.join(base, "volume") + path.sep;
  const group = path.join(root, "nested");
  await fs.mkdir(cache);
  await fs.mkdir(group, { recursive: true });
  const worker = new Worker(path.join(__dirname, "..", "dock", "index-worker.js"), { workerData: { directory: cache } });
  let ready = false;
  const result = new Map();
  worker.on("message", (message) => {
    if (message.type === "status") ready = message.drives.some((drive) => drive.state === "ready");
    if (message.type === "results") result.set(message.id, message.rows);
  });
  let id = 0;
  async function waitFor(check) {
    for (let retry = 0; retry < 55; retry++) {
      if (await check()) return;
      await delay(60);
    }
    assert.fail("index change not observed");
  }
  async function find(name) {
    const current = ++id;
    worker.postMessage({ type: "query", id: current, category: "file", query: parseQuery(name) });
    await waitFor(() => result.has(current));
    const rows = result.get(current);
    result.delete(current);
    return rows.length;
  }
  try {
    worker.postMessage({ type: "roots", roots: [root] });
    await waitFor(() => ready);
    const original = path.join(group, "塘里奇特示例.csv");
    const renamed = path.join(group, "塘里替换示例.csv");
    await fs.writeFile(original, "fixture");
    await waitFor(async () => await find("奇特示例") === 1);
    await fs.rename(original, renamed);
    await waitFor(async () => await find("替换示例") === 1 && await find("奇特示例") === 0);
    await fs.unlink(renamed);
    await waitFor(async () => await find("替换示例") === 0);
  } finally {
    await worker.terminate();
    assert.match(path.relative(os.tmpdir(), base), /^tangli-index-test-[^\\/]+$/);
    await fs.rm(base, { force: true, recursive: true });
  }
});
