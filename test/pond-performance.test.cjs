"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const Performance = require("../web/pond-performance.js");
const Activity = require("../web/boss-activity.js");
const Dance = require("../web/boss-dance.js");
const DanceRig = require("../web/boss-dance-rig.js");
const { createStabilizer } = require("../media-monitor.js");

test("a frog sitting, swimming to, or jumping to a leaf reserves the whole leaf", () => {
  const a = { leaf: 1 }, b = { leaf: 2 }, c = { leaf: 3 };
  assert.equal(Performance.frogOwnsLeaf(1, [{ leaf: 1, frog: {} }], []), true);
  assert.equal(Performance.frogOwnsLeaf(2, [], [{ goal: b }]), true);
  assert.equal(Performance.frogOwnsLeaf(3, [], [{ jump: { seat: c } }]), true);
  assert.equal(Performance.frogOwnsLeaf(1, [], [{ seat: a }]), true);
  assert.equal(Performance.frogOwnsLeaf(4, [], [{ goal: b }]), false);
});

test("choose another available leaf, but keep the only available one", () => {
  const a = {}, b = {}, c = {};
  assert.equal(Performance.chooseLeaf([a, b, c], a, () => 0), b);
  assert.equal(Performance.chooseLeaf([a], a), a);
  assert.equal(Performance.chooseLeaf([], a), null);
});

test("both people reserve separate leaves and do not overlap on adjacent leaves", () => {
  const occupied = { cx: 100, cy: 100 }, close = { cx: 130, cy: 100 }, free = { cx: 180, cy: 100 };
  assert.equal(Performance.conflictsWithReservedLeaf(occupied, 25, occupied, 25), true);
  assert.equal(Performance.conflictsWithReservedLeaf(close, 25, occupied, 25), true);
  assert.equal(Performance.conflictsWithReservedLeaf(free, 25, occupied, 25), false);
  assert.equal(Performance.conflictsWithReservedLeaf(free, 25, null, 0), false);
});

test("fish leave sufficient space for two performers in every formation", () => {
  for (const name of Performance.formations) {
    const weights = Performance.formationWeights(0, 66, name);
    for (let i = 0; i < 66; i++) {
      const point = Performance.formationPoint(i, 66, 12, 1280, 720, weights, 90);
      assert.ok(Math.hypot(point.x - 640, point.y - 360) >= 86.9, name + " came too close");
    }
  }
});

test("a scene rebuild retains the same leaf, including after resize", () => {
  const old = { cx: 100, cy: 200 }, replacement = { cx: 200, cy: 400 }, other = { cx: 350, cy: 400 };
  assert.equal(Performance.matchLeaf(old, [other, replacement], 2000, 1000, 1000, 500, 20), replacement);
  assert.equal(Performance.matchLeaf(old, [other], 2000, 1000, 1000, 500, 20), null);
});

test("fish slots are evenly spaced and travel clockwise on screen", () => {
  const a = Performance.ringSlot(0, 8, 0, 1000, 700);
  const b = Performance.ringSlot(1, 8, 0, 1000, 700);
  const next = Performance.ringSlot(0, 8, 1, 1000, 700);
  assert.ok(Math.abs(b.angle - a.angle - Math.PI / 4) < 1e-9);
  assert.ok(next.angle > a.angle);
  assert.ok(next.x > a.x); // From the top of the circle, clockwise moves right.
  assert.ok(Math.abs(Math.hypot(a.x - 500, a.y - 350) - a.radius) < 1e-9);
});

test("double rings share the performer's center with proportional fish counts", () => {
  const count = 66, outerCount = Math.ceil(count * 0.65), w = 1280, h = 720;
  const weights = Performance.formationWeights(0, count, "double"), ring = Performance.formationWeights(0, count, "ring");
  let outer = 0, inner = 0;
  for (let i = 0; i < count; i++) {
    const point = Performance.formationPoint(i, count, 0, w, h, weights);
    const from = Performance.formationPoint(i, count, 0, w, h, ring);
    const radius = Math.hypot(point.x - w / 2, point.y - h / 2);
    if (Math.abs(radius - point.radius) < 4) outer++;
    else { assert.ok(Math.abs(radius - point.radius * 0.56) < 4); inner++; }
    assert.ok(Math.hypot(point.x - from.x, point.y - from.y) < point.radius * 0.52,
      "a fish was sent across the circle while changing rings");
    const next = Performance.formationPoint(i, count, 0.1, w, h, weights);
    assert.ok((point.x - w / 2) * (next.y - point.y) - (point.y - h / 2) * (next.x - point.x) > 0);
  }
  assert.equal(outer, outerCount); assert.equal(inner, count - outerCount);
});

