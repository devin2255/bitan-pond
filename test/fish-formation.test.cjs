"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Performance = require("../web/pond-performance.js");
const Motion = require("../web/fish-motion.js");

test("moving fish settle into every formation after beat-paced transitions", () => {
  const count = 66, width = 1280, height = 720, dt = 1 / 30, tempoFactor = 1.25;
  const names = [...Performance.formations, "ring"], transition = Performance.transitionSeconds, duration = 12;
  const weights = (time) => {
    const stage = Math.min(names.length - 1, Math.floor(time / duration));
    const elapsed = time - stage * duration;
    const to = Performance.formationWeights(0, count, names[stage]);
    if (!stage || elapsed >= transition) return to;
    const from = Performance.formationWeights(0, count, names[stage - 1]);
    return Performance.formationWeights(elapsed, count, names[stage], { from, start: 0 });
  };
  const fish = Array.from({ length: count }, (_, i) => {
    const slot = Performance.formationSlot(i, count, 0, width, height, weights(0), weights(0), tempoFactor, 90);
    return { x: slot.x + Math.sin(i * 3.1) * 14, y: slot.y + Math.cos(i * 2.7) * 14,
      a: Math.atan2(slot.tangentY, slot.tangentX), motion: Motion.create(42, i, () => 0.5) };
  });
  const errors = names.map(() => []);
  for (let t = 0; t < duration * names.length; t += dt) {
    const stage = Math.min(names.length - 1, Math.floor(t / duration));
    const w = weights(t), next = weights(t + 0.08);
    fish.forEach((f, i) => {
      const slot = Performance.formationSlot(i, count, t * tempoFactor, width, height, w, next, tempoFactor, 90);
      const target = Performance.formationGuidance(f, slot, width / 2, height / 2);
      let difference = Math.atan2(target.y, target.x) - f.a;
      while (difference > Math.PI) difference -= Math.PI * 2;
      while (difference < -Math.PI) difference += Math.PI * 2;
      f.a += Motion.turn(f.motion, difference, dt);
      const speed = Math.max(6, target.speed * Math.max(0.4, 1 - Math.abs(difference) / Math.PI * 0.6));
      f.motion.speed += (speed - f.motion.speed) * (1 - Math.exp(-1.8 * dt));
      f.x += Math.cos(f.a) * f.motion.speed * dt; f.y += Math.sin(f.a) * f.motion.speed * dt;
      if (t - stage * duration > duration - 3) errors[stage].push(target.distance);
    });
  }
  const failures = [];
  errors.forEach((samples, stage) => {
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    samples.sort((a, b) => a - b);
    const p90 = samples[Math.floor(samples.length * 0.9)];
    if (!(mean < 25 && p90 < 55)) failures.push(`${names[stage]} mean ${mean.toFixed(1)} p90 ${p90.toFixed(1)}`);
  });
  assert.deepEqual(failures, [], "formations did not settle");
});
