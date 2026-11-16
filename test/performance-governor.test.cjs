const test = require("node:test");
const assert = require("node:assert/strict");
const { create, profiles, renderScale, simulationDelta } = require("../web/performance-governor");

function advance(governor, duration, interval, work) {
  for (let time = 0; time < duration; time += interval) governor.observe(interval, work);
}

test("automatic quality stays high on a consistently fast machine", () => {
  const governor = create({ cores: 8 });
  advance(governor, 30000, 16.7, 5);
  assert.equal(governor.profile.id, "quality");
});

test("sustained overload reduces quality, then sustained headroom restores it gradually", () => {
  const governor = create({ cores: 8 });
  advance(governor, 4500, 45, 30);
  assert.equal(governor.profile.id, "balanced");
  advance(governor, 8500, 60, 50);
  assert.equal(governor.profile.id, "smooth");
  advance(governor, 9500, 60, 50);
  assert.equal(governor.profile.id, "economy");
  advance(governor, 15000, 33.3, 5);
  assert.equal(governor.profile.id, "economy");
  advance(governor, 12000, 33.3, 5);
  assert.equal(governor.profile.id, "smooth");
  advance(governor, 27000, 33.3, 5);
  assert.equal(governor.profile.id, "balanced");
  advance(governor, 27000, 33.3, 5);
  assert.equal(governor.profile.id, "quality");
});

test("a single sleep pause does not degrade quality, while repeated long rendering stalls do", () => {
  const governor = create({ cores: 8 });
  governor.observe(5000, 2);
  governor.observe(17, 5);
  assert.equal(governor.profile.id, "quality");
  governor.observe(4000, 2000);
  assert.equal(governor.profile.id, "balanced");
  governor.observe(4000, 2000);
  assert.equal(governor.profile.id, "smooth");
  governor.observe(4000, 2000);
  assert.equal(governor.profile.id, "economy");
});

test("manual modes remain fixed and auto starts conservatively on small CPUs", () => {
  const governor = create({ cores: 4 });
  assert.equal(governor.profile.id, "balanced");
  governor.setMode("quality");
  advance(governor, 20000, 80, 70);
  assert.equal(governor.profile.id, "quality");
  governor.setMode("smooth");
  advance(governor, 60000, 33, 2);
  assert.equal(governor.profile.id, "economy");
  governor.setMode("auto");
  assert.equal(governor.profile.id, "balanced");
});

test("render scale respects the pixel budget and simulation uses real low-frame-rate time", () => {
  assert.equal(renderScale(1920, 1080, 1, Infinity), 1);
  assert.equal(renderScale(1920, 1080, 1.5, profiles[1].maxPixels), Math.sqrt(2304000 / 2073600));
  assert.equal(renderScale(3840, 2160, 1, profiles[2].maxPixels), Math.sqrt(1280000 / 8294400));
  assert.equal(simulationDelta(0.05), 0.05);
  assert.equal(simulationDelta(0.1), 0.1);
  assert.equal(simulationDelta(4), 1 / 30);
});