test("spiral transitions keep fish near their angular neighbors even after a long show", () => {
  const count = 66, ring = Performance.formationWeights(0, count, "ring");
  const spiral = Performance.formationWeights(0, count, "spiral");
  for (const time of [0, 53, 120, 300]) for (let i = 0; i < count; i++) {
    const a = Performance.formationPoint(i, count, time, 1280, 720, ring);
    const b = Performance.formationPoint(i, count, time, 1280, 720, spiral);
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < a.radius,
      `fish ${i} had to cross the pond after ${time} seconds`);
  }
});

test("formation changes start on a beat sooner for faster music", () => {
  const starts = [];
  for (const bpm of [90, 120, 150]) {
    const conductor = Performance.createConductor(), beatLength = 60 / bpm;
    for (let i = 0; i < 15; i++) {
      conductor.advance(beatLength);
      conductor.beat({ bpm, confidence: 0.9 });
    }
    assert.equal(conductor.state().phase, "hold");
    conductor.advance(beatLength);
    conductor.beat({ bpm, confidence: 0.9 });
    assert.equal(conductor.state().phase, "transition");
    assert.ok(Math.abs(conductor.state().duration - 8 * beatLength) < 1e-9);
    assert.equal(conductor.position(), Performance.holdSeconds);
    starts.push(16 * beatLength);
  }
  assert.ok(starts[2] < starts[1] && starts[1] < starts[0]);
  assert.ok(starts[2] < 7, "a lively 150 BPM track should start changing within seven seconds");
});

test("occasional recognized beats cannot postpone a formation indefinitely", () => {
  const conductor = Performance.createConductor();
  let beganAt = 0;
  for (let i = 0; i < 150 && conductor.state().phase === "hold"; i++) {
    if (i % 20 === 0) conductor.beat({ bpm: 150, confidence: 0.9 });
    conductor.advance(0.1);
    beganAt += 0.1;
  }
  assert.equal(conductor.state().phase, "transition");
  assert.ok(beganAt >= 6 && beganAt < 8, `sporadic beat events delayed the change to ${beganAt}s`);
});

test("formation timing uses elapsed time even with very slow rendering", () => {
  const conductor = Performance.createConductor();
  for (let i = 0; i < 6; i++) conductor.advance(2);
  assert.equal(conductor.state().phase, "transition");
  assert.equal(conductor.state().duration, Performance.transitionSeconds);
});

test("fish move around the same formation faster when its music clock speeds up", () => {
  const weights = Performance.formationWeights(0, 66, "ring");
  const slow = Performance.formationSlot(0, 66, 0, 1280, 720, weights, weights, 0.8);
  const fast = Performance.formationSlot(0, 66, 0, 1280, 720, weights, weights, 1.35);
  assert.ok(fast.travelSpeed > slow.travelSpeed * 1.5);
  assert.equal(slow.x, fast.x);
  assert.equal(slow.y, fast.y);
});

test("formation conductor falls back when beats are absent or disabled", () => {
  const conductor = Performance.createConductor();
  for (let i = 0; i < 12; i++) conductor.advance(1);
  assert.equal(conductor.state().phase, "transition");
  assert.equal(conductor.state().duration, Performance.transitionSeconds);
  for (let i = 0; i < 5; i++) conductor.advance(1);
  assert.equal(conductor.state().phase, "hold");
  assert.equal(conductor.state().stage, 1);
  conductor.beat({ bpm: 120, confidence: 0.9 });
  conductor.resetRhythm();
  assert.equal(conductor.state().beatCount, 0);
  assert.equal(conductor.state().tempo, 0);
});

test("music formations cycle in the agreed order with smooth transitions", () => {
  const forms = Performance.formations, hold = Performance.holdSeconds, transition = Performance.transitionSeconds;
  const step = hold + transition;
  forms.forEach((name, index) => {
    const start = Performance.formationWeights(index * step, 66);
    assert.ok(start[name] > 0.999);
    const middle = Performance.formationWeights(index * step + hold + transition / 2, 66);
    assert.ok(Math.abs(middle[name] - 0.5) < 1e-9);
    assert.ok(Math.abs(middle[forms[(index + 1) % forms.length]] - 0.5) < 1e-9);
    const before = Performance.formationWeights((index + 1) * step - 0.001, 66);
    const after = Performance.formationWeights((index + 1) * step + 0.001, 66);
    forms.forEach((key) => assert.ok(Math.abs(before[key] - after[key]) < 0.001));
  });
});

