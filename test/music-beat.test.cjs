"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createBeatTracker } = require("../music-beat");

test("tracks different actual pulse rates without relying on song metadata", () => {
  for (const bpm of [60, 90, 120, 150]) {
    const detector = createBeatTracker(), found = [];
    for (let t = 0; t < 30000; t += 50) {
      const phase = t % (60000 / bpm), level = phase < 65 ? 0.12 : 0.003;
      const event = detector.update(level, level, t);
      if (event) found.push(event);
    }
    assert.ok(found.length > 10, `not enough beats at ${bpm} BPM`);
    assert.ok(Math.abs(found.at(-1).bpm - bpm) <= 5, `incorrect tempo at ${bpm} BPM`);
  }
});

test("steady audio and silence do not invent a beat", () => {
  const detector = createBeatTracker();
  for (let t = 0; t < 30000; t += 50) assert.equal(detector.update(0.02, 0.01, t), null);
  for (let t = 30000; t < 35000; t += 50) assert.equal(detector.update(0, 0, t), null);
});

test("quick offbeats do not double the emitted beat rate", () => {
  const detector = createBeatTracker(), events = [];
  for (let t = 0; t < 12000; t += 50) {
    const level = t % 250 === 0 ? 0.12 : 0.002;
    const event = detector.update(level, level, t);
    if (event) events.push({ ...event, time: t });
  }
  assert.ok(events.length > 8);
  assert.ok(events.every((event) => Math.abs(event.bpm - 120) < 1));
  for (let i = 1; i < events.length; i++) assert.ok(events[i].time - events[i - 1].time >= 450);
});
