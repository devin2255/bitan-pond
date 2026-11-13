"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const Dance = require("../web/boss-dance.js");
const Rig = require("../web/boss-dance-rig.js");

function simulate(bpm, seconds) {
  const dance = Dance.create(); let nextBeat = 0;
  for (let t = 0; t < seconds; t += 0.02) {
    if (t >= nextBeat) { dance.beat({ bpm, confidence: 0.9, strength: 0.8 }); nextBeat += 60 / bpm; }
    dance.advance(0.02);
  }
  return dance;
}

test("recognized tempo changes the dancer's rate without abrupt phase jumps", () => {
  const slow = simulate(70, 12).snapshot(), fast = simulate(150, 12).snapshot();
  assert.ok(slow.synchronized && fast.synchronized);
  assert.ok(fast.phase > slow.phase * 1.6);
  assert.ok(Math.abs(slow.tempo - 70) < 2 && Math.abs(fast.tempo - 150) < 2);
  assert.ok(fast.pulse >= 0 && fast.pulse <= 1);
});

test("the performance cycles through distinct phrases without discontinuous poses", () => {
  const dance = Dance.create(), seen = new Set(); let previous = 0, previousPose = Dance.poseAt(0);
  for (let i = 0; i < 2500; i++) {
    dance.advance(0.02);
    const state = dance.snapshot(); seen.add(state.current.name);
    assert.ok(state.phase >= previous, "movement phase reversed"); previous = state.phase;
    assert.ok(Number.isFinite(state.angle));
    for (const key of Object.keys(state.pose)) assert.ok(Math.abs(state.pose[key] - previousPose[key]) < 0.05, key + " jumped");
    previousPose = state.pose;
  }
  assert.equal(seen.size, 4);
});

test("arms and legs move through connected intermediate positions", () => {
  const paths = [[], [], [], []];
  let last = null;
  for (let phase = 0; phase < 20; phase += 1 / 24) {
    const pose = Dance.poseAt(phase);
    const points = [Rig.deform(0.10, 0.27, -1, pose), Rig.deform(0.90, 0.27, 1, pose),
      Rig.deform(0.46, 0.92, -1, pose), Rig.deform(0.54, 0.92, 1, pose)];
    points.forEach((point, index) => {
      assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
      if (last) assert.ok(Math.hypot(point.x - last[index].x, point.y - last[index].y) < 0.035, "joint jumped");
      paths[index].push(point);
    });
    const head = Rig.deform(0.5, 0.10, -1, pose);
    assert.ok(Math.abs(head.x - 0.5) < 1e-9 && Math.abs(head.y - 0.1) < 1e-9);
    const torsoLeft = Rig.deform(0.5, 0.45, -1, pose), torsoRight = Rig.deform(0.5, 0.45, 1, pose);
    assert.ok(Math.hypot(torsoLeft.x - torsoRight.x, torsoLeft.y - torsoRight.y) < 1e-9);
    last = points;
  }
  paths.forEach((path) => {
    const width = Math.max(...path.map((p) => p.x)) - Math.min(...path.map((p) => p.x));
    const height = Math.max(...path.map((p) => p.y)) - Math.min(...path.map((p) => p.y));
    assert.ok(Math.hypot(width, height) > 0.05, "limb did not visibly move");
  });
});

test("the dance draws one consistent character image without pose crossfades", () => {
  const image = { complete: true, naturalWidth: 1774, naturalHeight: 887 }, inputs = [];
  const ctx = { globalAlpha: 1, save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
    beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, clip() {}, transform(...values) {
      assert.ok(values.every(Number.isFinite));
    }, drawImage(source) { inputs.push(source); } };
  assert.equal(Rig.draw(ctx, image, Dance.poseAt(3), 100, 100, 80, 0), true);
  assert.ok(inputs.length > 0 && inputs.every((source) => source === image));
});