test("few fish simplify formations and empty rosters remain safe", () => {
  assert.deepEqual(Performance.availableFormations(0), ["ring"]);
  assert.deepEqual(Performance.availableFormations(8), ["ring"]);
  assert.deepEqual(Performance.availableFormations(12), ["ring", "heart"]);
  assert.deepEqual(Performance.availableFormations(24), ["ring", "heart", "double"]);
  assert.equal(Performance.availableFormations(40).length, 5);
  assert.equal(Performance.formationWeights(0, 4, "lotus").ring, 1);
});

test("formations, transitions and individual paths stay finite and clear of the performer", () => {
  for (const count of [1, 8, 12, 24, 40, 66, 120]) {
    for (const time of [0, 27, 31.5, 36, 63, 67.5, 99, 103.5, 135, 139.5, 171, 175.5]) {
      const weights = Performance.formationWeights(time, count);
      const next = Performance.formationWeights(time + 0.08, count);
      assert.ok(Math.abs(Object.values(weights).reduce((a, b) => a + b, 0) - 1) < 1e-9);
      for (let i = 0; i < count; i++) {
        const p = Performance.formationSlot(i, count, time, 1280, 720, weights, next);
        assert.ok([p.x, p.y, p.tangentX, p.tangentY, p.travelSpeed].every(Number.isFinite));
        assert.ok(Math.hypot(p.x - 640, p.y - 360) >= p.clearance - 3.1);
        assert.ok(p.x > 0 && p.x < 1280 && p.y > 0 && p.y < 720);
      }
    }
  }
});

test("individual outlines stay continuous through a full lap and manual changes blend", () => {
  for (const shape of Performance.formations) {
    const weights = Performance.formationWeights(0, 66, shape);
    for (let t = 0; t < 40; t += 0.2) {
      const a = Performance.formationPoint(5, 66, t, 1280, 720, weights);
      const b = Performance.formationPoint(5, 66, t + 0.2, 1280, 720, weights);
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 35, `${shape} jumps at ${t}`);
    }
  }
  const from = Performance.formationWeights(0, 66, "ring");
  const start = Performance.formationWeights(10, 66, "heart", { from, start: 10 });
  const middle = Performance.formationWeights(10 + Performance.transitionSeconds / 2, 66, "heart", { from, start: 10 });
  const end = Performance.formationWeights(10 + Performance.transitionSeconds, 66, "heart", { from, start: 10 });
  assert.equal(start.ring, 1); assert.equal(middle.ring, 0.5); assert.equal(middle.heart, 0.5); assert.equal(end.heart, 1);
});

test("music detector ignores brief playback and gaps between tracks", () => {
  const detector = createStabilizer(1200, 2250);
  assert.equal(detector.update(true, 0), false);
  assert.equal(detector.update(true, 1200), true);
  assert.equal(detector.update(false, 1500), true);
  assert.equal(detector.update(true, 2000), true);
  assert.equal(detector.update(false, 3000), true);
  assert.equal(detector.update(false, 5250), false);
});

function makeCharacter(document, rig = DanceRig, options = {}) {
  class FakeImage { constructor() { this.complete = true; this.naturalWidth = 400; this.naturalHeight = 200; } }
  const window = {};
  const localStorage = { getItem: () => null, setItem() {} };
  vm.runInNewContext(fs.readFileSync(require.resolve("../web/boss-character.js"), "utf8"),
    { window, document, Image: FakeImage, localStorage, PondBossActivity: Activity, PondBossDance: Dance, PondBossDanceRig: rig, Math });
  const activity = Activity.create(() => 0);
  const boss = window.PondBossCharacter.create({ activity, ...options });
  boss.setPosition(100, 100, 25, 0);
  return { boss, activity };
}

