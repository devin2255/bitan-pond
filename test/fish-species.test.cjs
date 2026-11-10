const test = require("node:test");
const assert = require("node:assert/strict");
const fish = require("../web/fish-species.js");

test("counts support zero and reject incomplete, fractional or excessive input", () => {
  const counts = (changes) => Object.assign(fish.defaults(), changes);
  assert.equal(fish.validate(counts({ koi: 0, goldfish: 1 })).ok, true);
  assert.equal(fish.validate(counts({ koi: "" })).ok, false);
  assert.equal(fish.validate(counts({ koi: 1.5 })).ok, false);
  assert.equal(fish.validate(counts({ koi: -1 })).ok, false);
  assert.equal(fish.validate(counts({ koi: 81 })).ok, false);
  assert.equal(fish.validate(counts({ koi: 80, goldfish: 41 })).ok, false);
});

test("reconciliation preserves custom fish and retained fish while changing each species", () => {
  const koi = { species: "koi" }, custom = { species: "koi", custom: true };
  const other = { species: "goldfish" }, spare = { species: "koi" };
  const counts = Object.fromEntries(fish.species.map((item) => [item.id, 0]));
  Object.assign(counts, { koi: 1, crucian: 2, grasscarp: 1, guppy: 3 });
  const result = fish.plan([koi, custom, other, spare], counts);
  assert.deepEqual(result.remove, [spare, other]);
  assert.equal(result.remove.includes(custom), false);
  assert.equal(result.remove.includes(koi), false);
  assert.deepEqual(result.add, { koi: 0, goldfish: 0, crucian: 2, grasscarp: 1, ranchu: 0, guppy: 3, betta: 0 });
});

test("older saved settings keep their choices and safely include new fish", () => {
  const old = { koi: 12, goldfish: 3, crucian: 0, grasscarp: 5 };
  assert.deepEqual(fish.restore(old), { ...old, ranchu: 4, guppy: 4, betta: 4 });
  const full = { koi: 80, goldfish: 39, crucian: 0, grasscarp: 0 };
  assert.deepEqual(fish.restore(full), { ...full, ranchu: 1, guppy: 0, betta: 0 });
  const empty = { koi: 0, goldfish: 0, crucian: 0, grasscarp: 0 };
  assert.deepEqual(fish.restore(empty), { ...empty, ranchu: 0, guppy: 0, betta: 0 });
  assert.deepEqual(fish.restore(null), fish.defaults());
});
