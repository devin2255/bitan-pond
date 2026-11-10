const test = require("node:test");
const assert = require("node:assert/strict");
const seasons = require("../web/seasons.js");

test("automatic seasons use the selected place and opposite hemispheres", () => {
  const date = new Date("2026-07-15T12:00:00Z");
  assert.equal(seasons.resolve(date, "Asia/Shanghai", 30, "auto").summer, 1);
  assert.equal(seasons.resolve(date, "Australia/Sydney", -34, "auto").winter, 1);
  assert.equal(seasons.resolve(new Date("2026-01-20T12:00:00Z"), "Asia/Shanghai", 30, "auto").winter, 1);
  assert.equal(seasons.resolve(new Date("2026-10-20T12:00:00Z"), "Asia/Shanghai", 30, "auto").autumn, 1);
});

test("season boundaries blend gradually using the location's local date", () => {
  const before = seasons.resolve(new Date("2026-03-01T15:59:00Z"), "Asia/Shanghai", 30, "auto");
  const after = seasons.resolve(new Date("2026-03-01T16:01:00Z"), "Asia/Shanghai", 30, "auto");
  const middle = seasons.resolve(new Date("2026-03-12T12:00:00Z"), "Asia/Shanghai", 30, "auto");
  assert.equal(before.winter, 1);
  assert.ok(after.spring > before.spring);
  assert.ok(middle.spring > 0 && middle.winter > 0);
  assert.ok(Math.abs(Object.values(middle).reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.equal(seasons.resolve(new Date("2026-03-22T12:00:00Z"), "Asia/Shanghai", 30, "auto").spring, 1);
});

test("manual preview selects exactly one season without changing the calendar", () => {
  const date = new Date("2026-07-15T12:00:00Z");
  assert.deepEqual(seasons.resolve(date, "Asia/Shanghai", 30, "winter"), { spring: 0, summer: 0, autumn: 0, winter: 1 });
  assert.equal(seasons.resolve(date, "Asia/Shanghai", 30, "auto").summer, 1);
});