function makeDrawableCharacter(rigOverride, options) {
  const makeContext = () => ({ globalAlpha: 1, save() {}, restore() {}, translate() {}, rotate() {},
    clearRect() {}, drawImage() {}, beginPath() {}, ellipse() {}, stroke() {}, fill() {}, moveTo() {}, lineTo() {},
    bezierCurveTo() {}, quadraticCurveTo() {} });
  const bufferDraws = [];
  const document = { createElement() { const ctx = makeContext(); ctx.drawImage = (...args) => bufferDraws.push(args);
    return { width: 0, height: 0, getContext: () => ctx }; } };
  const rig = rigOverride || { draw(g, image, _pose, _x, _y, height) { g.drawImage(image, 0, 0, height, height); return true; } };
  const { boss, activity } = makeCharacter(document, rig, options);
  let widths = [];
  const canvas = makeContext();
  canvas.drawImage = (_image, _x, _y, width) => widths.push(width);
  const drawWidth = (draw) => { widths = []; draw(); assert.equal(widths.length, 1); return widths[0]; };
  return { boss, activity, canvas, drawWidth, bufferDraws };
}

test("swimming is larger and climbing joins water and leaf sizes in both outfits", async () => {
  const { boss, activity, canvas, drawWidth } = makeDrawableCharacter();
  for (const outfit of ["classic", "floral"]) {
    assert.equal(await boss.setOutfit(outfit), true);
    activity.clock = 0; activity.elapsed = 0; activity.duration = 3.4;
    activity.mode = "lying";
    const leaf = drawWidth(() => boss.drawTop(canvas));
    activity.mode = "swim";
    const entering = drawWidth(() => boss.drawWater(canvas));
    activity.elapsed = 1;
    const water = drawWidth(() => boss.drawWater(canvas));
    activity.mode = "climb";
    activity.elapsed = 0;
    const start = drawWidth(() => boss.drawTop(canvas));
    activity.elapsed = activity.duration;
    const end = drawWidth(() => boss.drawTop(canvas));
    assert.ok(Math.abs(entering / leaf - 0.82) < 1e-9);
    assert.ok(Math.abs(water / leaf - (1.45 * 1.75 / 1.8)) < 1e-9);
    assert.ok(Math.abs(start - water) < 1e-9);
    assert.ok(Math.abs(end - leaf) < 1e-9);
  }
});

test("the second friend uses all eight breaststroke frames after falling", () => {
  const rig = { draw() { assert.fail("the fallback rig should not replace an available stroke cycle"); } };
  const { boss, activity, canvas, bufferDraws } = makeDrawableCharacter(rig, { variant: "friend" });
  assert.equal(boss.hit(100, 100), true);
  for (let i = 0; i < 22; i++) boss.update(0.1, () => {});
  assert.equal(activity.mode, "swim");
  for (let frame = 0; frame < 8; frame++) {
    bufferDraws.length = 0; activity.elapsed = frame * 1.5 / 8;
    boss.drawWater(canvas);
    assert.equal(bufferDraws.length, 1);
    const [image, sx, sy] = bufferDraws[0];
    assert.equal(image.src, "friend-black-swim-cycle-v2.png");
    assert.equal(sx, (frame % 4) * 100 + 1);
    assert.equal(sy, Math.floor(frame / 4) * 100 + 1);
  }
});

test("both friends draw a visible lash and one animated reaction sprite after a hit", async () => {
  for (const variant of ["classic", "floral", "friend"]) {
    const draws = [];
    const rig = { draw(_g, image, pose, _x, _y, _height, _angle, options) { draws.push({ image: image.src, pose, options }); return true; } };
    const { boss, activity, canvas } = makeDrawableCharacter(rig, variant === "friend" ? { variant: "friend" } : {});
    if (variant === "floral") assert.equal(await boss.setOutfit("floral"), true);
    let lashCurves = 0, strokes = 0;
    canvas.bezierCurveTo = () => { lashCurves++; }; canvas.stroke = () => { strokes++; };
    assert.equal(boss.hit(100, 100), true);
    activity.elapsed = activity.duration * 0.65;
    boss.drawTop(canvas);
    boss.drawInteraction(canvas);
    assert.equal(lashCurves, 1, variant + " did not draw a whip");
    assert.ok(strokes >= 3, variant + " did not draw an outlined lash");
    assert.equal(draws.length, 1);
    assert.equal(draws[0].image, variant === "friend" ? "friend-black-reaction-rig-v1.png" :
      variant === "floral" ? "boss-floral-dance-v1.png" : "boss-show-dance-v1.png");
    activity.mode = "fall"; activity.duration = 1; activity.elapsed = 0.45;
    boss.drawTop(canvas);
    assert.equal(draws.length, 2);
    assert.notEqual(draws[1].pose.armLeft, draws[0].pose.armLeft, "arms stayed still after impact");
    assert.notEqual(draws[1].pose.legRight, draws[0].pose.legRight, "legs stayed still after impact");
  }
});

