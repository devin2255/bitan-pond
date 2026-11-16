const test = require("node:test");
const assert = require("node:assert/strict");
const { matchDisplays, targetAt, normalizedPoint } = require("../desktop-layout");

test("matches displays to their physical monitor despite mixed DPI and negative origins", () => {
  const displays = [
    { id: 11, bounds: { x: 0, y: 0, width: 1536, height: 864 } },
    { id: 22, bounds: { x: -1920, y: -220, width: 1920, height: 1080 } },
  ];
  const monitors = [
    { x: -1920, y: -220, width: 1920, height: 1080 },
    { x: 0, y: 0, width: 1920, height: 1080 },
  ];
  const convert = (p) => p.x >= 0 ? { x: p.x * 1.25, y: p.y * 1.25 } : p;
  const result = matchDisplays(displays, monitors, convert);
  assert.deepEqual(result.map((d) => d.rect), [monitors[1], monitors[0]]);
  assert.deepEqual(result.map((d) => d.id), [11, 22]);
});

test("routes a physical pointer to the correct screen and normalized viewport position", () => {
  const entries = [
    { id: "left", rect: { x: -1920, y: -100, width: 1920, height: 1080 } },
    { id: "right", rect: { x: 0, y: 0, width: 2560, height: 1440 } },
  ];
  assert.equal(targetAt(entries, -960, 440).id, "left");
  assert.deepEqual(normalizedPoint(entries[0].rect, -960, 440), [0.5, 0.5]);
  assert.equal(targetAt(entries, 1280, 720).id, "right");
  assert.deepEqual(normalizedPoint(entries[1].rect, 1280, 720), [0.5, 0.5]);
  assert.equal(targetAt(entries, 0, -50), null);
  assert.equal(targetAt(entries, 2560, 720), null);
});

test("never silently assigns two displays to the same physical monitor", () => {
  const display = { id: 1, bounds: { x: 0, y: 0, width: 100, height: 100 } };
  assert.throws(() => matchDisplays([display, { ...display, id: 2 }], [{ x: 0, y: 0, width: 100, height: 100 }], (p) => p));
});
