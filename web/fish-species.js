(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PondFish = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const species = [
    { id: "koi", name: "锦鲤", detail: "斑斓花纹", defaultCount: 30 },
    { id: "goldfish", name: "金鱼", detail: "圆身长尾", defaultCount: 10, image: "fish-goldfish.png" },
    { id: "crucian", name: "鲫鱼", detail: "银灰鳞片", defaultCount: 8, image: "fish-crucian.png" },
    { id: "grasscarp", name: "草鱼", detail: "修长青背", defaultCount: 6, image: "fish-grasscarp.png" },
    { id: "ranchu", name: "兰寿金鱼", detail: "红白圆身", defaultCount: 4, image: "fish-ranchu.png" },
    { id: "guppy", name: "孔雀鱼", detail: "斑斓扇尾", defaultCount: 4, image: "fish-guppy.png" },
    { id: "betta", name: "斗鱼", detail: "流光长鳍", defaultCount: 4, image: "fish-betta.png" },
  ];
  const maxPerSpecies = 80;
  const maxTotal = 120;

  function defaults() {
    return Object.fromEntries(species.map((item) => [item.id, item.defaultCount]));
  }

  function validate(input) {
    const counts = {};
    let total = 0;
    for (const item of species) {
      const raw = input && input[item.id];
      const n = raw === "" || raw == null ? NaN : Number(raw);
      if (!Number.isInteger(n) || n < 0 || n > maxPerSpecies) {
        return { ok: false, error: `${item.name}数量请输入 0 到 ${maxPerSpecies} 的整数` };
      }
      counts[item.id] = n;
      total += n;
    }
    if (total > maxTotal) return { ok: false, error: `普通鱼总数最多 ${maxTotal} 条` };
    return { ok: true, counts, total };
  }

  // New species may be added after an older version saved its counts. Keep
  // every existing choice, fill only missing species and respect the limit.
  function restore(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return defaults();
    const known = species.filter((item) => Object.prototype.hasOwnProperty.call(input, item.id));
    if (!known.length) return defaults();
    const counts = {};
    let total = 0;
    for (const item of known) {
      const raw = input[item.id];
      const value = raw === "" || raw == null ? NaN : Number(raw);
      if (!Number.isInteger(value) || value < 0 || value > maxPerSpecies) return defaults();
      counts[item.id] = value;
      total += value;
    }
    if (total > maxTotal) return defaults();
    const emptyPond = total === 0;
    for (const item of species) {
      if (Object.prototype.hasOwnProperty.call(counts, item.id)) continue;
      counts[item.id] = emptyPond ? 0 : Math.min(item.defaultCount, maxTotal - total);
      total += counts[item.id];
    }
    return counts;
  }

  function plan(fishes, counts) {
    const remove = [];
    const add = {};
    for (const item of species) {
      const group = fishes.filter((fish) => !fish.custom && (fish.species || "koi") === item.id);
      const difference = counts[item.id] - group.length;
      add[item.id] = Math.max(0, difference);
      if (difference < 0) remove.push(...group.slice(difference));
    }
    return { remove, add };
  }

  function nameFor(id) {
    const item = species.find((entry) => entry.id === id);
    return item ? item.name : "锦鲤";
  }

  return { species, defaults, validate, restore, plan, nameFor, maxPerSpecies, maxTotal };
});