test("choosing a smaller destination leaf does not shrink the swimmer", () => {
  const { boss, activity, canvas, drawWidth } = makeDrawableCharacter();
  activity.clock = 0;
  const originalLeaf = drawWidth(() => boss.drawTop(canvas));
  let chosen = 0;
  const choose = () => { chosen++; boss.setPosition(260, 140, 10, 0); return { x: 260, y: 140 }; };
  assert.equal(boss.hit(100, 100), true);
  for (let i = 0; i < 35; i++) boss.update(0.1, () => {}, choose);
  assert.equal(activity.mode, "swim");
  assert.equal(chosen, 1);
  const water = drawWidth(() => boss.drawWater(canvas));
  assert.ok(Math.abs(water / originalLeaf - (1.45 * 1.75 / 1.8)) < 1e-9);
  activity.mode = "climb"; activity.elapsed = 0; activity.duration = 3.4;
  assert.ok(Math.abs(drawWidth(() => boss.drawTop(canvas)) - water) < 1e-9);
  activity.elapsed = activity.duration;
  assert.ok(Math.abs(drawWidth(() => boss.drawTop(canvas)) / originalLeaf - 10 / 25) < 1e-9);
});

test("returning from a music performance keeps swimmer size until climbing", () => {
  const { boss, activity, canvas, drawWidth } = makeDrawableCharacter();
  activity.clock = 0;
  const originalLeaf = drawWidth(() => boss.drawTop(canvas));
  const choose = () => { boss.setPosition(260, 140, 10, 0); return { x: 260, y: 140 }; };
  boss.setPerformance(true, { x: 220, y: 160 });
  for (let i = 0; i < 200; i++) boss.update(0.1, () => {}, choose);
  boss.setPerformance(false, { x: 220, y: 160 });
  let water = 0;
  for (let i = 0; i < 200 && activity.mode !== "climb"; i++) {
    boss.update(0.1, () => {}, choose);
    if (activity.mode !== "climb" && i >= 10) water = drawWidth(() => boss.drawWater(canvas));
  }
  assert.equal(activity.mode, "climb");
  // The mermaid rig uses the full frame; the original idle atlas adds 16px padding.
  assert.ok(Math.abs(water / originalLeaf - (1.45 * 1.75 / 1.8) * (480 / 512)) < 1e-9);
  assert.ok(Math.abs(drawWidth(() => boss.drawTop(canvas)) - water) < 1e-9);
});

test("a struck character selects a new leaf after falling and climbs onto it", () => {
  const { boss, activity } = makeCharacter();
  let chosen = 0, splashes = 0;
  const choose = () => { chosen++; boss.setPosition(260, 140, 25, 0); return { x: 260, y: 140 }; };
  assert.equal(boss.hit(100, 100), true);
  for (let i = 0; i < 22; i++) boss.update(0.1, () => splashes++, choose);
  assert.equal(chosen, 1); assert.equal(splashes, 1); assert.equal(activity.mode, "swim");
  for (let i = 0; i < 130; i++) boss.update(0.1, () => {}, choose);
  assert.notEqual(activity.mode, "swim");
  assert.equal(chosen, 1);
});

test("music runs an uninterrupted show and returns to a selected leaf after stopping", () => {
  const { boss, activity } = makeCharacter();
  let chosen = 0, splashes = 0;
  const choose = () => { chosen++; boss.setPosition(300, 160, 25, 0); return { x: 300, y: 160 }; };
  boss.setPerformance(true, { x: 500, y: 350 });
  for (let i = 0; i < 200; i++) boss.update(0.1, () => splashes++, choose);
  assert.equal(splashes, 1); assert.equal(chosen, 0);
  boss.setPerformance(false, { x: 500, y: 350 });
  for (let i = 0; i < 200; i++) boss.update(0.1, () => {}, choose);
  assert.equal(chosen, 1); assert.ok(["sitting", "changing", "lying", "scratch", "water"].includes(activity.mode));
  boss.setEnabled(false);
  assert.equal(boss.enabled, false); assert.equal(activity.mode, "lying");
});

