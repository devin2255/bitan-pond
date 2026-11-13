const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const activity = require("../web/boss-activity.js");
const dance = require("../web/boss-dance.js");

function setup({ initial = {}, fail = () => false, hold = () => false } = {}) {
  const values = new Map(Object.entries(initial)), pending = [], drawn = [];
  class FakeImage {
    constructor() { this.complete = false; this.naturalWidth = 0; this.naturalHeight = 0; this.listeners = {}; }
    set src(value) {
      this.url = value;
      const finish = () => {
        this.complete = true;
        this.naturalWidth = fail(value) ? 0 : 1024;
        this.naturalHeight = this.naturalWidth;
        (this.listeners[this.naturalWidth ? "load" : "error"] || []).forEach((callback) => callback());
      };
      if (hold(value)) pending.push(finish);
      else queueMicrotask(finish);
    }
    get src() { return this.url; }
    addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
  }
  function context2d() {
    return new Proxy({ globalAlpha: 1, drawImage(image) { if (image.src) drawn.push(image.src); } }, {
      get(target, key) { return key in target ? target[key] : () => {}; },
      set(target, key, value) { target[key] = value; return true; },
    });
  }
  const localStorage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
  };
  const window = {};
  const sandbox = { window, localStorage, Image: FakeImage, PondBossActivity: activity, PondBossDance: dance,
    document: { createElement: () => ({ width: 0, height: 0, getContext: context2d }) }, console };
  const script = fs.readFileSync(path.join(__dirname, "../web/boss-character.js"), "utf8");
  vm.runInNewContext(script, sandbox, { filename: "boss-character.js" });
  return { create: window.PondBossCharacter.create, values, pending, drawn, context2d };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test("each brother keeps an independent outfit and restores it after restart", async () => {
  const h = setup();
  const first = h.create(), second = h.create({ variant: "friend" });
  assert.equal(await first.setOutfit("floral"), true);
  assert.equal(await second.setOutfit("classic"), true);
  assert.equal(h.values.get("bitan.boss.outfit"), "floral");
  assert.equal(h.values.get("bitan.friend.outfit"), "classic");

  assert.equal(await second.setOutfit("floral"), true);
  assert.equal(await first.setOutfit("classic"), true);
  const restoredFirst = h.create(), restoredSecond = h.create({ variant: "friend" });
  await flush();
  assert.equal(restoredFirst.outfit, "classic");
  assert.equal(restoredSecond.outfit, "floral");
  restoredSecond.setPosition(200, 200, 60, 0);
  restoredSecond.drawTop(h.context2d());
  assert.ok(h.drawn.includes("friend-floral-rest-v1.png"), "the restored outfit should be rendered");
});

test("the second friend's floral outfit remains visible during a face-down breaststroke", async () => {
  const h = setup();
  const second = h.create({ variant: "friend" });
  assert.equal(await second.setOutfit("floral"), true);
  second.setPosition(200, 200, 60, 0);
  assert.equal(second.hit(200, 200), true);
  second.update(2.1, () => {}, () => null);
  second.drawWater(h.context2d());
  assert.ok(h.drawn.includes("friend-floral-swim-cycle-v1.png"), "the floral breaststroke atlas should be rendered");
});

test("a failed outfit load keeps the previous clothing and persisted choice", async () => {
  const h = setup({ fail: (src) => src === "friend-floral-swim-cycle-v1.png" });
  const second = h.create({ variant: "friend" });
  assert.equal(await second.setOutfit("floral"), false);
  assert.equal(second.outfit, "classic");
  assert.equal(h.values.get("bitan.friend.outfit"), "classic");
  second.setPosition(200, 200, 60, 0);
  second.drawTop(h.context2d());
  assert.ok(h.drawn.includes("friend-black-rest-v1.png"));
});

test("a late floral load cannot override a newer switch back to black", async () => {
  const h = setup({ hold: (src) => src.startsWith("friend-floral-") });
  const second = h.create({ variant: "friend" });
  const slow = second.setOutfit("floral");
  assert.equal(await second.setOutfit("classic"), true);
  h.pending.forEach((finish) => finish());
  assert.equal(await slow, false);
  assert.equal(second.outfit, "classic");
  assert.equal(h.values.get("bitan.friend.outfit"), "classic");
});