test("alternating two dancers reuses both GPU textures and the larger canvas", () => {
  let uploads = 0, viewports = 0;
  const gl = { COMPILE_STATUS: 1, LINK_STATUS: 2, NO_ERROR: 0, VERTEX_SHADER: 3, FRAGMENT_SHADER: 4,
    ARRAY_BUFFER: 5, ELEMENT_ARRAY_BUFFER: 6, STATIC_DRAW: 7, DYNAMIC_DRAW: 8, FLOAT: 9, TEXTURE_2D: 10,
    TEXTURE_WRAP_S: 11, TEXTURE_WRAP_T: 12, CLAMP_TO_EDGE: 13, TEXTURE_MIN_FILTER: 14, TEXTURE_MAG_FILTER: 15,
    LINEAR: 16, UNPACK_PREMULTIPLY_ALPHA_WEBGL: 17, BLEND: 18, RGBA: 19, UNSIGNED_BYTE: 20,
    COLOR_BUFFER_BIT: 21, TRIANGLES: 22, UNSIGNED_SHORT: 23, ONE: 24, ONE_MINUS_SRC_ALPHA: 25,
    createShader: () => ({}), shaderSource() {}, compileShader() {}, getShaderParameter: () => true,
    createProgram: () => ({}), attachShader() {}, linkProgram() {}, getProgramParameter: () => true,
    useProgram() {}, createBuffer: () => ({}), bindBuffer() {}, bufferData() {},
    getAttribLocation: (_program, name) => name === "position" ? 0 : 1,
    enableVertexAttribArray() {}, vertexAttribPointer() {}, pixelStorei() {}, clearColor() {}, disable() {}, enable() {}, blendFunc() {},
    isContextLost: () => false, createTexture: () => ({}), bindTexture() {}, texParameteri() {},
    texImage2D() { uploads++; }, getError: () => 0, viewport() { viewports++; }, clear() {}, drawElements() {},
  };
  const offscreen = { width: 0, height: 0, getContext: () => gl }, window = { devicePixelRatio: 1 };
  vm.runInNewContext(fs.readFileSync(require.resolve("../web/boss-dance-rig.js"), "utf8"),
    { window, document: { createElement: () => offscreen }, Math, Map, WeakMap, Float32Array, Float64Array, Uint16Array });
  const context = { globalAlpha: 1, save() {}, restore() {}, translate() {}, rotate() {}, drawImage() {} };
  const first = { complete: true, naturalWidth: 1254, naturalHeight: 1254 };
  const second = { complete: true, naturalWidth: 1254, naturalHeight: 1254 };
  for (let i = 0; i < 20; i++) {
    const image = i % 2 ? second : first, height = i % 2 ? 160 : 60;
    assert.equal(window.PondBossDanceRig.draw(context, image, Dance.poseAt(i / 10), 0, 0, height, 0,
      { columns: 1, rows: 1, mermaid: true }), true);
  }
  assert.equal(uploads, 2);
  assert.equal(viewports, 2);
  assert.equal(offscreen.width, 256);
});

test("the mermaid tail undulates continuously without opening at the centre seam", () => {
  let previous, minimum = Infinity, maximum = -Infinity;
  for (let phase = 0; phase < 8; phase += 1 / 24) {
    const pose = Dance.poseAt(phase);
    const left = Rig.deform(0.5, 0.92, -1, pose, true);
    const right = Rig.deform(0.5, 0.92, 1, pose, true);
    assert.ok(Math.hypot(left.x - right.x, left.y - right.y) < 1e-9);
    if (previous) assert.ok(Math.hypot(left.x - previous.x, left.y - previous.y) < 0.02);
    minimum = Math.min(minimum, left.x); maximum = Math.max(maximum, left.x); previous = left;
  }
  assert.ok(maximum - minimum > 0.10);
});

test("the small orbit turns clockwise inside the fish ring and contracts smoothly on a formation change", () => {
  const orbit = Dance.createOrbit(), points = [];
  let previous;
  for (let i = 0; i < 1200; i++) {
    const point = orbit.advance(0.02, i * 0.032, { ring: 1, radius: 180 }, 25);
    assert.ok(point.radius <= 180 * 0.26);
    if (previous) assert.ok(Math.hypot(point.x - previous.x, point.y - previous.y) < 1.5);
    if (i >= 400 && i < 900) points.push(point);
    previous = point;
  }
  assert.ok(points.every((p) => p.radius > 30));
  let clockwise = 0;
  for (let i = 1; i < points.length; i++) clockwise += points[i - 1].x * points[i].y - points[i - 1].y * points[i].x;
  assert.ok(clockwise > 0);
  for (let i = 0; i < 200; i++) {
    const point = orbit.advance(0.02, 40 + i * 0.032, { ring: 0, radius: 180 }, 25);
    if (i) assert.ok(point.radius < previous.radius);
    previous = point;
  }
  assert.ok(previous.radius < 0.01);
});