test("music uses the mermaid inside the actual ring and starts its return without a position jump", () => {
  const frames = [];
  const rig = { draw(g, image, pose, x, y, height, angle, options) {
    frames.push({ image: image.src, x, y, height, angle, options, tailPhase: pose.tailPhase });
    g.drawImage(image, 0, 0, height, height); return true;
  } };
  const { boss, canvas } = makeDrawableCharacter(rig), center = { x: 220, y: 160 };
  const formation = { ring: 1, radius: 120 };
  const choose = () => { boss.setPosition(300, 170, 25, 0); return { x: 300, y: 170 }; };
  boss.setPerformance(true, center, formation);
  for (let i = 0; i < 160; i++) boss.update(0.1, () => {}, choose);
  for (let i = 0; i < 120; i++) { boss.update(0.1, () => {}, choose); boss.drawWater(canvas); }
  assert.equal(frames.length, 120);
  assert.ok(frames.every((frame) => frame.image === "boss-mermaid-v2.png" && frame.options.mermaid));
  assert.ok(frames.every((frame) => Math.hypot(frame.x - center.x, frame.y - center.y) <= formation.radius * 0.26 + 0.01));
  assert.ok(Math.max(...frames.map((frame) => frame.x)) - Math.min(...frames.map((frame) => frame.x)) > 55);
  const before = frames.at(-1);
  boss.setPerformance(false, center, formation);
  boss.update(0.02, () => {}, choose); boss.drawWater(canvas);
  const after = frames.at(-1);
  assert.ok(Math.hypot(after.x - before.x, after.y - before.y) < 2);
  assert.ok(after.tailPhase >= before.tailPhase);
});

test("the live performer follows each fish formation and keeps moving both arms during transitions", () => {
  const frames = [];
  const rig = { draw(g, image, pose, x, y, height) {
    frames.push({ x, y, left: pose.armLeft, right: pose.armRight });
    g.drawImage(image, 0, 0, height, height); return true;
  } };
  const { boss, canvas } = makeDrawableCharacter(rig), center = { x: 220, y: 160 };
  boss.setPerformance(true, center, { ring: 1, radius: 180 });
  for (let i = 0; i < 160; i++) boss.update(0.1, () => {});
  let previous = null;
  for (const name of Dance.formationNames) {
    boss.setPerformance(true, center, { [name]: 1, radius: 180, clearance: 100 });
    const start = frames.length;
    for (let i = 0; i < 150; i++) {
      boss.update(0.1, () => {}); boss.drawWater(canvas);
      const current = frames.at(-1);
      if (previous) assert.ok(Math.hypot(current.x - previous.x, current.y - previous.y) < 8, name + " jumped");
      previous = current;
    }
    const path = frames.slice(start + 20);
    assert.ok(Math.max(...path.map((p) => p.x)) - Math.min(...path.map((p) => p.x)) > 10, name + " stopped moving");
    assert.ok(Math.max(...path.map((p) => p.left)) - Math.min(...path.map((p) => p.left)) > 0.55, name + " left arm stopped");
    assert.ok(Math.max(...path.map((p) => p.right)) - Math.min(...path.map((p) => p.right)) > 0.55, name + " right arm stopped");
  }
});

