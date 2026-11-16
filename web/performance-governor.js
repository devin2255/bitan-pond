(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PondPerformanceGovernor = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  const profiles = Object.freeze([
    Object.freeze({ id: "quality", fps: 60, maxPixels: Infinity, fishStrips: 22, rain: 720, drizzle: 120, snow: 520, causticLayers: 2 }),
    Object.freeze({ id: "balanced", fps: 30, maxPixels: 2304000, fishStrips: 12, rain: 440, drizzle: 80, snow: 280, causticLayers: 1 }),
    Object.freeze({ id: "smooth", fps: 30, maxPixels: 1280000, fishStrips: 8, rain: 240, drizzle: 48, snow: 150, causticLayers: 1 }),
    Object.freeze({ id: "economy", fps: 30, maxPixels: 850000, fishStrips: 6, rain: 150, drizzle: 36, snow: 100, causticLayers: 1 }),
  ]);
  const modes = ["auto", "quality", "smooth"];
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function renderScale(width, height, deviceScale, maxPixels) {
    const desired = clamp(Number(deviceScale) || 1, 0.25, 2);
    const area = Math.max(1, Number(width) * Number(height));
    return Math.min(desired, Math.max(0.25, Math.sqrt(maxPixels / area)));
  }

  // Ignore very long pauses rather than jumping through the pond on resume.
  // At 20 fps this returns 0.05 s, so fish no longer run in slow motion.
  function simulationDelta(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return 0;
    return seconds > 0.5 ? 1 / 30 : Math.min(seconds, 0.1);
  }

  function create({ cores = 8, initialLevel } = {}) {
    const seed = Number.isInteger(initialLevel) ? clamp(initialLevel, 0, profiles.length - 1) : (Number(cores) > 0 && Number(cores) <= 4 ? 1 : 0);
    let mode = "auto", level = seed, slowTime = 0, healthyTime = 0, cooldown = 0, stalled = false;
    function reset() { slowTime = 0; healthyTime = 0; cooldown = 0; stalled = false; }
    function setMode(next) {
      mode = modes.includes(next) ? next : "auto";
      level = mode === "quality" ? 0 : mode === "smooth" ? profiles.length - 1 : seed;
      reset();
      return profiles[level];
    }
    function observe(interval, work) {
      if (mode !== "auto" || !Number.isFinite(interval) || !Number.isFinite(work) || interval <= 0) {
        reset();
        return false;
      }
      if (interval > 500) {
        cooldown = Math.max(0, cooldown - Math.min(interval, 5000));
        const overloaded = work > 400 || stalled;
        stalled = true; slowTime = 0; healthyTime = 0;
        if (overloaded && !cooldown && level < profiles.length - 1) {
          level++; reset(); cooldown = 2000; return true;
        }
        return false;
      }
      stalled = false;
      const elapsed = Math.min(interval, 150);
      cooldown = Math.max(0, cooldown - elapsed);
      const budget = 1000 / profiles[level].fps;
      const slow = interval > budget * 1.35 || work > budget * 0.9;
      slowTime = Math.max(0, slowTime + elapsed * (slow ? 1 : -1.5));
      const fastEnough = interval <= budget * 1.2 && work < (level === 1 ? 9 : 14);
      healthyTime = fastEnough ? healthyTime + elapsed : 0;
      if (!cooldown && slowTime >= 4000 && level < profiles.length - 1) {
        level++; reset(); cooldown = 5000; return true;
      }
      if (!cooldown && healthyTime >= 25000 && level > 0) {
        level--; reset(); cooldown = 10000; return true;
      }
      return false;
    }
    return {
      get mode() { return mode; },
      get level() { return level; },
      get profile() { return profiles[level]; },
      setMode, observe,
      reset,
    };
  }
  return { profiles, modes, renderScale, simulationDelta, create };
});