test("each formation gives both hands a visible, continuous shoulder and elbow stroke", () => {
  for (const name of Dance.formationNames) {
    const positions = [[], []], elbows = [];
    for (let i = 0; i < 240; i++) {
      const pose = Dance.mermaidPoseAt(i / 30, { [name]: 1 });
      const hands = [Rig.deform(0.12, 0.25, -1, pose, true), Rig.deform(0.88, 0.25, 1, pose, true)];
      hands.forEach((hand, side) => {
        const previous = positions[side].at(-1);
        if (previous) assert.ok(Math.hypot(hand.x - previous.x, hand.y - previous.y) < 0.02, name + " hand jumped");
        positions[side].push(hand);
      });
      elbows.push(pose.elbowLeft);
    }
    for (const path of positions) {
      const width = Math.max(...path.map((p) => p.x)) - Math.min(...path.map((p) => p.x));
      const height = Math.max(...path.map((p) => p.y)) - Math.min(...path.map((p) => p.y));
      assert.ok(Math.hypot(width, height) > 0.20, name + " hand barely moved");
    }
    assert.ok(Math.max(...elbows) - Math.min(...elbows) > 0.4, name + " elbow did not bend");
  }
  const heart = Dance.mermaidPoseAt(0, { heart: 1 });
  const double = Dance.mermaidPoseAt(0, { double: 1 });
  assert.notEqual(heart.armLeft, heart.armRight);
  assert.notEqual(double.elbowLeft, double.elbowRight);
});

test("the five performances have distinct paths and the spiral draws inward and outward", () => {
  const sample = (name, phase) => Dance.performancePoint(name, phase);
  const distance = (p) => Math.hypot(p.x, p.y);
  assert.ok(Math.abs(distance(sample("ring", 4)) - 1) < 1e-9);
  assert.ok(distance(sample("double", 4)) < 0.75);
  assert.ok(Math.abs(sample("heart", 4).x) > 0.8);
  assert.ok(Math.abs(distance(sample("lotus", 0)) - distance(sample("lotus", 1.6))) > 0.3);
  assert.ok(distance(sample("spiral", 0)) > distance(sample("spiral", 16)) * 4);
  assert.ok(distance(sample("spiral", 32)) > distance(sample("spiral", 16)) * 4);
});

test("formation changes and tight fish clearances keep the swimmer's path continuous", () => {
  const orbit = Dance.createOrbit(); let previous;
  const names = [...Dance.formationNames, "ring"];
  for (let frame = 0; frame < 1500; frame++) {
    const stage = Math.floor(frame / 300), progress = (frame % 300) / 300;
    const weights = { [names[stage]]: 1 - progress, [names[stage + 1]]: progress, radius: 180, clearance: 78 };
    const point = orbit.advance(1 / 60, frame / 30, weights, 25);
    assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.angle));
    assert.ok(point.radius <= 35.01);
    if (previous) assert.ok(Math.hypot(point.x - previous.x, point.y - previous.y) < 1.5);
    previous = point;
  }
  for (let frame = 0; frame < 300; frame++) previous = orbit.advance(1 / 60, 60 + frame / 30, { ring: 1, radius: 180, clearance: 45 }, 25);
  assert.ok(previous.radius <= 2.1);
});

test("the duet changes formations smoothly while keeping a safe distance", () => {
  const duet = Dance.createDuet(), seen = new Set(); let previous;
  for (let i = 0; i < 3400; i++) {
    const phase = i / 30, formation = { ring: 1, radius: 216, clearance: 100 };
    const pair = duet.advance(1 / 60, phase, formation, 25, 24);
    const dx = pair.second.x - pair.first.x, dy = pair.second.y - pair.first.y, distance = Math.hypot(dx, dy);
    seen.add(pair.move.name);
    assert.ok(distance > 49 && distance < 96);
    if (previous) {
      assert.ok(Math.hypot(pair.first.x - previous.first.x, pair.first.y - previous.first.y) < 1);
      assert.ok(Math.hypot(pair.second.x - previous.second.x, pair.second.y - previous.second.y) < 1);
      for (const role of ["first", "second"]) assert.ok(Math.abs(pair[role].angle - previous[role].angle) < 0.12, "heading jumped");
    }
    previous = pair;
  }
  assert.equal(seen.size, Dance.duetMoves.length);
});

test("the duet has continuous synchronized, alternating and delayed arm sequences", () => {
  let previous; let min = Infinity, max = -Infinity, alternating = false, delayed = false, reach = false;
  for (let i = 0; i < 2600; i++) {
    const pose = Dance.duetPoseAt(i / 30, { heart: 1 }, 0);
    const other = Dance.duetPoseAt(i / 30, { heart: 1 }, 1);
    assert.ok(Object.values(pose).every(Number.isFinite));
    if (previous) for (const key of ["armLeft", "armRight", "elbowLeft", "elbowRight"]) {
      assert.ok(Math.abs(pose[key] - previous[key]) < 0.07, key + " jumped");
    }
    min = Math.min(min, pose.armLeft); max = Math.max(max, pose.armLeft); previous = pose;
    const move = Dance.duetMoveAt(i / 30);
    if (move.name === "交替仰泳" && move.blend === 0 && Math.abs(pose.armLeft - pose.armRight) > 0.8) {
      assert.ok(Math.abs(pose.armLeft - other.armLeft) < 1e-9); alternating = true;
    }
    if (move.name === "波浪接力" && move.blend === 0 && Math.abs(pose.armLeft - other.armLeft) > 0.5) delayed = true;
    if (move.name === "对向伸手" && move.blend === 0 && pose.armLeft > 0.6 && pose.armRight > 0.6) reach = true;
  }
  assert.ok(max - min > 0.9, "the duet did not visibly reach out");
  assert.ok(alternating && delayed && reach);
});