test("two distinct friends swim together to separate duet positions and return independently", () => {
  const frames = [[], []], actors = [0, 1].map((role) => {
    const rig = { draw(g, image, pose, x, y, height, angle) {
      frames[role].push({ image: image.src, x, y, angle, left: pose.armLeft });
      g.drawImage(image, 0, 0, height, height); return true;
    } };
    return makeDrawableCharacter(rig, role ? { variant: "friend" } : {});
  });
  actors[0].boss.setPosition(100, 100, 25, 0);
  actors[1].boss.setPosition(340, 100, 25, 0);
  const center = { x: 220, y: 160 }, formation = { ring: 1, radius: 216, clearance: 100 };
  const clock = Dance.create(), duet = Dance.createDuet();
  for (let i = 0; i < 500; i++) {
    clock.advance(0.05);
    const phase = clock.snapshot().phase, pair = duet.advance(0.05, phase, formation, 25, 25);
    actors.forEach((actor, role) => {
      actor.boss.setPerformance(true, center, formation, { role, phase, point: role ? pair.second : pair.first });
      actor.boss.update(0.05, () => {});
      if (i >= 240) actor.boss.drawWater(actor.canvas);
    });
  }
  assert.equal(frames[0].length, frames[1].length);
  assert.ok(frames[0].length > 200);
  assert.ok(frames[0].every((f) => f.image === "boss-mermaid-v2.png"));
  assert.ok(frames[1].every((f) => f.image === "friend-mermaid-v2.png"));
  for (let i = 0; i < frames[0].length; i++) {
    const a = frames[0][i], b = frames[1][i];
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > 48, "the friends' bodies overlapped");
    if (i) assert.ok(Math.hypot(a.x - frames[0][i - 1].x, a.y - frames[0][i - 1].y) < 3);
  }
  const chosen = [0, 0];
  const destination = actors.map((actor, role) => () => {
    chosen[role]++; const x = role ? 340 : 100;
    actor.boss.setPosition(x, 100, 25, 0); return { x, y: 100 };
  });
  actors.forEach((actor) => actor.boss.setPerformance(false, center, formation));
  for (let i = 0; i < 300; i++) actors.forEach((actor, role) => actor.boss.update(0.05, () => {}, destination[role]));
  assert.deepEqual(chosen, [1, 1]);
  assert.ok(actors.every((actor) => actor.activity.mode !== "swim" && actor.activity.mode !== "climb"));
});

test("two performers from differently sized leaves converge to one duet size", () => {
  const heights = [[], []], actors = [0, 1].map((role) => {
    const rig = { draw(g, image, pose, x, y, height) {
      heights[role].push(height); g.drawImage(image, 0, 0, height, height); return true;
    } };
    return makeDrawableCharacter(rig, role ? { variant: "friend" } : {});
  });
  const leafRadii = [18, 32], sharedRadius = 25;
  actors.forEach((actor, role) => actor.boss.setPosition(role ? 340 : 100, 100, leafRadii[role], 0));
  const center = { x: 220, y: 160 }, formation = { ring: 1, radius: 220, clearance: 110 };
  const clock = Dance.create(), duet = Dance.createDuet();
  for (let i = 0; i < 500; i++) {
    clock.advance(0.05);
    const phase = clock.snapshot().phase, pair = duet.advance(0.05, phase, formation, sharedRadius, sharedRadius);
    actors.forEach((actor, role) => {
      actor.boss.setPerformance(true, center, formation, { role, phase, radius: sharedRadius, point: role ? pair.second : pair.first });
      actor.boss.update(0.05, () => {});
      if (i > 300) actor.boss.drawWater(actor.canvas);
    });
  }
  assert.ok(heights[0].length && heights[0].length === heights[1].length);
  for (let i = 0; i < heights[0].length; i++) assert.ok(Math.abs(heights[0][i] - heights[1][i]) < 0.05);
});

test("the rendered duet reaches hand contact without overlapping the bodies", () => {
  const frames = [null, null], actors = [0, 1].map((role) => {
    const rig = { draw(g, image, pose, x, y, height, angle) {
      frames[role] = { pose: {...pose}, x, y, height, angle };
      g.drawImage(image, 0, 0, height, height); return true;
    } };
    return makeDrawableCharacter(rig, role ? { variant: "friend" } : {});
  });
  actors.forEach((actor, role) => actor.boss.setPosition(role ? 340 : 100, 100, 25, 0));
  const center = { x: 220, y: 160 }, formation = { ring: 1, radius: 220, clearance: 120 };
  const clock = Dance.create(), duet = Dance.createDuet(), gaps = [];
  const palm = (frame, u, side) => {
    const p = DanceRig.deform(u, 0.25, side, frame.pose, true);
    const x = (p.x - 0.5) * frame.height, y = (p.y - 0.5) * frame.height;
    return { x: frame.x + x * Math.cos(frame.angle) - y * Math.sin(frame.angle),
      y: frame.y + x * Math.sin(frame.angle) + y * Math.cos(frame.angle) };
  };
  for (let i = 0; i < 500; i++) {
    clock.advance(0.05);
    const phase = clock.snapshot().phase, pair = duet.advance(0.05, phase, formation, 25, 25);
    actors.forEach((actor, role) => {
      actor.boss.setPerformance(true, center, formation, { role, phase, radius: 25, point: role ? pair.second : pair.first });
      actor.boss.update(0.05, () => {}); actor.boss.drawWater(actor.canvas);
    });
    if (phase >= 15 && phase <= 19 && frames.every(Boolean)) {
      const a = palm(frames[0], 0.08, -1), b = palm(frames[1], 0.92, 1);
      gaps.push(Math.hypot(a.x - b.x, a.y - b.y));
      assert.ok(Math.hypot(frames[0].x - frames[1].x, frames[0].y - frames[1].y) > 48);
    }
  }
  assert.ok(gaps.length > 30);
  assert.ok(Math.max(...gaps) < 4, `rendered hands are ${Math.max(...gaps).toFixed(1)}px apart`);
});

