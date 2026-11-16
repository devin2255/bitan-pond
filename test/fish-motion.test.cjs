const test = require("node:test");
const assert = require("node:assert/strict");
const motion = require("../web/fish-motion.js");

test("each fish changes its target speed after a staggered interval and eases toward it", () => {
  const state = motion.create(60, 0, () => 0.5);
  assert.ok(state.changeIn > 8 && state.changeIn < 60);
  const start = state.cruiseFactor;
  state.changeIn = 0.01;
  motion.advance(state, 60, 1, false, 0.02, "koi", () => 1);
  assert.equal(state.targetFactor, 1.25);
  assert.ok(state.changeIn >= 50 && state.changeIn <= 70);
  assert.ok(state.cruiseFactor > start && state.cruiseFactor < start + 0.01);
  for (let i = 0; i < 200; i++) motion.advance(state, 60, 1, false, 0.05, "koi", () => 0.5);
  assert.ok(state.cruiseFactor > start + 0.1 && state.cruiseFactor < state.targetFactor);
});

test("starting and ending a burst keeps the stroke phase continuous", () => {
  const state = motion.create(60, 1, () => 0.5);
  const step = (boost) => {
    const old = state.phase;
    const previousSpeed = state.speed;
    motion.advance(state, 60, 1, boost, 1 / 60, "koi", () => 0.5);
    const phaseStep = (state.phase - old + Math.PI * 2) % (Math.PI * 2);
    assert.ok(phaseStep > 0 && phaseStep < 0.25);
    assert.ok(Math.abs(state.speed - previousSpeed) < 4);
  };
  step(false); step(true); step(true); step(false);
});

test("the head remains steady and a travelling tail wave changes sides", () => {
  const state = motion.create(60, 0, () => 0.5);
  const head = motion.bend(state, 40, "koi");
  const first = motion.bend(state, -78, "koi");
  state.phase += Math.PI;
  const opposite = motion.bend(state, -78, "koi");
  assert.equal(head, 0);
  assert.ok(Math.abs(first) > 1);
  assert.ok(Math.abs(first + opposite) < 1e-8);
  assert.ok(motion.spread(state, -78, "betta") < 1);
});

test("lower rendering detail keeps the same fish motion while drawing fewer slices", () => {
  const state = motion.create(60, 1, () => 0.5);
  const rects = [];
  const ctx = { save() {}, translate() {}, rotate() {}, scale() {}, restore() {},
    drawImage(...args) { rects.push(args); } };
  const image = { width: 378, height: 168 }, bounds = { x0: -78, x1: 48 };
  motion.draw(ctx, image, state, "koi", bounds);
  assert.equal(rects.length, 22);
  rects.length = 0;
  motion.draw(ctx, image, state, "koi", bounds, 8);
  assert.equal(rects.length, 8);
  assert.equal(rects[0][1], 0);
  const end = rects[7];
  assert.ok(Math.abs(end[1] + end[3] - image.width) < 1e-8);
});