test("duet staging includes a face-to-face reach, a passing arc and a full turn", () => {
  const duet = Dance.createDuet(), spin = [], passing = [];
  let faceSamples = 0;
  for (let i = 0; i < 96 * 60; i++) {
    const phase = i / 60, pair = duet.advance(1 / 60, phase, { ring: 1, radius: 220, clearance: 120 }, 25, 25);
    const move = Dance.duetMoveAt(phase), dx = pair.second.x - pair.first.x, dy = pair.second.y - pair.first.y;
    const distance = Math.hypot(dx, dy);
    if (move.name === "对向伸手" && move.within > 0.30 && move.within < 0.60) {
      const toward = (Math.sin(pair.first.angle) * dx - Math.cos(pair.first.angle) * dy) / distance;
      const otherToward = (-Math.sin(pair.second.angle) * dx + Math.cos(pair.second.angle) * dy) / distance;
      assert.ok(toward > 0.95 && otherToward > 0.95); faceSamples++;
    }
    if (move.name === "交错换位" && move.within > 0.15 && move.within < 0.65) passing.push({ x: dx / distance, y: dy / distance });
    if (move.name === "同步转体" && move.within > 0.10 && move.within < 0.65) spin.push(pair.first.angle);
  }
  assert.ok(faceSamples > 50);
  const start = passing[0], end = passing.at(-1);
  assert.ok(start.x * end.x + start.y * end.y < 0.2, "the pair did not travel around one another");
  assert.ok(spin.at(-1) - spin[0] > 4, "the pair did not execute the turn");
});

test("the mermaid duet joins hands and then follows the same curved path", () => {
  const duet = Dance.createDuet(), handGaps = []; let chasing = 0;
  const radius = 25, height = radius * 1.25 * 1.65 * 1.25;
  const palm = (point, pose, u, side) => {
    const p = Rig.deform(u, 0.25, side, pose, true);
    const x = (p.x - 0.5) * height, y = (p.y - 0.5) * height;
    return { x: point.x + x * Math.cos(point.angle) - y * Math.sin(point.angle),
      y: point.y + x * Math.sin(point.angle) + y * Math.cos(point.angle) };
  };
  for (let i = 0; i < 36 * 60; i++) {
    const phase = i / 60, pair = duet.advance(1 / 60, phase, { ring: 1, radius: 220, clearance: 120 }, radius, radius);
    const move = pair.move;
    if (move.name === "双人牵手游" && move.within > 0.25 && move.within < 0.6) {
      const a = palm(pair.first, Dance.duetPoseAt(phase, {ring:1}, 0), 0.08, -1);
      const b = palm(pair.second, Dance.duetPoseAt(phase, {ring:1}, 1), 0.92, 1);
      handGaps.push(Math.hypot(a.x - b.x, a.y - b.y));
    }
    if (move.name === "前后追游" && move.within > 0.25 && move.within < 0.6) {
      const separation = Math.hypot(pair.first.x - pair.second.x, pair.first.y - pair.second.y);
      assert.ok(separation / (2 * pair.halfSpacing) > 0.82 && separation / (2 * pair.halfSpacing) < 0.9);
      assert.ok(Dance.duetPoseAt(phase, {ring:1}, 0).tailAmplitude > 0.17);
      chasing++;
    }
  }
  assert.ok(handGaps.length > 50 && chasing > 50);
  assert.ok(Math.max(...handGaps) < 4, `the hands separated by ${Math.max(...handGaps).toFixed(1)}px`);
});

test("disabled rhythm falls back smoothly and ignores later beat events", () => {
  const dance = simulate(150, 4);
  dance.setRhythmEnabled(false);
  for (let i = 0; i < 400; i++) { dance.beat({ bpm: 150, confidence: 1, strength: 1 }); dance.advance(0.02); }
  const state = dance.snapshot();
  assert.equal(state.synchronized, false); assert.ok(Math.abs(state.tempo - 96) < 2);
});