test("the new friend's visibility is independent of the existing saved setting", () => {
  class FakeImage { constructor() { this.complete = true; this.naturalWidth = 100; this.naturalHeight = 100; } }
  const saved = new Map([["bitan.boss.visible", "0"], ["bitan.friend.visible", "1"]]);
  const localStorage = { getItem: (key) => saved.get(key) || null, setItem: (key, value) => saved.set(key, value) };
  const window = {};
  vm.runInNewContext(fs.readFileSync(require.resolve("../web/boss-character.js"), "utf8"),
    { window, Image: FakeImage, localStorage, PondBossActivity: Activity, PondBossDance: Dance, PondBossDanceRig: DanceRig, Math });
  const first = window.PondBossCharacter.create(), second = window.PondBossCharacter.create({ variant: "friend" });
  assert.equal(first.enabled, false); assert.equal(second.enabled, true);
  second.setEnabled(false);
  assert.equal(saved.get("bitan.friend.visible"), "0"); assert.equal(saved.get("bitan.boss.visible"), "0");
  first.setEnabled(true);
  assert.equal(saved.get("bitan.boss.visible"), "1"); assert.equal(saved.get("bitan.friend.visible"), "0");
});

test("both costumes can be selected while retaining the current activity", async () => {
  const { boss, activity } = makeCharacter();
  activity.mode = "water"; activity.elapsed = 1.4;
  assert.equal(await boss.setOutfit("floral"), true);
  assert.equal(boss.outfit, "floral"); assert.equal(activity.mode, "water");
  assert.equal(await boss.setOutfit("classic"), true);
  assert.equal(boss.outfit, "classic"); assert.equal(activity.elapsed, 1.4);
});

test("actual beat events reach the swimming performance and change its tempo", () => {
  const { boss } = makeCharacter();
  boss.setPerformance(true, { x: 220, y: 160 });
  for (let i = 0; i < 250; i++) {
    if (i % 4 === 0) boss.noteBeat({ bpm: 150, confidence: 0.95, strength: 0.8 });
    boss.update(0.1, () => {});
  }
  assert.ok(boss.danceState.synchronized);
  assert.ok(Math.abs(boss.danceState.tempo - 150) < 2);
  boss.setRhythmEnabled(false);
  for (let i = 0; i < 100; i++) boss.update(0.1, () => {});
  assert.equal(boss.danceState.synchronized, false);
  assert.ok(Math.abs(boss.danceState.tempo - 96) < 2);
});

test("a slow costume load cannot overwrite a newer wardrobe choice", async () => {
  class DeferredImage {
    constructor() { this.complete = false; this.naturalWidth = 0; this.listeners = {}; DeferredImage.all.push(this); }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    finish() { this.complete = true; this.naturalWidth = 100; if (this.listeners.load) this.listeners.load(); }
  }
  DeferredImage.all = [];
  const saved = new Map(), localStorage = { getItem: (key) => saved.get(key) || null, setItem: (key, value) => saved.set(key, value) };
  const window = {};
  vm.runInNewContext(fs.readFileSync(require.resolve("../web/boss-character.js"), "utf8"),
    { window, Image: DeferredImage, localStorage, PondBossActivity: Activity, PondBossDance: Dance, PondBossDanceRig: DanceRig, Math });
  const boss = window.PondBossCharacter.create();
  const pending = boss.setOutfit("floral");
  assert.equal(boss.outfit, "floral");
  assert.equal(await boss.setOutfit("classic"), true);
  DeferredImage.all.forEach((image) => image.finish());
  assert.equal(await pending, false);
  assert.equal(boss.outfit, "classic");
  assert.equal(saved.get("bitan.boss.outfit"), "classic");
});
